import type { Match, MatchResult } from '../game/match';
import type { PlayerIntent } from '../input';
import { DEFAULT_LOOK, type PlayerLook, type TopperId, isGloveId, isTopperId, randomLook } from '../render/cosmetics';
import { AMMO, AMMO_KINDS, AmmoKind, BRAWLER, PROP_KINDS, PropKind, RAPID_FIRE_SHOT_COOLDOWN, SUPER } from '../sim/config';
import { Brawler, Point, World, ammoOf } from '../sim/world';
import { type MapTheme, isMapTheme } from '../sim/themes';
import type { Connection } from './connection';
import {
  type WireLook,
  ClientMessage,
  FX_BURN,
  FX_CHILL,
  FX_DASH,
  FX_RAPID,
  FX_SHIELD,
  ServerMessage,
  Snapshot,
  TICK,
} from './protocol';

// How far behind the newest snapshot other players are drawn, so there are
// always two snapshots to blend between even when packets arrive unevenly.
const INTERP_DELAY = 0.1;
const SNAPSHOT_BUFFER = 30;

type StartMessage = Extract<ServerMessage, { t: 'start' }>;
type InputMessage = Extract<ClientMessage, { t: 'input' }>;

interface Received {
  snap: Snapshot;
  at: number; // local seconds when it arrived
}

/**
 * An online match. The server owns the real game; this keeps a local World as
 * a view of it. Your own hand is predicted (moves instantly, corrected by the
 * server), everyone else is interpolated between snapshots.
 */
export class OnlineMatch implements Match {
  readonly world: World;
  readonly playerId: number;
  readonly mapTheme: MapTheme;
  result: MatchResult | null = null;
  /** Counts of prediction misses, for debugging feel. */
  readonly stats = { snapshots: 0, corrections: 0, maxError: 0 };

  private snaps: Received[] = [];
  private visibleIds = new Set<number>();
  private clockOffset: number | null = null; // server time minus local time
  private seq = 0;
  private pending: InputMessage[] = [];
  private pred: Point;
  private prevPred: Point;
  private acc = 0;
  private wantFire = false;
  private wantSuper = false;
  private wantAbility = false;
  private wantProp: PropKind | null = null;
  private looks = new Map<number, PlayerLook>();
  private predictedAmmo: number = BRAWLER.maxAmmo;
  private lastLocalShot = -10;

  constructor(
    private conn: Connection,
    start: StartMessage,
  ) {
    this.world = new World(
      start.seed,
      start.players.map((p) => ({ name: p.name, isBot: false, team: p.team })),
      start.teamSize,
      start.game ?? 'showdown',
      start.blocks ?? 'pick',
    );
    // Both sides build the same arena from the seed, so ids line up; check anyway.
    start.players.forEach((p, i) => {
      if (this.world.brawlers[i].id !== p.id) throw new Error('Arena mismatch with server');
    });
    this.playerId = start.you;
    this.mapTheme = isMapTheme(start.map) ? start.map : 'summer';
    // Bots (and anyone who sent no look) get a random one; it only has to look varied.
    for (const p of start.players) {
      const look = p.look && isTopperId(p.look.topper) ? fromWire(p.look, p.look.topper) : randomLook();
      this.looks.set(p.id, look);
    }
    const me = this.me;
    this.pred = { x: me.x, y: me.y };
    this.prevPred = { ...this.pred };
    for (const b of this.world.brawlers) this.visibleIds.add(b.id);
  }

  private get me(): Brawler {
    return this.world.brawlers.find((b) => b.id === this.playerId)!;
  }

  isVisible(b: Brawler): boolean {
    // The server only sends what your team can see (everything once your team is out).
    return b.id === this.playerId || this.visibleIds.has(b.id);
  }

  lookOf(b: Brawler): PlayerLook {
    return this.looks.get(b.id) ?? randomLook();
  }

  handle(msg: ServerMessage) {
    if (msg.t === 'snap') this.onSnapshot(msg);
    else if (msg.t === 'result') this.result = { rank: msg.rank, kills: msg.kills, cubes: msg.cubes, winner: msg.winner, wins: msg.wins };
  }

  update(dt: number, intent: PlayerIntent) {
    const me = this.me;
    const now = performance.now() / 1000;

    // Latch one-shot actions until the next input tick goes out.
    if (intent.fire) this.wantFire = true;
    if (intent.superFire) this.wantSuper = true;
    if (intent.ability) this.wantAbility = true;
    if (intent.prop) this.wantProp = intent.prop;

    this.acc += dt;
    while (this.acc >= TICK) {
      this.acc -= TICK;
      const input: InputMessage = {
        t: 'input',
        seq: ++this.seq,
        mx: round3(intent.moveX),
        my: round3(intent.moveY),
        ax: round3(intent.aimX),
        ay: round3(intent.aimY),
        f: this.wantFire ? 1 : 0,
        s: this.wantSuper ? 1 : 0,
        q: this.wantAbility ? 1 : 0,
      };
      if (this.wantProp) input.p = PROP_KINDS.indexOf(this.wantProp);
      this.wantFire = false;
      this.wantSuper = false;
      this.wantAbility = false;
      this.wantProp = null;
      this.conn.send(input);
      this.pending.push(input);
      this.prevPred = { ...this.pred };
      if (me.alive) {
        // While dashing the server moves the hand; reconcile picks up where it lands.
        if (!this.world.isDashing(me) && this.world.canMove(me)) {
          this.world.moveBody(this.pred, input.mx, input.my, TICK, this.world.speedScale(me));
        }
        // Prop hunt hiders don't shoot: their trigger swaps their block, which the server decides.
        if (!this.world.propHunt || this.world.isSeeker(me)) this.predictShot(input, now);
      }
    }

    if (me.alive && !this.world.canMove(me)) {
      // Asleep under the sleep mask, or between prop hunt rounds: stay where the server put you.
      me.x = this.pred.x;
      me.y = this.pred.y;
      this.prevPred = { ...this.pred };
      me.moveX = me.moveY = 0;
      this.interpolateOthers(now);
      this.extrapolateBullets(now);
      return;
    }
    if (me.alive) {
      // Blend between the last two predicted ticks for smooth 60fps+ motion.
      const a = this.acc / TICK;
      me.x = this.prevPred.x + (this.pred.x - this.prevPred.x) * a;
      me.y = this.prevPred.y + (this.pred.y - this.prevPred.y) * a;
      me.moveX = intent.moveX;
      me.moveY = intent.moveY;
      if (Math.hypot(intent.aimX, intent.aimY) > 0.001) me.facing = Math.atan2(intent.aimY, intent.aimX);
      else if (Math.hypot(intent.moveX, intent.moveY) > 0.1) me.facing = Math.atan2(intent.moveY, intent.moveX);
    }

    this.interpolateOthers(now);
    this.extrapolateBullets(now);
  }

  dispose() {
    this.conn.send({ t: 'leave' });
  }

  /** Kick the hand back the instant you shoot instead of waiting for the server. */
  private predictShot(input: InputMessage, now: number) {
    const me = this.me;
    if (input.s && me.superCharge >= 1) {
      this.world.events.push({ type: 'shot', brawlerId: me.id, isSuper: true });
      me.superCharge = 0;
      this.lastLocalShot = now;
      return;
    }
    // Rapid fire shoots faster and uses no ammo.
    const rapid = this.world.isRapidFiring(me);
    const cooldown = rapid ? RAPID_FIRE_SHOT_COOLDOWN : ammoOf(me).cooldown;
    if (input.f && (rapid || this.predictedAmmo >= 1) && now - this.lastLocalShot >= cooldown) {
      this.world.events.push({ type: 'shot', brawlerId: me.id, isSuper: false });
      if (!rapid) this.predictedAmmo -= 1;
      me.ammo = this.predictedAmmo;
      this.lastLocalShot = now;
    }
  }

  private onSnapshot(snap: Snapshot) {
    const now = performance.now() / 1000;
    const offset = snap.time - now;
    // Track the server clock, leaning toward the fastest-arriving packets.
    this.clockOffset = this.clockOffset === null ? offset : Math.max(offset, this.clockOffset - 0.002);
    this.snaps.push({ snap, at: now });
    if (this.snaps.length > SNAPSHOT_BUFFER) this.snaps.shift();

    const w = this.world;
    w.time = snap.time;
    w.zoneHalfSize = snap.zone;
    const alive = new Set(snap.alive);
    for (const b of w.brawlers) b.alive = alive.has(b.id);
    if (snap.ph) {
      w.propHunt = snap.ph;
      for (const b of w.brawlers) b.roundWins = snap.ph.wins[b.id] ?? 0;
    }
    const standing = w.brawlers.filter((b) => b.alive);
    // Prop hunt says who won in the result message; a lone seeker between rounds hasn't won anything.
    if (!w.propHunt && standing.length > 0 && standing.every((b) => b.team === standing[0].team)) {
      w.winnerId = standing[0].id;
      w.winnerTeam = standing[0].team;
    }

    this.visibleIds = new Set(snap.b.map((b) => b.id));
    for (const s of snap.b) {
      const b = w.brawlers.find((x) => x.id === s.id);
      if (!b) continue;
      b.hp = s.hp;
      b.maxHp = s.mhp;
      b.cubes = s.cubes;
      b.inBush = s.bush === 1;
      b.streak = s.stk;
      b.extraFingers = s.fg;
      // Effects arrive as on/off flags; open-ended times keep the World checks working.
      b.shieldUntil = s.fx & FX_SHIELD ? Infinity : 0;
      b.rapidUntil = s.fx & FX_RAPID ? Infinity : 0;
      b.dashUntil = s.fx & FX_DASH ? Infinity : 0;
      b.burnUntil = s.fx & FX_BURN ? Infinity : 0;
      b.chillUntil = s.fx & FX_CHILL ? Infinity : 0;
      b.ammoKind = kindAt(s.ak);
      b.ammoUntil = s.au ?? (b.ammoKind === 'normal' ? 0 : Infinity);
      b.prop = s.pk !== undefined ? (PROP_KINDS[s.pk] ?? null) : null;
      if (s.id !== this.playerId) {
        b.moveX = s.mx;
        b.moveY = s.my;
        continue;
      }
      b.superCharge = s.sup ?? 0;
      if (s.ar) b.abilityReadyAt = { dash: s.ar[0], shield: s.ar[1], rapidFire: s.ar[2] };
      b.abilityLockUntil = s.al ?? 0;
      this.predictedAmmo = s.ammo ?? 0;
      b.ammo = this.predictedAmmo;
      this.reconcile(s.x, s.y, snap.ack);
    }

    w.cubes = snap.cubes.map(([id, x, y]) => ({ id, x, y, alive: true }));
    w.fingers = snap.fingers.map(([id, x, y, fromId]) => ({ id, x, y, fromId, alive: true }));
    w.ammoPickups = (snap.ammo ?? []).map(([id, x, y, k]) => ({ id, x, y, kind: kindAt(k), alive: true }));

    for (const e of snap.ev) {
      if (e.type === 'shot' && e.brawlerId === this.playerId) continue; // already shown locally
      if (e.type === 'crateBreak') w.breakCrate(e.crateId);
      if (e.type === 'shot') {
        const b = w.brawlers.find((x) => x.id === e.brawlerId);
        if (b) b.lastShotAt = w.time;
      }
      w.events.push(e);
    }
  }

  /** Snap the prediction to the server's answer and replay inputs it hasn't seen yet. */
  private reconcile(x: number, y: number, ack: number) {
    this.pending = this.pending.filter((p) => p.seq > ack);
    const corrected = { x, y };
    const scale = this.world.speedScale(this.me);
    if (this.world.canMove(this.me)) for (const p of this.pending) this.world.moveBody(corrected, p.mx, p.my, TICK, scale);
    const error = Math.hypot(corrected.x - this.pred.x, corrected.y - this.pred.y);
    this.stats.snapshots++;
    if (error > 0.01) {
      this.stats.corrections++;
      this.stats.maxError = Math.max(this.stats.maxError, error);
      // Shift both ends of the blend so small corrections don't pop.
      this.prevPred.x += corrected.x - this.pred.x;
      this.prevPred.y += corrected.y - this.pred.y;
      this.pred = corrected;
    }
  }

  private interpolateOthers(now: number) {
    if (this.clockOffset === null || this.snaps.length === 0) return;
    const renderTime = now + this.clockOffset - INTERP_DELAY;
    let older = this.snaps[0];
    let newer = this.snaps[this.snaps.length - 1];
    for (let i = this.snaps.length - 1; i > 0; i--) {
      if (this.snaps[i - 1].snap.time <= renderTime) {
        older = this.snaps[i - 1];
        newer = this.snaps[i];
        break;
      }
    }
    const span = newer.snap.time - older.snap.time;
    const t = span > 0 ? Math.max(0, Math.min(1, (renderTime - older.snap.time) / span)) : 1;
    const before = new Map(older.snap.b.map((b) => [b.id, b]));
    for (const s of newer.snap.b) {
      if (s.id === this.playerId) continue;
      const b = this.world.brawlers.find((x) => x.id === s.id);
      if (!b) continue;
      const p = before.get(s.id);
      if (!p) {
        b.x = s.x;
        b.y = s.y;
        b.facing = s.f;
        continue;
      }
      b.x = p.x + (s.x - p.x) * t;
      b.y = p.y + (s.y - p.y) * t;
      const df = Math.atan2(Math.sin(s.f - p.f), Math.cos(s.f - p.f));
      b.facing = p.f + df * t;
    }
  }

  /** Bullets fly in straight lines, so project them forward from the newest snapshot. */
  private extrapolateBullets(now: number) {
    const latest = this.snaps[this.snaps.length - 1];
    if (!latest) return;
    const age = Math.min(0.15, now - latest.at);
    this.world.bullets = latest.snap.bul.map((u) => {
      const kind = kindAt(u.k);
      const speed = u.sup ? SUPER.speed : AMMO[kind].speed;
      return {
        id: u.id,
        ownerId: 0,
        team: -1,
        x: u.x + u.dx * speed * age,
        y: u.y + u.dy * speed * age,
        dx: u.dx,
        dy: u.dy,
        speed,
        travelled: 0,
        range: 0,
        damage: 0,
        isSuper: u.sup === 1,
        kind,
        bouncesLeft: 0,
        chargeShare: 0,
        alive: true,
      };
    });
  }
}

function kindAt(index: number | undefined): AmmoKind {
  return AMMO_KINDS[index ?? 0] ?? 'normal';
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}

function fromWire(w: WireLook, topper: TopperId): PlayerLook {
  return {
    color: w.color,
    topper,
    glove: isGloveId(w.glove) ? w.glove : DEFAULT_LOOK.glove,
    sleeve: w.sleeve ?? DEFAULT_LOOK.sleeve,
  };
}
