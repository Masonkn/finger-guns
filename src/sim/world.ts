import {
  ABILITY,
  ABILITY_LOCKOUT,
  ABILITY_ORDER,
  AMMO,
  AMMO_PICKUP,
  AbilityKind,
  AmmoKind,
  AmmoStats,
  BRAWLER,
  BlockChoice,
  BURN,
  CHILL,
  BULLET,
  CRATE,
  DASH_SPEED_MULTIPLIER,
  FINGERS,
  GameMode,
  MAP_SIZE,
  PICKUP_AMMO_KINDS,
  POWER_CUBE,
  PROP_HUNT,
  PROP_KINDS,
  PropKind,
  RAPID_FIRE_SHOT_COOLDOWN,
  STREAK,
  SUPER,
  TeamSize,
  ZONE,
} from './config';
import { GameMap, Tile, generateMap, tileAt } from './map';
import { mulberry32 } from './rng';

export interface Command {
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  fire: boolean;
  superFire: boolean;
  /** Start an ability this step. 'auto' picks the best unlocked one that is ready. */
  ability?: AbilityKind | 'auto' | null;
  /** Movement was already applied by the caller (the server replays each client input). */
  skipMove?: boolean;
  /** Prop hunt: a hider picks the block to look like (only while hiding, when blocks are picked). */
  prop?: PropKind | null;
}

export interface PlayerSlot {
  name: string;
  isBot: boolean;
  team: number; // 0-based; hands on the same team can't hurt each other
}

export interface Point {
  x: number;
  y: number;
}

export interface Brawler {
  id: number;
  name: string;
  isBot: boolean;
  team: number;
  x: number;
  y: number;
  moveX: number;
  moveY: number;
  facing: number; // radians, 0 = +x
  hp: number;
  maxHp: number;
  ammo: number;
  lastShotAt: number;
  lastCombatAt: number; // last time it shot or was hit, for regen
  superCharge: number; // 0..1
  cubes: number;
  alive: boolean;
  inBush: boolean;
  rank: number; // final placing of this hand's team, 0 while the team is still in
  kills: number;
  streak: number; // knockouts since this brawler last died
  /** Extra fingers beyond the index finger, each the id of the brawler it was taken from. */
  extraFingers: number[];
  lastHitAt: number; // last time a bullet reached it (blocked or not)
  abilityReadyAt: Record<AbilityKind, number>;
  abilityLockUntil: number;
  dashUntil: number;
  dashX: number;
  dashY: number;
  shieldUntil: number;
  rapidUntil: number;
  /** Bullet type, and when it runs out and goes back to normal. */
  ammoKind: AmmoKind;
  ammoUntil: number;
  burnUntil: number;
  burnById: number | null; // who set it on fire, for the knockout
  chillUntil: number;
  /** Prop hunt: the block a hider is disguised as; null for the seeker and in showdown. */
  prop: PropKind | null;
  lastRerollAt: number;
  roundWins: number; // prop hunt rounds this hand was the last one found in (or never found)
  hiddenTime: number; // seconds spent hidden while the seeker was looking, the tie-breaker
}

export type PropHuntPhase = 'hide' | 'seek' | 'over';

/** Prop hunt's round state. Plain data, so the server can send it to clients as it is. */
export interface PropHuntState {
  blocks: BlockChoice;
  round: number; // 1-based
  rounds: number;
  phase: PropHuntPhase;
  phaseEndsAt: number; // world time
  seekerId: number;
  found: number[]; // hiders found this round, in order
  roundWinners: number[]; // who won the round that just ended
  nextSeekerId: number | null; // the first hider found is it next round
  wins: Record<number, number>; // brawler id -> rounds won
}

export interface Bullet {
  id: number;
  ownerId: number;
  team: number; // the shooter's team; bullets pass through teammates
  x: number;
  y: number;
  dx: number;
  dy: number;
  speed: number;
  travelled: number;
  range: number;
  damage: number;
  isSuper: boolean;
  kind: AmmoKind;
  bouncesLeft: number;
  chargeShare: number; // fraction of a normal hit's super charge this bullet gives
  alive: boolean;
}

export interface Crate {
  id: number;
  x: number; // tile coords
  y: number;
  hp: number;
  alive: boolean;
}

export interface Cube {
  id: number;
  x: number;
  y: number;
  alive: boolean;
}

/** A box on the ground that swaps your bullets for a special type for a while. */
export interface AmmoPickup {
  id: number;
  kind: AmmoKind;
  x: number;
  y: number;
  alive: boolean;
}

/** A finger dropped on knockout. `fromId` is the brawler it originally belonged to. */
export interface FingerDrop {
  id: number;
  fromId: number;
  x: number;
  y: number;
  alive: boolean;
}

export type GameEvent =
  | { type: 'shot'; brawlerId: number; isSuper: boolean }
  | { type: 'hit'; x: number; y: number; targetId: number; damage: number; blocked?: boolean; kind?: AmmoKind }
  | { type: 'crateHit'; crateId: number }
  | { type: 'crateBreak'; crateId: number; x: number; y: number }
  | { type: 'wallHit'; x: number; y: number }
  | { type: 'death'; brawlerId: number; killerId: number | null; x: number; y: number }
  // sharedBy: in team modes every pickup is copied to living teammates; this names who picked it up
  | { type: 'pickup'; brawlerId: number; cubeId: number; sharedBy?: number }
  | { type: 'fingerDrop'; fingerId: number; fromId: number; x: number; y: number }
  | { type: 'fingerPickup'; brawlerId: number; fingerId: number; fromId: number; fingers: number; sharedBy?: number }
  | { type: 'ammoPickup'; brawlerId: number; pickupId: number; kind: AmmoKind }
  | { type: 'ability'; brawlerId: number; ability: AbilityKind }
  | { type: 'abilityUnlock'; brawlerId: number; ability: AbilityKind }
  // Prop hunt
  | { type: 'found'; brawlerId: number; byId: number; x: number; y: number }
  | { type: 'disguise'; brawlerId: number; prop: PropKind; x: number; y: number }
  | { type: 'roundStart'; round: number; seekerId: number }
  | { type: 'seekStart' }
  | { type: 'roundOver'; winners: number[]; nextSeekerId: number | null };

/** Who won, for the results screen: a name, or a team's names. Null until decided. */
export function winnerLabel(world: World): string | null {
  if (world.winnerTeam === null) return null;
  const names = world.brawlers.filter((b) => b.team === world.winnerTeam).map((b) => b.name);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}` : names[0];
}

/** Number of fingers on a brawler's gun, which is also bullets per normal shot. */
export function fingerCount(b: Brawler): number {
  return 1 + b.extraFingers.length;
}

/** The bullets a brawler is shooting right now. */
export function ammoOf(b: Brawler): AmmoStats {
  return AMMO[b.ammoKind];
}

export function abilityUnlocked(b: Brawler, kind: AbilityKind): boolean {
  return b.streak >= ABILITY[kind].unlockStreak;
}

export interface AbilityStatus {
  kind: AbilityKind;
  ready: boolean;
  remaining: number; // seconds until usable
  total: number; // cooldown length, for drawing the cooldown ring
}

/**
 * The ability that Q / the ability button would use now: the best unlocked one that is
 * ready, otherwise the one that comes off cooldown first. Null when nothing is unlocked.
 */
export function nextAbility(b: Brawler, time: number): AbilityStatus | null {
  let soonest: AbilityStatus | null = null;
  for (const kind of ABILITY_ORDER) {
    if (!abilityUnlocked(b, kind)) continue;
    const readyAt = Math.max(b.abilityReadyAt[kind], b.abilityLockUntil);
    const remaining = Math.max(0, readyAt - time);
    const status: AbilityStatus = { kind, ready: remaining <= 0, remaining, total: ABILITY[kind].cooldown };
    if (status.ready) return status;
    if (!soonest || remaining < soonest.remaining) soonest = status;
  }
  return soonest;
}

export class World {
  readonly map: GameMap;
  time = 0;
  brawlers: Brawler[] = [];
  bullets: Bullet[] = [];
  crates: Crate[] = [];
  cubes: Cube[] = [];
  fingers: FingerDrop[] = [];
  ammoPickups: AmmoPickup[] = [];
  events: GameEvent[] = [];
  zoneHalfSize = MAP_SIZE / 2;
  /** Set when one team is left: a surviving hand of the winning team, and that team. */
  winnerId: number | null = null;
  winnerTeam: number | null = null;
  /** Set in prop hunt only. */
  propHunt: PropHuntState | null = null;
  private nextId = 1;
  private crateGrid: Int32Array; // tile index -> crate id, 0 when none
  private rand: () => number; // for loot only; the arena itself comes from generateMap
  private nextAmmoSpawn = AMMO_PICKUP.respawnEvery;

  constructor(
    seed: number,
    players: PlayerSlot[],
    readonly teamSize: TeamSize = 1,
    readonly mode: GameMode = 'showdown',
    blocks: BlockChoice = 'pick',
  ) {
    this.map = generateMap(seed, teamSize);
    this.crateGrid = new Int32Array(this.map.size * this.map.size);
    for (const t of this.map.crateTiles) {
      const crate: Crate = { id: this.nextId++, x: t.x, y: t.y, hp: CRATE.hp, alive: true };
      this.crates.push(crate);
      this.crateGrid[t.y * this.map.size + t.x] = crate.id;
    }
    const placed = new Map<number, number>(); // team -> hands spawned so far
    for (const p of players) {
      const n = placed.get(p.team) ?? 0;
      placed.set(p.team, n + 1);
      const s = this.map.spawns[p.team * teamSize + n];
      this.brawlers.push({
        id: this.nextId++,
        name: p.name,
        isBot: p.isBot,
        team: p.team,
        x: s.x,
        y: s.y,
        moveX: 0,
        moveY: 0,
        facing: Math.atan2(MAP_SIZE / 2 - s.y, MAP_SIZE / 2 - s.x),
        hp: BRAWLER.maxHp,
        maxHp: BRAWLER.maxHp,
        ammo: BRAWLER.maxAmmo,
        lastShotAt: -10,
        lastCombatAt: -10,
        superCharge: 0,
        cubes: 0,
        alive: true,
        inBush: false,
        rank: 0,
        kills: 0,
        streak: 0,
        extraFingers: [],
        lastHitAt: -10,
        abilityReadyAt: { dash: 0, shield: 0, rapidFire: 0 },
        abilityLockUntil: 0,
        dashUntil: 0,
        dashX: 0,
        dashY: 0,
        shieldUntil: 0,
        rapidUntil: 0,
        ammoKind: 'normal',
        ammoUntil: 0,
        burnUntil: 0,
        burnById: null,
        chillUntil: 0,
        prop: null,
        lastRerollAt: -10,
        roundWins: 0,
        hiddenTime: 0,
      });
    }
    // After the brawlers, so their ids match what an online client builds from the same seed.
    this.rand = mulberry32(seed ^ 0x5bd1e995);
    if (mode === 'propHunt') {
      this.startPropHunt(blocks);
      return;
    }
    for (let i = 0; i < AMMO_PICKUP.startCount; i++) this.spawnAmmoPickup();
  }

  get aliveCount(): number {
    let n = 0;
    for (const b of this.brawlers) if (b.alive) n++;
    return n;
  }

  /** Teams with at least one hand still standing. */
  get aliveTeamCount(): number {
    const teams = new Set<number>();
    for (const b of this.brawlers) if (b.alive) teams.add(b.team);
    return teams.size;
  }

  isTeamAlive(team: number): boolean {
    return this.brawlers.some((b) => b.alive && b.team === team);
  }

  /** True for walls and unbroken crates: anything that blocks movement and bullets. */
  isSolid(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.map.size || ty >= this.map.size) return true;
    const i = ty * this.map.size + tx;
    return this.map.tiles[i] === Tile.Wall || this.crateGrid[i] !== 0;
  }

  crateAt(tx: number, ty: number): Crate | undefined {
    const id = this.crateGrid[ty * this.map.size + tx];
    return id ? this.crates.find((c) => c.id === id) : undefined;
  }

  /** Whether `viewer` can currently see `target` (bushes hide brawlers unless close or shooting). */
  canSee(viewer: Brawler, target: Brawler): boolean {
    if (viewer.team === target.team) return true;
    const ph = this.propHunt;
    if (ph) {
      // Hiders see everything; the seeker sees nothing at all while the sleep mask is on.
      if (viewer.id !== ph.seekerId || target.id === ph.seekerId) return true;
      if (ph.phase === 'hide') return false;
    }
    if (!target.inBush) return true;
    if (this.time - target.lastShotAt < 0.6) return true;
    return Math.hypot(viewer.x - target.x, viewer.y - target.y) < BRAWLER.bushRevealDistance;
  }

  /** Whether anyone standing on `team` can see `target`: teammates share what they spot. */
  teamCanSee(team: number, target: Brawler): boolean {
    if (target.team === team) return true;
    for (const b of this.brawlers) {
      if (b.alive && b.team === team && this.canSee(b, target)) return true;
    }
    return false;
  }

  /** Straight-line visibility check that walls and crates block. */
  hasLineOfSight(ax: number, ay: number, bx: number, by: number): boolean {
    const dist = Math.hypot(bx - ax, by - ay);
    const steps = Math.ceil(dist / 0.25);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.isSolid(Math.floor(ax + (bx - ax) * t), Math.floor(ay + (by - ay) * t))) return false;
    }
    return true;
  }

  isOutsideZone(x: number, y: number, margin = 0): boolean {
    const c = MAP_SIZE / 2;
    const h = this.zoneHalfSize - margin;
    return Math.abs(x - c) > h || Math.abs(y - c) > h;
  }

  damageMultiplier(b: Brawler): number {
    return 1 + b.cubes * POWER_CUBE.damageBonus + Math.min(b.streak, STREAK.maxBonusLevel) * STREAK.damageBonus;
  }

  isDashing(b: Brawler): boolean {
    return this.time < b.dashUntil;
  }

  isShielded(b: Brawler): boolean {
    return this.time < b.shieldUntil;
  }

  isRapidFiring(b: Brawler): boolean {
    return this.time < b.rapidUntil;
  }

  isBurning(b: Brawler): boolean {
    return this.time < b.burnUntil;
  }

  isChilled(b: Brawler): boolean {
    return this.time < b.chillUntil;
  }

  /** Walking speed multiplier (ice slows you). */
  speedScale(b: Brawler): number {
    return this.isChilled(b) ? CHILL.speedMultiplier : 1;
  }

  isSeeker(b: Brawler): boolean {
    return this.propHunt?.seekerId === b.id;
  }

  /** False for the seeker while they sleep, and for everyone between prop hunt rounds. */
  canMove(b: Brawler): boolean {
    const ph = this.propHunt;
    if (!ph) return true;
    if (ph.phase === 'over') return false;
    return !(ph.phase === 'hide' && b.id === ph.seekerId);
  }

  abilityReady(b: Brawler, kind: AbilityKind): boolean {
    return abilityUnlocked(b, kind) && this.time >= b.abilityReadyAt[kind] && this.time >= b.abilityLockUntil;
  }

  step(dt: number, commands: Map<number, Command>) {
    if (this.winnerId !== null) return;
    this.time += dt;
    if (this.propHunt) {
      this.stepPropHunt(dt, commands);
      return;
    }
    this.updateZone();

    for (const b of this.brawlers) {
      if (!b.alive) continue;
      const cmd = commands.get(b.id);
      if (cmd) this.applyCommand(b, cmd, dt);
      this.updateBrawler(b, dt);
    }
    this.updateBullets(dt);
    this.updateCubes();
    this.updateFingers();
    this.updateAmmoPickups(dt);

    if (this.aliveTeamCount <= 1) {
      // Nobody standing means the last team went down this very step; it placed first.
      const winner = this.brawlers.find((b) => b.alive) ?? this.brawlers.find((b) => b.rank === 1);
      if (winner) {
        for (const b of this.brawlers) if (b.team === winner.team) b.rank = 1;
        this.winnerId = winner.id;
        this.winnerTeam = winner.team;
      }
    }
  }

  private updateZone() {
    const t = Math.max(0, this.time - ZONE.startDelay) / ZONE.closeDuration;
    const k = Math.min(1, t);
    this.zoneHalfSize = MAP_SIZE / 2 - (MAP_SIZE / 2 - ZONE.minHalfSize) * k;
  }

  private applyCommand(b: Brawler, cmd: Command, dt: number) {
    if (this.propHunt) {
      this.applyPropHuntCommand(b, cmd, dt);
      return;
    }
    let mx = cmd.moveX;
    let my = cmd.moveY;
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    b.moveX = mx;
    b.moveY = my;

    const aimLen = Math.hypot(cmd.aimX, cmd.aimY);
    if (aimLen > 0.001) b.facing = Math.atan2(cmd.aimY, cmd.aimX);
    else if (len > 0.1) b.facing = Math.atan2(my, mx);

    if (cmd.ability) this.useAbility(b, cmd.ability);

    if (this.isDashing(b)) {
      b.moveX = b.dashX;
      b.moveY = b.dashY;
      const v = BRAWLER.speed * DASH_SPEED_MULTIPLIER * dt;
      this.moveWithCollision(b, b.dashX * v, b.dashY * v);
    } else if (!cmd.skipMove) {
      this.moveBody(b, mx, my, dt, this.speedScale(b));
    }

    if (cmd.superFire && b.superCharge >= 1) this.fireSuper(b);
    else if (cmd.fire) this.fire(b);
  }

  private useAbility(b: Brawler, which: AbilityKind | 'auto') {
    const kind = which === 'auto' ? nextAbility(b, this.time)?.kind : which;
    if (!kind || !this.abilityReady(b, kind)) return;
    b.abilityReadyAt[kind] = this.time + ABILITY[kind].cooldown;
    b.abilityLockUntil = this.time + ABILITY_LOCKOUT;
    const until = this.time + ABILITY[kind].duration;
    if (kind === 'dash') {
      // Dash the way you're moving, or the way you're facing when standing still.
      const len = Math.hypot(b.moveX, b.moveY);
      b.dashX = len > 0.1 ? b.moveX / len : Math.cos(b.facing);
      b.dashY = len > 0.1 ? b.moveY / len : Math.sin(b.facing);
      b.dashUntil = until;
    } else if (kind === 'shield') {
      b.shieldUntil = until;
    } else {
      b.rapidUntil = until;
      b.ammo = BRAWLER.maxAmmo;
    }
    this.events.push({ type: 'ability', brawlerId: b.id, ability: kind });
  }

  /**
   * Moves a brawler-sized circle by a (clamped) input direction for one step.
   * Public so the client can predict its own movement with the exact same rules.
   */
  moveBody(b: Point, moveX: number, moveY: number, dt: number, speedScale = 1) {
    let mx = moveX;
    let my = moveY;
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    const v = BRAWLER.speed * speedScale * dt;
    this.moveWithCollision(b, mx * v, my * v);
  }

  private moveWithCollision(b: Point, dx: number, dy: number) {
    b.x += dx;
    this.resolveCollisions(b);
    b.y += dy;
    this.resolveCollisions(b);
  }

  private resolveCollisions(b: Point) {
    const r = BRAWLER.radius;
    const minX = Math.floor(b.x - r);
    const maxX = Math.floor(b.x + r);
    const minY = Math.floor(b.y - r);
    const maxY = Math.floor(b.y + r);
    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        if (!this.isSolid(tx, ty)) continue;
        const cx = Math.max(tx, Math.min(b.x, tx + 1));
        const cy = Math.max(ty, Math.min(b.y, ty + 1));
        const ox = b.x - cx;
        const oy = b.y - cy;
        const d = Math.hypot(ox, oy);
        if (d >= r) continue;
        if (d > 1e-6) {
          b.x = cx + (ox / d) * r;
          b.y = cy + (oy / d) * r;
        } else {
          // Centre is inside the tile: push out along the shallowest axis.
          const left = b.x - tx;
          const right = tx + 1 - b.x;
          const top = b.y - ty;
          const bottom = ty + 1 - b.y;
          const m = Math.min(left, right, top, bottom);
          if (m === left) b.x = tx - r;
          else if (m === right) b.x = tx + 1 + r;
          else if (m === top) b.y = ty - r;
          else b.y = ty + 1 + r;
        }
      }
    }
  }

  private fire(b: Brawler) {
    const rapid = this.isRapidFiring(b);
    const ammo = ammoOf(b);
    const cooldown = rapid ? RAPID_FIRE_SHOT_COOLDOWN : ammo.cooldown;
    if ((!rapid && b.ammo < 1) || this.time - b.lastShotAt < cooldown) return;
    if (!rapid) b.ammo -= 1;
    b.lastShotAt = this.time;
    b.lastCombatAt = this.time;
    // Normal ammo shoots one bullet per finger; a shotgun shoots a wider spray. Fanned around the aim.
    const n = fingerCount(b);
    const count = ammo.pellets + ammo.pelletsPerFinger * (n - 1);
    const width = (count - 1) * FINGERS.spread + ammo.spread;
    const perBullet = (BULLET.damage * ammo.damage * (1 + FINGERS.damagePerExtraFinger * (n - 1))) / count;
    for (let i = 0; i < count; i++) {
      const a = b.facing + (count > 1 ? (i / (count - 1) - 0.5) * width : 0);
      this.spawnBullet(b, a, ammo.speed, ammo.range, perBullet, false, 1 / count, b.ammoKind, ammo.bounces);
    }
    this.events.push({ type: 'shot', brawlerId: b.id, isSuper: false });
  }

  private fireSuper(b: Brawler) {
    b.superCharge = 0;
    b.lastShotAt = this.time;
    b.lastCombatAt = this.time;
    for (let i = 0; i < SUPER.bullets; i++) {
      const a = b.facing - SUPER.spread / 2 + (SUPER.spread * i) / (SUPER.bullets - 1);
      this.spawnBullet(b, a, SUPER.speed, SUPER.range, SUPER.damage, true);
    }
    this.events.push({ type: 'shot', brawlerId: b.id, isSuper: true });
  }

  private spawnBullet(
    b: Brawler,
    angle: number,
    speed: number,
    range: number,
    dmg: number,
    isSuper: boolean,
    chargeShare = 1,
    kind: AmmoKind = 'normal',
    bounces = 0,
  ) {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    this.bullets.push({
      id: this.nextId++,
      ownerId: b.id,
      team: b.team,
      x: b.x + dx * (BRAWLER.radius + 0.1),
      y: b.y + dy * (BRAWLER.radius + 0.1),
      dx,
      dy,
      speed,
      travelled: 0,
      range,
      damage: dmg * this.damageMultiplier(b),
      isSuper,
      kind,
      bouncesLeft: bounces,
      chargeShare,
      alive: true,
    });
  }

  private updateBrawler(b: Brawler, dt: number) {
    if (b.ammoKind !== 'normal' && this.time >= b.ammoUntil) b.ammoKind = 'normal';
    if (this.isBurning(b)) {
      b.lastCombatAt = this.time; // no healing while on fire
      if (!this.isShielded(b)) {
        const by = this.brawlers.find((o) => o.id === b.burnById) ?? null;
        this.damage(b, BURN.damagePerSecond * dt, by);
      }
      if (!b.alive) return;
    }
    if (b.ammo < BRAWLER.maxAmmo) {
      b.ammo = Math.min(BRAWLER.maxAmmo, b.ammo + dt / BRAWLER.reloadTime);
    }
    if (this.time - b.lastCombatAt > BRAWLER.regenDelay && b.hp < b.maxHp) {
      b.hp = Math.min(b.maxHp, b.hp + b.maxHp * BRAWLER.regenPerSecond * dt);
    }
    b.inBush = tileAt(this.map, b.x, b.y) === Tile.Bush;

    if (this.isOutsideZone(b.x, b.y)) {
      b.lastCombatAt = this.time;
      this.damage(b, ZONE.damagePerSecond * dt, null);
    }
  }

  private updateBullets(dt: number) {
    for (const bullet of this.bullets) {
      if (!bullet.alive) continue;
      const dist = bullet.speed * dt;
      const steps = Math.max(1, Math.ceil(dist / 0.2));
      const stepLen = dist / steps;
      for (let s = 0; s < steps && bullet.alive; s++) {
        const px = bullet.x;
        const py = bullet.y;
        bullet.x += bullet.dx * stepLen;
        bullet.y += bullet.dy * stepLen;
        bullet.travelled += stepLen;
        this.checkBulletHit(bullet, px, py);
        if (bullet.travelled >= bullet.range) bullet.alive = false;
      }
    }
    this.bullets = this.bullets.filter((b) => b.alive);
  }

  private checkBulletHit(bullet: Bullet, px: number, py: number) {
    const tx = Math.floor(bullet.x);
    const ty = Math.floor(bullet.y);
    if (this.isSolid(tx, ty)) {
      const crate = this.crateAt(tx, ty);
      if (!crate) this.events.push({ type: 'wallHit', x: bullet.x, y: bullet.y });
      if (!crate && bullet.bouncesLeft > 0) {
        this.bounce(bullet, px, py);
        return;
      }
      bullet.alive = false;
      // Crates can't be broken in prop hunt: they're hiding places, and hiders look like them.
      if (crate && !this.propHunt) this.damageCrate(crate, bullet);
      return;
    }
    const owner = this.brawlers.find((b) => b.id === bullet.ownerId);
    for (const b of this.brawlers) {
      if (!b.alive || b.team === bullet.team) continue;
      if (Math.hypot(b.x - bullet.x, b.y - bullet.y) > BRAWLER.radius + BULLET.radius) continue;
      bullet.alive = false;
      if (this.propHunt) {
        if (owner) this.findHider(b, owner);
        return;
      }
      b.lastCombatAt = this.time;
      b.lastHitAt = this.time;
      if (this.isShielded(b)) {
        this.events.push({ type: 'hit', x: bullet.x, y: bullet.y, targetId: b.id, damage: 0, blocked: true });
        return;
      }
      this.damage(b, bullet.damage, owner ?? null);
      this.events.push({ type: 'hit', x: bullet.x, y: bullet.y, targetId: b.id, damage: bullet.damage, kind: bullet.kind });
      if (b.alive && bullet.kind === 'fire') {
        b.burnUntil = this.time + BURN.duration;
        b.burnById = bullet.ownerId;
      }
      if (b.alive && bullet.kind === 'ice') b.chillUntil = this.time + CHILL.duration;
      if (owner && !bullet.isSuper) {
        owner.superCharge = Math.min(1, owner.superCharge + BRAWLER.superChargePerHit * bullet.chargeShare);
      }
      if (owner && bullet.isSuper) owner.superCharge = Math.min(1, owner.superCharge + 0.02);
      return;
    }
  }

  /** Reflects a bullet off the wall it just entered, back from where it came. */
  private bounce(bullet: Bullet, px: number, py: number) {
    const hitX = this.isSolid(Math.floor(bullet.x), Math.floor(py));
    const hitY = this.isSolid(Math.floor(px), Math.floor(bullet.y));
    if (hitX || !hitY) bullet.dx = -bullet.dx;
    if (hitY || !hitX) bullet.dy = -bullet.dy;
    bullet.x = px;
    bullet.y = py;
    bullet.bouncesLeft--;
  }

  private damageCrate(crate: Crate, bullet: Bullet) {
    crate.hp -= bullet.damage;
    this.events.push({ type: 'crateHit', crateId: crate.id });
    if (crate.hp > 0) return;
    this.breakCrate(crate.id);
    const cx = crate.x + 0.5;
    const cy = crate.y + 0.5;
    this.cubes.push({ id: this.nextId++, x: cx, y: cy, alive: true });
    this.events.push({ type: 'crateBreak', crateId: crate.id, x: cx, y: cy });
    if (this.rand() < AMMO_PICKUP.crateDropChance) {
      const a = this.rand() * Math.PI * 2;
      const p = { x: cx + Math.cos(a) * 0.8, y: cy + Math.sin(a) * 0.8 };
      this.pushOutOfWalls(p);
      this.ammoPickups.push({ id: this.nextId++, kind: this.randomAmmoKind(), x: p.x, y: p.y, alive: true });
    }
  }

  private randomAmmoKind(): AmmoKind {
    return PICKUP_AMMO_KINDS[Math.floor(this.rand() * PICKUP_AMMO_KINDS.length)];
  }

  /** Drops an ammo box on a random open tile inside the zone, away from where hands start. */
  private spawnAmmoPickup() {
    const size = this.map.size;
    for (let tries = 0; tries < 60; tries++) {
      const tx = Math.floor(this.rand() * size);
      const ty = Math.floor(this.rand() * size);
      const x = tx + 0.5;
      const y = ty + 0.5;
      if (this.map.tiles[ty * size + tx] !== Tile.Empty || this.isSolid(tx, ty)) continue;
      if (this.isOutsideZone(x, y, 2)) continue;
      if (this.time === 0 && this.map.spawns.some((s) => Math.hypot(s.x - x, s.y - y) < 4)) continue;
      if (this.ammoPickups.some((p) => Math.hypot(p.x - x, p.y - y) < 5)) continue;
      this.ammoPickups.push({ id: this.nextId++, kind: this.randomAmmoKind(), x, y, alive: true });
      return;
    }
  }

  private updateAmmoPickups(dt: number) {
    this.nextAmmoSpawn -= dt;
    if (this.nextAmmoSpawn <= 0) {
      this.nextAmmoSpawn = AMMO_PICKUP.respawnEvery;
      if (this.ammoPickups.length < AMMO_PICKUP.maxOnMap) this.spawnAmmoPickup();
    }
    for (const p of this.ammoPickups) {
      if (!p.alive) continue;
      for (const b of this.brawlers) {
        if (!b.alive) continue;
        if (Math.hypot(b.x - p.x, b.y - p.y) > AMMO_PICKUP.pickupRadius) continue;
        p.alive = false;
        // A new type replaces the old one; the same type tops the timer back up.
        b.ammoKind = p.kind;
        b.ammoUntil = this.time + AMMO_PICKUP.duration;
        this.events.push({ type: 'ammoPickup', brawlerId: b.id, pickupId: p.id, kind: p.kind });
        break;
      }
    }
    this.ammoPickups = this.ammoPickups.filter((p) => p.alive);
  }

  /** Removes a crate from play (also used by clients replaying server events). */
  breakCrate(id: number) {
    const crate = this.crates.find((c) => c.id === id);
    if (!crate || !crate.alive) return;
    crate.alive = false;
    crate.hp = 0;
    this.crateGrid[crate.y * this.map.size + crate.x] = 0;
  }

  private damage(b: Brawler, amount: number, attacker: Brawler | null) {
    if (!b.alive) return;
    b.hp -= amount;
    if (b.hp > 0) return;
    b.hp = 0;
    b.alive = false;
    // A team places when its last hand goes down.
    if (!this.isTeamAlive(b.team)) {
      const rank = this.aliveTeamCount + 1;
      for (const o of this.brawlers) if (o.team === b.team) o.rank = rank;
    }
    b.streak = 0;
    b.burnUntil = 0;
    b.chillUntil = 0;
    if (attacker) this.rewardKill(attacker);
    // Drop collected cubes (at least one) for whoever wins the fight.
    const drops = Math.max(1, b.cubes);
    for (let i = 0; i < drops; i++) {
      const a = (i / drops) * Math.PI * 2;
      const r = drops > 1 ? 0.6 : 0;
      this.cubes.push({ id: this.nextId++, x: b.x + Math.cos(a) * r, y: b.y + Math.sin(a) * r, alive: true });
    }
    // Drop the victim's own finger plus every extra finger they had collected.
    const fingers = [b.id, ...b.extraFingers];
    b.extraFingers = [];
    const spin = this.time * 1.7; // vary the layout a little between deaths
    fingers.forEach((fromId, i) => {
      const a = spin + (i / fingers.length) * Math.PI * 2 + Math.PI / 4;
      const r = FINGERS.dropRadius;
      const f: FingerDrop = { id: this.nextId++, fromId, x: b.x + Math.cos(a) * r, y: b.y + Math.sin(a) * r, alive: true };
      this.pushOutOfWalls(f);
      this.fingers.push(f);
      this.events.push({ type: 'fingerDrop', fingerId: f.id, fromId, x: f.x, y: f.y });
    });
    this.events.push({ type: 'death', brawlerId: b.id, killerId: attacker?.id ?? null, x: b.x, y: b.y });
  }

  private rewardKill(attacker: Brawler) {
    attacker.kills++;
    attacker.streak++;
    if (attacker.streak <= STREAK.maxBonusLevel) {
      attacker.maxHp += STREAK.hpBonus;
      attacker.hp += STREAK.hpBonus;
    }
    for (const kind of ABILITY_ORDER) {
      if (ABILITY[kind].unlockStreak === attacker.streak) {
        this.events.push({ type: 'abilityUnlock', brawlerId: attacker.id, ability: kind });
      }
    }
  }

  /** Keeps a dropped item off wall and crate tiles so it can always be picked up. */
  private pushOutOfWalls(p: { x: number; y: number }) {
    if (!this.isSolid(Math.floor(p.x), Math.floor(p.y))) return;
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const tx = Math.floor(p.x) + dx;
        const ty = Math.floor(p.y) + dy;
        if (this.isSolid(tx, ty)) continue;
        const d = Math.hypot(tx + 0.5 - p.x, ty + 0.5 - p.y);
        if (d < bestD) {
          bestD = d;
          best = { x: tx + 0.5, y: ty + 0.5 };
        }
      }
    }
    if (best) Object.assign(p, best);
  }

  private updateFingers() {
    for (const f of this.fingers) {
      if (!f.alive) continue;
      for (const b of this.brawlers) {
        if (!b.alive || fingerCount(b) >= FINGERS.max) continue;
        if (Math.hypot(b.x - f.x, b.y - f.y) > FINGERS.pickupRadius) continue;
        f.alive = false;
        // Teammates share: everyone standing on the team gets a finger too, up to the max.
        for (const o of [b, ...this.teammatesOf(b)]) {
          if (fingerCount(o) >= FINGERS.max) continue;
          o.extraFingers.push(f.fromId);
          const sharedBy = o === b ? undefined : b.id;
          this.events.push({ type: 'fingerPickup', brawlerId: o.id, fingerId: f.id, fromId: f.fromId, fingers: fingerCount(o), sharedBy });
        }
        break;
      }
    }
    this.fingers = this.fingers.filter((f) => f.alive);
  }

  private teammatesOf(b: Brawler): Brawler[] {
    return this.brawlers.filter((o) => o.alive && o.team === b.team && o !== b);
  }

  private updateCubes() {
    for (const cube of this.cubes) {
      if (!cube.alive) continue;
      for (const b of this.brawlers) {
        if (!b.alive) continue;
        if (Math.hypot(b.x - cube.x, b.y - cube.y) > POWER_CUBE.pickupRadius) continue;
        cube.alive = false;
        // Teammates share: everyone standing on the team gets the power cube too.
        for (const o of [b, ...this.teammatesOf(b)]) {
          o.cubes++;
          o.maxHp += POWER_CUBE.hpBonus;
          o.hp += POWER_CUBE.hpBonus;
          this.events.push({ type: 'pickup', brawlerId: o.id, cubeId: cube.id, sharedBy: o === b ? undefined : b.id });
        }
        break;
      }
    }
    this.cubes = this.cubes.filter((c) => c.alive);
  }

  // --- Prop hunt -------------------------------------------------------------

  private startPropHunt(blocks: BlockChoice) {
    // Power cubes and ammo boxes lie around doing nothing, so cube and box hiders have company.
    for (let i = 0; i < PROP_HUNT.decoyCubes; i++) {
      const p = this.randomOpenSpot();
      if (p) this.cubes.push({ id: this.nextId++, x: p.x, y: p.y, alive: true });
    }
    for (let i = 0; i < PROP_HUNT.decoyAmmo; i++) this.spawnAmmoPickup();
    const first = this.brawlers[Math.floor(this.rand() * this.brawlers.length)];
    this.propHunt = {
      blocks,
      round: 0,
      rounds: PROP_HUNT.rounds,
      phase: 'hide',
      phaseEndsAt: 0,
      seekerId: first.id,
      found: [],
      roundWinners: [],
      nextSeekerId: null,
      wins: {},
    };
    this.startRound(first.id);
  }

  /** An open tile centre away from the middle and from other loot, for decoys. */
  private randomOpenSpot(): Point | null {
    const size = this.map.size;
    for (let tries = 0; tries < 80; tries++) {
      const tx = Math.floor(this.rand() * size);
      const ty = Math.floor(this.rand() * size);
      const x = tx + 0.5;
      const y = ty + 0.5;
      if (this.map.tiles[ty * size + tx] !== Tile.Empty || this.isSolid(tx, ty)) continue;
      if (Math.hypot(x - MAP_SIZE / 2, y - MAP_SIZE / 2) < 4) continue;
      if ([...this.cubes, ...this.ammoPickups].some((p) => Math.hypot(p.x - x, p.y - y) < 4)) continue;
      return { x, y };
    }
    return null;
  }

  /** A random block, other than `not`. */
  private randomProp(not: PropKind | null): PropKind {
    const options = PROP_KINDS.filter((k) => k !== not);
    return options[Math.floor(this.rand() * options.length)];
  }

  /** Everyone back on their feet: the seeker asleep in the middle, hiders spread around the edge. */
  private startRound(seekerId: number) {
    const ph = this.propHunt!;
    ph.round++;
    ph.phase = 'hide';
    ph.phaseEndsAt = this.time + PROP_HUNT.hideTime;
    ph.seekerId = seekerId;
    ph.found = [];
    ph.nextSeekerId = null;
    this.bullets = [];
    const c = MAP_SIZE / 2;
    // Spawn spots in a different order each round, so nobody always starts in the same corner.
    const spots = [...this.map.spawns];
    for (let i = spots.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [spots[i], spots[j]] = [spots[j], spots[i]];
    }
    let n = 0;
    for (const b of this.brawlers) {
      const seeker = b.id === seekerId;
      const s = seeker ? { x: c, y: c } : spots[n++ % spots.length];
      b.x = s.x;
      b.y = s.y;
      b.moveX = 0;
      b.moveY = 0;
      b.facing = seeker ? Math.PI / 2 : Math.atan2(c - s.y, c - s.x);
      b.alive = true;
      b.hp = b.maxHp;
      b.ammo = BRAWLER.maxAmmo;
      b.lastShotAt = -10;
      b.lastHitAt = -10;
      b.lastRerollAt = -10;
      b.inBush = false;
      // Everyone starts disguised; with picked blocks they can change while hiding.
      b.prop = seeker ? null : this.randomProp(null);
    }
    this.events.push({ type: 'roundStart', round: ph.round, seekerId });
  }

  private stepPropHunt(dt: number, commands: Map<number, Command>) {
    const ph = this.propHunt!;
    for (const b of this.brawlers) {
      if (!b.alive) continue;
      const cmd = commands.get(b.id);
      if (cmd) this.applyCommand(b, cmd, dt);
      if (b.ammo < BRAWLER.maxAmmo) b.ammo = Math.min(BRAWLER.maxAmmo, b.ammo + dt / BRAWLER.reloadTime);
      b.inBush = tileAt(this.map, b.x, b.y) === Tile.Bush;
    }
    this.updateBullets(dt);

    if (ph.phase === 'hide') {
      if (this.time >= ph.phaseEndsAt) {
        ph.phase = 'seek';
        ph.phaseEndsAt = this.time + PROP_HUNT.seekTime;
        this.events.push({ type: 'seekStart' });
      }
    } else if (ph.phase === 'seek') {
      const seeker = this.brawlers.find((b) => b.id === ph.seekerId)!;
      for (const h of this.brawlers) {
        if (!h.alive || h === seeker) continue;
        h.hiddenTime += dt;
        if (Math.hypot(h.x - seeker.x, h.y - seeker.y) < PROP_HUNT.tagDistance) this.findHider(h, seeker);
      }
      const left = this.brawlers.filter((b) => b.alive && b !== seeker);
      // The last one found wins; if time runs out, everyone still hidden wins.
      if (left.length === 0) this.endRound(ph.found.slice(-1));
      else if (this.time >= ph.phaseEndsAt) this.endRound(left.map((b) => b.id));
    } else if (this.time >= ph.phaseEndsAt) {
      if (ph.round < ph.rounds) {
        const others = this.brawlers.filter((b) => b.id !== ph.seekerId);
        this.startRound(ph.nextSeekerId ?? others[Math.floor(this.rand() * others.length)].id);
      } else {
        this.finishPropHunt();
      }
    }
  }

  private applyPropHuntCommand(b: Brawler, cmd: Command, dt: number) {
    const ph = this.propHunt!;
    if (!this.canMove(b)) {
      b.moveX = 0;
      b.moveY = 0;
      return;
    }
    let mx = cmd.moveX;
    let my = cmd.moveY;
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    b.moveX = mx;
    b.moveY = my;
    if (Math.hypot(cmd.aimX, cmd.aimY) > 0.001) b.facing = Math.atan2(cmd.aimY, cmd.aimX);
    else if (len > 0.1) b.facing = Math.atan2(my, mx);
    if (!cmd.skipMove) this.moveBody(b, mx, my, dt);

    if (b.id === ph.seekerId) {
      if (cmd.fire) this.fire(b);
      return;
    }
    if (cmd.prop && ph.blocks === 'pick' && ph.phase === 'hide' && cmd.prop !== b.prop && PROP_KINDS.includes(cmd.prop)) {
      this.disguise(b, cmd.prop);
    } else if (cmd.fire && this.time - b.lastRerollAt >= PROP_HUNT.rerollCooldown) {
      // A hider's finger gun doesn't shoot: it turns them into a different block (and gives away a bush).
      b.lastRerollAt = this.time;
      b.lastShotAt = this.time;
      this.disguise(b, this.randomProp(b.prop));
    }
  }

  private disguise(b: Brawler, prop: PropKind) {
    b.prop = prop;
    this.events.push({ type: 'disguise', brawlerId: b.id, prop, x: b.x, y: b.y });
  }

  /** The seeker shot or touched a hider: they're out for the round. */
  private findHider(h: Brawler, by: Brawler) {
    const ph = this.propHunt!;
    if (ph.phase !== 'seek' || !h.alive || h.id === ph.seekerId || by.id !== ph.seekerId) return;
    h.alive = false;
    ph.found.push(h.id);
    if (ph.nextSeekerId === null) ph.nextSeekerId = h.id;
    by.kills++;
    this.events.push({ type: 'found', brawlerId: h.id, byId: by.id, x: h.x, y: h.y });
  }

  private endRound(winners: number[]) {
    const ph = this.propHunt!;
    ph.phase = 'over';
    ph.phaseEndsAt = this.time + PROP_HUNT.roundBreak;
    ph.roundWinners = winners;
    for (const id of winners) {
      ph.wins[id] = (ph.wins[id] ?? 0) + 1;
      const b = this.brawlers.find((o) => o.id === id);
      if (b) b.roundWins++;
    }
    this.bullets = [];
    this.events.push({ type: 'roundOver', winners, nextSeekerId: ph.nextSeekerId });
  }

  /** Most rounds won takes it; time spent hidden breaks ties. */
  private finishPropHunt() {
    const order = [...this.brawlers].sort((a, b) => b.roundWins - a.roundWins || b.hiddenTime - a.hiddenTime);
    order.forEach((b, i) => (b.rank = i + 1));
    this.winnerId = order[0].id;
    this.winnerTeam = order[0].team;
  }
}
