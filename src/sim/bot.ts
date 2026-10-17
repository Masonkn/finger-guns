import { BRAWLER, BULLET, MAP_SIZE } from './config';
import { Tile } from './map';
import type { Brawler, Command, World } from './world';

interface BotMemory {
  thinkIn: number;
  goal: { x: number; y: number } | null;
  path: { x: number; y: number }[];
  targetId: number | null;
  strafe: number;
  fireDelay: number;
  aimError: number;
  engageDistance: number;
  lastSeen: { x: number; y: number; at: number } | null;
}

const THINK_INTERVAL = 0.25;
// Early on bots mostly loot, like players do in Showdown.
const LOOT_PHASE = 25;

/**
 * Showdown-style bots: loot crates, grab cubes, fight whoever they can see,
 * duck into bushes when hurt, and keep ahead of the closing zone.
 */
export class BotBrain {
  private memory = new Map<number, BotMemory>();

  constructor(private world: World) {}

  command(bot: Brawler, dt: number): Command {
    let m = this.memory.get(bot.id);
    if (!m) {
      m = {
        thinkIn: Math.random() * THINK_INTERVAL,
        goal: null,
        path: [],
        targetId: null,
        strafe: Math.random() < 0.5 ? 1 : -1,
        fireDelay: 0,
        aimError: 0.12 + Math.random() * 0.18,
        engageDistance: 6 + Math.random() * 3,
        lastSeen: null,
      };
      this.memory.set(bot.id, m);
    }

    m.thinkIn -= dt;
    m.fireDelay -= dt;
    if (m.thinkIn <= 0) {
      m.thinkIn = THINK_INTERVAL;
      this.think(bot, m);
    }

    const cmd: Command = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, fire: false, superFire: false };
    this.followPath(bot, m, cmd);

    const target = m.targetId !== null ? this.world.brawlers.find((b) => b.id === m.targetId) : undefined;
    if (target && target.alive && this.world.canSee(bot, target)) {
      this.fight(bot, target, m, cmd);
    } else {
      this.shootCrateIfClose(bot, m, cmd);
    }
    return cmd;
  }

  private think(bot: Brawler, m: BotMemory) {
    const w = this.world;
    const center = MAP_SIZE / 2;

    // 1. Zone pressure beats everything.
    if (w.isOutsideZone(bot.x, bot.y, 1.5)) {
      const inset = Math.max(1, w.zoneHalfSize - 3);
      const gx = center + Math.max(-inset, Math.min(inset, bot.x - center));
      const gy = center + Math.max(-inset, Math.min(inset, bot.y - center));
      this.setGoal(bot, m, gx, gy);
      m.targetId = this.pickTarget(bot, m.engageDistance)?.id ?? null;
      return;
    }

    // 2. Pick a fight with the nearest visible enemy.
    // Hunt harder once only a few hands are left so the end game doesn't stall.
    const reach = w.time < LOOT_PHASE ? 4.5 : w.aliveCount <= 3 ? 14 : m.engageDistance;
    const target = this.pickTarget(bot, reach);
    m.targetId = target?.id ?? null;
    if (target) {
      m.lastSeen = { x: target.x, y: target.y, at: w.time };
      const hurt = bot.hp < bot.maxHp * 0.4 && target.hp > bot.hp * 0.7;
      if (hurt) {
        const bush = this.nearestBush(bot, target);
        if (bush) this.setGoal(bot, m, bush.x, bush.y);
        else this.setGoal(bot, m, bot.x + (bot.x - target.x), bot.y + (bot.y - target.y));
      } else {
        m.goal = null;
        m.path = [];
      }
      if (Math.random() < 0.08) m.strafe *= -1;
      return;
    }

    // 3. Grab nearby cubes.
    let bestCube: { x: number; y: number } | null = null;
    let bestD = 12;
    for (const c of w.cubes) {
      const d = Math.hypot(c.x - bot.x, c.y - bot.y);
      if (d < bestD && !w.isOutsideZone(c.x, c.y, 1)) {
        bestD = d;
        bestCube = c;
      }
    }
    if (bestCube) {
      this.setGoal(bot, m, bestCube.x, bestCube.y);
      return;
    }

    // 4. Chase the last place an enemy was seen.
    if (m.lastSeen && w.time - m.lastSeen.at < (w.aliveCount <= 3 ? 10 : 4)) {
      this.setGoal(bot, m, m.lastSeen.x, m.lastSeen.y);
      return;
    }

    // 5. Head for a crate, or wander somewhere inside the zone.
    if (!m.goal || Math.hypot(m.goal.x - bot.x, m.goal.y - bot.y) < 1.2 || m.path.length === 0) {
      let crateGoal: { x: number; y: number } | null = null;
      let crateD = 18;
      for (const c of w.crates) {
        if (!c.alive) continue;
        const d = Math.hypot(c.x + 0.5 - bot.x, c.y + 0.5 - bot.y);
        if (d < crateD && !w.isOutsideZone(c.x + 0.5, c.y + 0.5, 2)) {
          crateD = d;
          crateGoal = { x: c.x + 0.5, y: c.y + 0.5 };
        }
      }
      if (crateGoal && crateD > 3.5) {
        this.setGoal(bot, m, crateGoal.x, crateGoal.y);
      } else if (!crateGoal) {
        const h = Math.max(2, w.zoneHalfSize - 2);
        this.setGoal(bot, m, center + (Math.random() * 2 - 1) * h, center + (Math.random() * 2 - 1) * h);
      }
    }
  }

  private pickTarget(bot: Brawler, maxDistance: number): Brawler | null {
    let best: Brawler | null = null;
    let bestScore = Infinity;
    for (const o of this.world.brawlers) {
      if (!o.alive || o.id === bot.id) continue;
      const d = Math.hypot(o.x - bot.x, o.y - bot.y);
      if (d > maxDistance || !this.world.canSee(bot, o)) continue;
      if (!this.world.hasLineOfSight(bot.x, bot.y, o.x, o.y) && d > 4) continue;
      // Prefer close and weak targets.
      const score = d + (o.hp / o.maxHp) * 3;
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    return best;
  }

  private fight(bot: Brawler, target: Brawler, m: BotMemory, cmd: Command) {
    const w = this.world;
    const dx = target.x - bot.x;
    const dy = target.y - bot.y;
    const d = Math.hypot(dx, dy);

    // Lead the shot a little, then add personal aim error.
    const t = d / BULLET.speed;
    const lx = target.x + target.moveX * BRAWLER.speed * t * 0.7 - bot.x;
    const ly = target.y + target.moveY * BRAWLER.speed * t * 0.7 - bot.y;
    const a = Math.atan2(ly, lx) + (Math.random() * 2 - 1) * m.aimError;
    cmd.aimX = Math.cos(a);
    cmd.aimY = Math.sin(a);

    // Keep a comfortable distance and strafe, unless retreating along a path.
    if (m.path.length === 0) {
      const want = 5.5;
      const radial = d > want + 1 ? 1 : d < want - 1.5 ? -1 : 0;
      const nx = dx / (d || 1);
      const ny = dy / (d || 1);
      cmd.moveX = nx * radial + -ny * m.strafe * 0.8;
      cmd.moveY = ny * radial + nx * m.strafe * 0.8;
      if (w.isOutsideZone(bot.x + cmd.moveX, bot.y + cmd.moveY, 0.5)) {
        cmd.moveX = MAP_SIZE / 2 - bot.x;
        cmd.moveY = MAP_SIZE / 2 - bot.y;
      }
    }

    const los = w.hasLineOfSight(bot.x, bot.y, target.x, target.y);
    if (!los) return;
    if (bot.superCharge >= 1 && d < 6) {
      cmd.superFire = true;
    } else if (d < BULLET.range * 0.95 && m.fireDelay <= 0 && bot.ammo >= 1) {
      cmd.fire = true;
      m.fireDelay = 0.55 + Math.random() * 0.6;
    }
  }

  private shootCrateIfClose(bot: Brawler, m: BotMemory, cmd: Command) {
    const w = this.world;
    for (const c of w.crates) {
      if (!c.alive) continue;
      const cx = c.x + 0.5;
      const cy = c.y + 0.5;
      const d = Math.hypot(cx - bot.x, cy - bot.y);
      if (d > 4.5) continue;
      cmd.aimX = cx - bot.x;
      cmd.aimY = cy - bot.y;
      if (bot.ammo >= 1.5 && m.fireDelay <= 0) {
        cmd.fire = true;
        m.fireDelay = 0.3;
      }
      if (d < 2.5) {
        cmd.moveX = 0;
        cmd.moveY = 0;
      }
      return;
    }
  }

  private nearestBush(bot: Brawler, threat: Brawler): { x: number; y: number } | null {
    const map = this.world.map;
    let best: { x: number; y: number } | null = null;
    let bestScore = Infinity;
    const r = 7;
    for (let y = Math.floor(bot.y - r); y <= bot.y + r; y++) {
      for (let x = Math.floor(bot.x - r); x <= bot.x + r; x++) {
        if (x < 0 || y < 0 || x >= map.size || y >= map.size) continue;
        if (map.tiles[y * map.size + x] !== Tile.Bush) continue;
        const px = x + 0.5;
        const py = y + 0.5;
        if (this.world.isOutsideZone(px, py, 1)) continue;
        const score = Math.hypot(px - bot.x, py - bot.y) - Math.hypot(px - threat.x, py - threat.y) * 0.6;
        if (score < bestScore) {
          bestScore = score;
          best = { x: px, y: py };
        }
      }
    }
    return best;
  }

  private setGoal(bot: Brawler, m: BotMemory, gx: number, gy: number) {
    const size = this.world.map.size;
    gx = Math.max(0.5, Math.min(size - 0.5, gx));
    gy = Math.max(0.5, Math.min(size - 0.5, gy));
    m.goal = { x: gx, y: gy };
    m.path = this.findPath(bot.x, bot.y, gx, gy);
  }

  private followPath(bot: Brawler, m: BotMemory, cmd: Command) {
    // Skip waypoints we can already walk straight to.
    while (m.path.length > 1 && this.world.hasLineOfSight(bot.x, bot.y, m.path[1].x, m.path[1].y)) {
      m.path.shift();
    }
    const next = m.path[0];
    if (!next) return;
    const dx = next.x - bot.x;
    const dy = next.y - bot.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.3) {
      m.path.shift();
      return;
    }
    cmd.moveX = dx / d;
    cmd.moveY = dy / d;
  }

  /** Breadth-first search over walkable tiles; returns tile-centre waypoints. */
  private findPath(sx: number, sy: number, gx: number, gy: number): { x: number; y: number }[] {
    const w = this.world;
    const size = w.map.size;
    const start = Math.floor(sy) * size + Math.floor(sx);
    let goal = Math.floor(gy) * size + Math.floor(gx);
    if (w.isSolid(goal % size, Math.floor(goal / size))) {
      // Aim for a free neighbour of a blocked goal (e.g. a crate).
      const gxT = goal % size;
      const gyT = Math.floor(goal / size);
      const options = [
        [gxT + 1, gyT],
        [gxT - 1, gyT],
        [gxT, gyT + 1],
        [gxT, gyT - 1],
      ].filter(([x, y]) => !w.isSolid(x, y));
      if (!options.length) return [];
      goal = options[0][1] * size + options[0][0];
    }
    const prev = new Int32Array(size * size).fill(-1);
    prev[start] = start;
    const queue = [start];
    let head = 0;
    while (head < queue.length) {
      const i = queue[head++];
      if (i === goal) break;
      const x = i % size;
      const y = (i - x) / size;
      const n = [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ];
      for (const [nx, ny] of n) {
        if (w.isSolid(nx, ny)) continue;
        const ni = ny * size + nx;
        if (prev[ni] !== -1) continue;
        prev[ni] = i;
        queue.push(ni);
      }
    }
    if (prev[goal] === -1) return [];
    const path: { x: number; y: number }[] = [];
    for (let i = goal; i !== start; i = prev[i]) {
      path.push({ x: (i % size) + 0.5, y: Math.floor(i / size) + 0.5 });
    }
    path.reverse();
    return path;
  }
}
