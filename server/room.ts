import type { WebSocket } from 'ws';
import { BotDifficulty, DEFAULT_BOT_DIFFICULTY, PLAYER_COUNT, TeamSize, teamCount } from '../src/sim/config';
import { BotBrain } from '../src/sim/bot';
import { Command, PlayerSlot, World, winnerLabel } from '../src/sim/world';
import {
  BrawlerState,
  ClientMessage,
  LobbyPlayer,
  ServerMessage,
  FX_DASH,
  FX_RAPID,
  FX_SHIELD,
  Snapshot,
  TICK,
  WireLook,
  round,
} from '../src/net/protocol';

const PUBLIC_LOBBY_WAIT = 12; // seconds a public lobby waits for more players
const RESULTS_LINGER = 6; // seconds a finished match stays open
const MAX_QUEUED_INPUTS = 8;
const MAX_MOVE_CREDIT = 4;
const BOT_NAMES = ['Knuckles', 'Pinky', 'Thumbs', 'Lefty', 'Digit', 'Palmer', 'Pointer', 'Mitts', 'Ringo', 'Wristy', 'Nails', 'Pal'];

type InputMessage = Extract<ClientMessage, { t: 'input' }>;

export interface Client {
  ws: WebSocket;
  name: string;
  look: WireLook | null;
  room: Room | null;
  team: number; // lobby team, 0-based
  brawlerId: number | null;
  inputs: InputMessage[];
  last: InputMessage | null;
  ackSeq: number;
  moveCredit: number;
  resultSent: boolean;
}

export type RoomState = 'lobby' | 'playing' | 'ended';

export class Room {
  state: RoomState = 'lobby';
  clients: Client[] = [];
  private world: World | null = null;
  private bots: BotBrain | null = null;
  private tick = 0;
  private lobbyClock = 0;
  private endedClock = 0;
  private lastLobbyBroadcast = -1;

  constructor(
    readonly id: string,
    readonly code: string | null, // null for public matchmaking rooms
    public teamSize: TeamSize = 1,
    public difficulty: BotDifficulty = DEFAULT_BOT_DIFFICULTY,
  ) {}

  /** Whoever has been in the lobby longest picks the mode and starts a private match. */
  get host(): Client | null {
    return this.isPrivate ? this.leader : null;
  }

  /** Longest in the lobby, public or private: picks how well the bots play. */
  get leader(): Client | null {
    return this.clients[0] ?? null;
  }

  get isPrivate() {
    return this.code !== null;
  }

  get isFull() {
    return this.clients.length >= PLAYER_COUNT;
  }

  get isEmpty() {
    return this.clients.length === 0;
  }

  /** Done when everyone has left, or a finished match has lingered long enough. */
  get isClosed() {
    return this.isEmpty || (this.state === 'ended' && this.endedClock > RESULTS_LINGER);
  }

  add(client: Client) {
    client.room = this;
    client.brawlerId = null;
    client.inputs = [];
    client.last = null;
    client.ackSeq = 0;
    client.moveCredit = 0;
    client.resultSent = false;
    client.team = this.openTeam(-1);
    this.clients.push(client);
    if (this.isFull) this.startMatch();
    else this.broadcastLobby();
  }

  remove(client: Client) {
    this.clients = this.clients.filter((c) => c !== client);
    client.room = null;
    // A hand whose player leaves mid-match keeps fighting as a bot.
    if (this.world && client.brawlerId !== null) {
      const b = this.world.brawlers.find((x) => x.id === client.brawlerId);
      if (b) b.isBot = true;
    }
    if (this.state === 'lobby') this.broadcastLobby();
  }

  requestStart(client: Client) {
    if (this.state === 'lobby' && client === this.host) this.startMatch();
  }

  /** Host switches between solo and teams of 2-4. */
  setTeamSize(client: Client, size: TeamSize) {
    if (this.state !== 'lobby' || client !== this.host || size === this.teamSize) return;
    this.teamSize = size;
    // Re-seat in join order, so friends fill the same team first; they can still swap after.
    for (const c of this.clients) c.team = -1;
    for (const c of this.clients) c.team = this.openTeam(-1);
    this.broadcastLobby();
  }

  setDifficulty(client: Client, level: BotDifficulty) {
    if (this.state !== 'lobby' || client !== this.leader || level === this.difficulty) return;
    this.difficulty = level;
    this.broadcastLobby();
  }

  setTeam(client: Client, team: number) {
    if (this.state !== 'lobby' || !this.clients.includes(client)) return;
    if (!Number.isInteger(team) || team < 0 || team >= teamCount(this.teamSize)) return;
    if (this.membersOf(team) >= this.teamSize) return;
    client.team = team;
    this.broadcastLobby();
  }

  private membersOf(team: number): number {
    return this.clients.filter((c) => c.team === team).length;
  }

  /** First team with a free seat, so players fill teams together rather than spreading out. */
  private openTeam(fallback: number): number {
    for (let t = 0; t < teamCount(this.teamSize); t++) if (this.membersOf(t) < this.teamSize) return t;
    return fallback;
  }

  queueInput(client: Client, msg: InputMessage) {
    if (this.state !== 'playing') return;
    client.inputs.push(msg);
    while (client.inputs.length > MAX_QUEUED_INPUTS) {
      // Drop the oldest, but never lose a super or ability press.
      const dropped = client.inputs.shift()!;
      if (dropped.s) client.inputs[0].s = 1;
      if (dropped.q) client.inputs[0].q = 1;
      client.ackSeq = Math.max(client.ackSeq, dropped.seq);
    }
  }

  update(dt: number) {
    if (this.state === 'lobby') {
      this.lobbyClock += dt;
      if (!this.isPrivate && this.lobbyClock >= PUBLIC_LOBBY_WAIT) this.startMatch();
      else if (Math.floor(this.lobbyClock) !== this.lastLobbyBroadcast) this.broadcastLobby();
      return;
    }
    if (this.state === 'ended') {
      this.endedClock += dt;
      return;
    }
    this.step();
  }

  private broadcastLobby() {
    this.lastLobbyBroadcast = Math.floor(this.lobbyClock);
    const startsIn = this.isPrivate ? null : Math.max(0, Math.ceil(PUBLIC_LOBBY_WAIT - this.lobbyClock));
    const host = this.host;
    for (const c of this.clients) {
      const players: LobbyPlayer[] = this.clients.map((o) => ({
        name: o.name,
        isYou: o === c,
        isHost: o === host,
        team: o.team,
      }));
      send(c.ws, {
        t: 'lobby',
        code: this.code,
        teamSize: this.teamSize,
        difficulty: this.difficulty,
        players,
        startsIn,
        canStart: c === host,
        canSetDifficulty: c === this.leader,
      });
    }
  }

  private startMatch() {
    if (this.state !== 'lobby') return;
    const size = this.teamSize;
    // Seat everyone team by team (the world spawns teammates together), bots in the empty seats.
    // Teams are shuffled so the same lobby team doesn't always start in the same spot.
    const botNames = shuffle(BOT_NAMES);
    let botIndex = 0;
    const teamOrder = shuffle([...Array(teamCount(size)).keys()]);
    const seats: { slot: PlayerSlot; client: Client | null }[] = [];
    teamOrder.forEach((lobbyTeam, team) => {
      const members = shuffle(this.clients.filter((c) => c.team === lobbyTeam));
      for (let i = 0; i < size; i++) {
        const c = members[i];
        if (c) seats.push({ slot: { name: c.name, isBot: false, team }, client: c });
        else seats.push({ slot: { name: botNames[botIndex++ % botNames.length], isBot: true, team }, client: null });
      }
    });
    const seed = Math.floor(Math.random() * 1e9);
    this.world = new World(
      seed,
      seats.map((o) => o.slot),
      size,
    );
    this.bots = new BotBrain(this.world, this.difficulty);
    seats.forEach((o, i) => {
      if (o.client) o.client.brawlerId = this.world!.brawlers[i].id;
    });
    this.state = 'playing';
    const players = this.world.brawlers.map((b, i) => ({
      id: b.id,
      name: b.name,
      team: b.team,
      look: seats[i].client?.look ?? null,
    }));
    for (const c of this.clients) send(c.ws, { t: 'start', seed, you: c.brawlerId!, teamSize: size, players });
  }

  private step() {
    const world = this.world!;
    const commands = new Map<number, Command>();
    for (const c of this.clients) {
      if (c.brawlerId === null) continue;
      const me = world.brawlers.find((b) => b.id === c.brawlerId)!;
      // Each client input is one tick of movement, applied as it arrives so the
      // client's prediction matches exactly. Credit stops anyone moving faster
      // than one input per tick, while letting a briefly stalled client catch up.
      c.moveCredit = Math.min(MAX_MOVE_CREDIT, c.moveCredit + 1);
      let fire = false;
      let superFire = false;
      let ability = false;
      let consumed = false;
      while (c.inputs.length > 0 && c.moveCredit >= 1) {
        const input = c.inputs.shift()!;
        c.moveCredit--;
        c.ackSeq = input.seq;
        c.last = input;
        consumed = true;
        // A dash carries the hand on its own, so walking input pauses until it ends.
        if (me.alive && !world.isDashing(me)) world.moveBody(me, input.mx, input.my, TICK);
        fire ||= input.f === 1;
        superFire ||= input.s === 1;
        ability ||= input.q === 1;
      }
      const use = c.last;
      if (!use) continue;
      commands.set(c.brawlerId, {
        moveX: consumed ? use.mx : 0,
        moveY: consumed ? use.my : 0,
        aimX: use.ax,
        aimY: use.ay,
        fire,
        superFire,
        ability: ability ? 'auto' : null,
        skipMove: true,
      });
    }
    for (const b of world.brawlers) {
      if (b.alive && b.isBot) commands.set(b.id, this.bots!.command(b, TICK));
    }

    world.step(TICK, commands);
    this.tick++;
    const events = world.events.slice();
    world.events.length = 0;

    for (const c of this.clients) this.sendSnapshot(c, events);

    for (const c of this.clients) {
      if (c.resultSent || c.brawlerId === null) continue;
      const me = world.brawlers.find((b) => b.id === c.brawlerId)!;
      if (me.rank === 0) continue; // your team is still in it
      c.resultSent = true;
      send(c.ws, { t: 'result', rank: me.rank, kills: me.kills, cubes: me.cubes, winner: winnerLabel(world) });
    }
    if (world.winnerId !== null) this.state = 'ended';
  }

  private sendSnapshot(c: Client, events: Snapshot['ev']) {
    const world = this.world!;
    const me = world.brawlers.find((b) => b.id === c.brawlerId);
    // Teammates share what they see; once your whole team is out you can watch everything.
    const spectating = !me || !world.isTeamAlive(me.team);
    const b: BrawlerState[] = [];
    const alive: number[] = [];
    for (const o of world.brawlers) {
      if (!o.alive) continue;
      alive.push(o.id);
      // Hidden enemies are never sent, so a modified client can't see into bushes.
      if (!spectating && !world.teamCanSee(me!.team, o)) continue;
      const s: BrawlerState = {
        id: o.id,
        x: round(o.x, 3),
        y: round(o.y, 3),
        f: round(o.facing, 3),
        mx: round(o.moveX),
        my: round(o.moveY),
        hp: Math.round(o.hp),
        mhp: o.maxHp,
        cubes: o.cubes,
        bush: o.inBush ? 1 : 0,
        stk: o.streak,
        fg: o.extraFingers,
        fx: (world.isShielded(o) ? FX_SHIELD : 0) | (world.isRapidFiring(o) ? FX_RAPID : 0) | (world.isDashing(o) ? FX_DASH : 0),
      };
      if (o === me) {
        s.ammo = round(o.ammo, 3);
        s.sup = round(o.superCharge, 3);
        s.ar = [round(o.abilityReadyAt.dash, 3), round(o.abilityReadyAt.shield, 3), round(o.abilityReadyAt.rapidFire, 3)];
        s.al = round(o.abilityLockUntil, 3);
      }
      b.push(s);
    }
    send(c.ws, {
      t: 'snap',
      tick: this.tick,
      time: round(world.time, 3),
      zone: round(world.zoneHalfSize, 3),
      ack: c.ackSeq,
      alive,
      b,
      bul: world.bullets.map((u) => ({
        id: u.id,
        x: round(u.x),
        y: round(u.y),
        dx: round(u.dx, 3),
        dy: round(u.dy, 3),
        sup: u.isSuper ? 1 : 0,
      })),
      cubes: world.cubes.map((k) => [k.id, round(k.x), round(k.y)]),
      fingers: world.fingers.map((f) => [f.id, round(f.x), round(f.y), f.fromId]),
      ev: events,
    });
  }
}

// LAG_MS=120 npm run server adds fake one-way latency, to feel out prediction locally.
const LAG_MS = Number(process.env.LAG_MS ?? 0);

export function send(ws: WebSocket, msg: ServerMessage) {
  const data = JSON.stringify(msg);
  const go = () => ws.readyState === ws.OPEN && ws.send(data);
  if (LAG_MS > 0) setTimeout(go, LAG_MS);
  else go();
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
