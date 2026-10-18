import type { WebSocket } from 'ws';
import { PLAYER_COUNT } from '../src/sim/config';
import { BotBrain } from '../src/sim/bot';
import { Command, PlayerSlot, World } from '../src/sim/world';
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
const BOT_NAMES = ['Knuckles', 'Pinky', 'Thumbs', 'Lefty', 'Digit', 'Palmer', 'Pointer', 'Mitts', 'Ringo', 'Wristy'];

type InputMessage = Extract<ClientMessage, { t: 'input' }>;

export interface Client {
  ws: WebSocket;
  name: string;
  look: WireLook | null;
  room: Room | null;
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
  ) {}

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
    if (this.state === 'lobby' && this.isPrivate && this.clients.includes(client)) this.startMatch();
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
    for (const c of this.clients) {
      const players: LobbyPlayer[] = this.clients.map((o) => ({ name: o.name, isYou: o === c }));
      send(c.ws, { t: 'lobby', code: this.code, players, startsIn, canStart: this.isPrivate });
    }
  }

  private startMatch() {
    if (this.state !== 'lobby') return;
    const slots: { slot: PlayerSlot; client: Client | null }[] = this.clients.map((c) => ({
      slot: { name: c.name, isBot: false },
      client: c,
    }));
    const botNames = shuffle(BOT_NAMES);
    while (slots.length < PLAYER_COUNT) {
      slots.push({ slot: { name: botNames[slots.length % botNames.length], isBot: true }, client: null });
    }
    const order = shuffle(slots); // so friends don't always spawn side by side
    const seed = Math.floor(Math.random() * 1e9);
    this.world = new World(
      seed,
      order.map((o) => o.slot),
    );
    this.bots = new BotBrain(this.world);
    order.forEach((o, i) => {
      if (o.client) o.client.brawlerId = this.world!.brawlers[i].id;
    });
    this.state = 'playing';
    const looks = new Map<number, WireLook | null>();
    order.forEach((o, i) => looks.set(this.world!.brawlers[i].id, o.client?.look ?? null));
    const players = this.world.brawlers.map((b) => ({ id: b.id, name: b.name, look: looks.get(b.id) ?? null }));
    for (const c of this.clients) send(c.ws, { t: 'start', seed, you: c.brawlerId!, players });
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
      if (me.alive && world.winnerId === null) continue;
      c.resultSent = true;
      const winner = world.brawlers.find((b) => b.id === world.winnerId);
      send(c.ws, { t: 'result', rank: me.rank, kills: me.kills, cubes: me.cubes, winner: winner?.name ?? null });
    }
    if (world.winnerId !== null) this.state = 'ended';
  }

  private sendSnapshot(c: Client, events: Snapshot['ev']) {
    const world = this.world!;
    const me = world.brawlers.find((b) => b.id === c.brawlerId);
    const spectating = !me || !me.alive;
    const b: BrawlerState[] = [];
    const alive: number[] = [];
    for (const o of world.brawlers) {
      if (!o.alive) continue;
      alive.push(o.id);
      // Hidden enemies are never sent, so a modified client can't see into bushes.
      if (!spectating && o !== me && !world.canSee(me!, o)) continue;
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
