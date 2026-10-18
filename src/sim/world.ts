import { BRAWLER, BULLET, CRATE, MAP_SIZE, POWER_CUBE, SUPER, ZONE } from './config';
import { GameMap, Tile, generateMap, tileAt } from './map';

export interface Command {
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  fire: boolean;
  superFire: boolean;
  /** Movement was already applied by the caller (the server replays each client input). */
  skipMove?: boolean;
}

export interface PlayerSlot {
  name: string;
  isBot: boolean;
}

export interface Point {
  x: number;
  y: number;
}

export interface Brawler {
  id: number;
  name: string;
  isBot: boolean;
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
  rank: number;
  kills: number;
}

export interface Bullet {
  id: number;
  ownerId: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  speed: number;
  travelled: number;
  range: number;
  damage: number;
  isSuper: boolean;
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

export type GameEvent =
  | { type: 'shot'; brawlerId: number; isSuper: boolean }
  | { type: 'hit'; x: number; y: number; targetId: number; damage: number }
  | { type: 'crateHit'; crateId: number }
  | { type: 'crateBreak'; crateId: number; x: number; y: number }
  | { type: 'wallHit'; x: number; y: number }
  | { type: 'death'; brawlerId: number; killerId: number | null; x: number; y: number }
  | { type: 'pickup'; brawlerId: number; cubeId: number };

export class World {
  readonly map: GameMap;
  time = 0;
  brawlers: Brawler[] = [];
  bullets: Bullet[] = [];
  crates: Crate[] = [];
  cubes: Cube[] = [];
  events: GameEvent[] = [];
  zoneHalfSize = MAP_SIZE / 2;
  winnerId: number | null = null;
  private nextId = 1;
  private crateGrid: Int32Array; // tile index -> crate id, 0 when none

  constructor(seed: number, players: PlayerSlot[]) {
    this.map = generateMap(seed);
    this.crateGrid = new Int32Array(this.map.size * this.map.size);
    for (const t of this.map.crateTiles) {
      const crate: Crate = { id: this.nextId++, x: t.x, y: t.y, hp: CRATE.hp, alive: true };
      this.crates.push(crate);
      this.crateGrid[t.y * this.map.size + t.x] = crate.id;
    }
    players.forEach((p, i) => {
      const s = this.map.spawns[i];
      this.brawlers.push({
        id: this.nextId++,
        name: p.name,
        isBot: p.isBot,
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
      });
    });
  }

  get aliveCount(): number {
    let n = 0;
    for (const b of this.brawlers) if (b.alive) n++;
    return n;
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
    if (viewer.id === target.id) return true;
    if (!target.inBush) return true;
    if (this.time - target.lastShotAt < 0.6) return true;
    return Math.hypot(viewer.x - target.x, viewer.y - target.y) < BRAWLER.bushRevealDistance;
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
    return 1 + b.cubes * POWER_CUBE.damageBonus;
  }

  step(dt: number, commands: Map<number, Command>) {
    if (this.winnerId !== null) return;
    this.time += dt;
    this.updateZone();

    for (const b of this.brawlers) {
      if (!b.alive) continue;
      const cmd = commands.get(b.id);
      if (cmd) this.applyCommand(b, cmd, dt);
      this.updateBrawler(b, dt);
    }
    this.updateBullets(dt);
    this.updateCubes();

    if (this.aliveCount <= 1) {
      const winner = this.brawlers.find((b) => b.alive);
      if (winner) {
        winner.rank = 1;
        this.winnerId = winner.id;
      }
    }
  }

  private updateZone() {
    const t = Math.max(0, this.time - ZONE.startDelay) / ZONE.closeDuration;
    const k = Math.min(1, t);
    this.zoneHalfSize = MAP_SIZE / 2 - (MAP_SIZE / 2 - ZONE.minHalfSize) * k;
  }

  private applyCommand(b: Brawler, cmd: Command, dt: number) {
    let mx = cmd.moveX;
    let my = cmd.moveY;
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    b.moveX = mx;
    b.moveY = my;
    if (!cmd.skipMove) this.moveBody(b, mx, my, dt);

    const aimLen = Math.hypot(cmd.aimX, cmd.aimY);
    if (aimLen > 0.001) b.facing = Math.atan2(cmd.aimY, cmd.aimX);
    else if (len > 0.1) b.facing = Math.atan2(my, mx);

    if (cmd.superFire && b.superCharge >= 1) this.fireSuper(b);
    else if (cmd.fire) this.fire(b);
  }

  /**
   * Moves a brawler-sized circle by a (clamped) input direction for one step.
   * Public so the client can predict its own movement with the exact same rules.
   */
  moveBody(b: Point, moveX: number, moveY: number, dt: number) {
    let mx = moveX;
    let my = moveY;
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    b.x += mx * BRAWLER.speed * dt;
    this.resolveCollisions(b);
    b.y += my * BRAWLER.speed * dt;
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
    if (b.ammo < 1 || this.time - b.lastShotAt < BRAWLER.shotCooldown) return;
    b.ammo -= 1;
    b.lastShotAt = this.time;
    b.lastCombatAt = this.time;
    this.spawnBullet(b, b.facing, BULLET.speed, BULLET.range, BULLET.damage, false);
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

  private spawnBullet(b: Brawler, angle: number, speed: number, range: number, dmg: number, isSuper: boolean) {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    this.bullets.push({
      id: this.nextId++,
      ownerId: b.id,
      x: b.x + dx * (BRAWLER.radius + 0.1),
      y: b.y + dy * (BRAWLER.radius + 0.1),
      dx,
      dy,
      speed,
      travelled: 0,
      range,
      damage: dmg * this.damageMultiplier(b),
      isSuper,
      alive: true,
    });
  }

  private updateBrawler(b: Brawler, dt: number) {
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
        bullet.x += bullet.dx * stepLen;
        bullet.y += bullet.dy * stepLen;
        bullet.travelled += stepLen;
        this.checkBulletHit(bullet);
        if (bullet.travelled >= bullet.range) bullet.alive = false;
      }
    }
    this.bullets = this.bullets.filter((b) => b.alive);
  }

  private checkBulletHit(bullet: Bullet) {
    const tx = Math.floor(bullet.x);
    const ty = Math.floor(bullet.y);
    if (this.isSolid(tx, ty)) {
      bullet.alive = false;
      const crate = this.crateAt(tx, ty);
      if (crate) this.damageCrate(crate, bullet);
      else this.events.push({ type: 'wallHit', x: bullet.x, y: bullet.y });
      return;
    }
    const owner = this.brawlers.find((b) => b.id === bullet.ownerId);
    for (const b of this.brawlers) {
      if (!b.alive || b.id === bullet.ownerId) continue;
      if (Math.hypot(b.x - bullet.x, b.y - bullet.y) > BRAWLER.radius + BULLET.radius) continue;
      bullet.alive = false;
      b.lastCombatAt = this.time;
      this.damage(b, bullet.damage, owner ?? null);
      this.events.push({ type: 'hit', x: bullet.x, y: bullet.y, targetId: b.id, damage: bullet.damage });
      if (owner && !bullet.isSuper) owner.superCharge = Math.min(1, owner.superCharge + BRAWLER.superChargePerHit);
      if (owner && bullet.isSuper) owner.superCharge = Math.min(1, owner.superCharge + 0.02);
      return;
    }
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
    b.rank = this.aliveCount + 1;
    if (attacker) attacker.kills++;
    // Drop collected cubes (at least one) for whoever wins the fight.
    const drops = Math.max(1, b.cubes);
    for (let i = 0; i < drops; i++) {
      const a = (i / drops) * Math.PI * 2;
      const r = drops > 1 ? 0.6 : 0;
      this.cubes.push({ id: this.nextId++, x: b.x + Math.cos(a) * r, y: b.y + Math.sin(a) * r, alive: true });
    }
    this.events.push({ type: 'death', brawlerId: b.id, killerId: attacker?.id ?? null, x: b.x, y: b.y });
  }

  private updateCubes() {
    for (const cube of this.cubes) {
      if (!cube.alive) continue;
      for (const b of this.brawlers) {
        if (!b.alive) continue;
        if (Math.hypot(b.x - cube.x, b.y - cube.y) > POWER_CUBE.pickupRadius) continue;
        cube.alive = false;
        b.cubes++;
        b.maxHp += POWER_CUBE.hpBonus;
        b.hp += POWER_CUBE.hpBonus;
        this.events.push({ type: 'pickup', brawlerId: b.id, cubeId: cube.id });
        break;
      }
    }
    this.cubes = this.cubes.filter((c) => c.alive);
  }
}
