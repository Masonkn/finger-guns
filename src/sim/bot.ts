import { BOT_SKILL, BRAWLER, BotDifficulty, DEFAULT_BOT_DIFFICULTY, FINGERS, MAP_SIZE, PROP_HUNT, PropKind } from './config';
import { Tile } from './map';
import { ammoOf, fingerCount } from './world';
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
  // Prop hunt
  round: number; // the round the plan below was made for
  hideSpot: { x: number; y: number } | null;
  sweep: number; // seeker: which way the flashlight is swinging
}

/** How keen a seeker bot's eyes are at each difficulty: chance per look of spotting a still hider in the light. */
const NOTICE_CHANCE = [0.04, 0.08, 0.14, 0.22];

// Early on bots mostly loot, like players do in Showdown.
const LOOT_PHASE = 25;

/**
 * Showdown-style bots: loot crates, grab cubes, fight whoever they can see,
 * duck into bushes when hurt, and keep ahead of the closing zone.
 */
export class BotBrain {
  private memory = new Map<number, BotMemory>();
  private skill: (typeof BOT_SKILL)[BotDifficulty];

  private noticeChance: number;

  constructor(
    private world: World,
    difficulty: BotDifficulty = DEFAULT_BOT_DIFFICULTY,
  ) {
    this.skill = BOT_SKILL[difficulty];
    this.noticeChance = NOTICE_CHANCE[difficulty];
  }

  command(bot: Brawler, dt: number): Command {
    let m = this.memory.get(bot.id);
    const skill = this.skill;
    if (!m) {
      m = {
        thinkIn: Math.random() * skill.thinkInterval,
        goal: null,
        path: [],
        targetId: null,
        strafe: Math.random() < 0.5 ? 1 : -1,
        fireDelay: 0,
        aimError: between(skill.aimError),
        engageDistance: between(skill.engageDistance),
        lastSeen: null,
        round: 0,
        hideSpot: null,
        sweep: Math.random() < 0.5 ? 1 : -1,
      };
      this.memory.set(bot.id, m);
    }

    m.thinkIn -= dt;
    m.fireDelay -= dt;
    if (this.world.propHunt) return this.propHunt(bot, m);
    if (m.thinkIn <= 0) {
      m.thinkIn = skill.thinkInterval;
      this.think(bot, m);
    }

    const cmd: Command = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, fire: false, superFire: false };
    this.followPath(bot, m, cmd);

    const target = m.targetId !== null ? this.world.brawlers.find((b) => b.id === m.targetId) : undefined;
    if (target && target.alive && this.world.canSee(bot, target)) {
      this.fight(bot, target, m, cmd);
      if (skill.usesAbilities) this.useAbilities(bot, target, m, cmd);
    } else {
      this.shootCrateIfClose(bot, m, cmd);
    }
    return cmd;
  }

  /** Simple ability rules: dash away when low, shield under fire, rapid fire up close. */
  private useAbilities(bot: Brawler, target: Brawler, m: BotMemory, cmd: Command) {
    const w = this.world;
    const d = Math.hypot(target.x - bot.x, target.y - bot.y);
    if (w.abilityReady(bot, 'dash') && bot.hp < bot.maxHp * 0.35 && d < 6) {
      if (m.path.length === 0) {
        // No escape route planned: dash straight away from the threat, sliding along the zone.
        cmd.moveX = (bot.x - target.x) / (d || 1);
        cmd.moveY = (bot.y - target.y) / (d || 1);
        if (w.isOutsideZone(bot.x + cmd.moveX * 3, bot.y + cmd.moveY * 3, 0.5)) {
          cmd.moveX = MAP_SIZE / 2 - bot.x;
          cmd.moveY = MAP_SIZE / 2 - bot.y;
        }
      }
      cmd.ability = 'dash';
    } else if (w.abilityReady(bot, 'shield') && w.time - bot.lastHitAt < 0.2) {
      cmd.ability = 'shield';
    } else if (
      w.abilityReady(bot, 'rapidFire') &&
      d < 5 &&
      w.hasLineOfSight(bot.x, bot.y, target.x, target.y)
    ) {
      cmd.ability = 'rapidFire';
    }
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
    const endGame = w.aliveCount - this.teammates(bot).length <= 3;
    const reach = w.time < LOOT_PHASE ? 4.5 : endGame ? 14 : m.engageDistance;
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

    // 3. Grab nearby cubes, dropped fingers and ammo boxes (bots aren't picky about bullet type).
    let bestCube: { x: number; y: number } | null = null;
    let bestD = 12;
    const wantsFingers = fingerCount(bot) < FINGERS.max;
    const wantsAmmo = bot.ammoKind === 'normal' || bot.ammoUntil - w.time < 6;
    const loot = [...w.cubes, ...(wantsFingers ? w.fingers : []), ...(wantsAmmo ? w.ammoPickups : [])];
    for (const c of loot) {
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
    if (m.lastSeen && w.time - m.lastSeen.at < (endGame ? 10 : 4)) {
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
        // Stick with the team: wander to a teammate when there's nothing to loot.
        const mate = this.teammates(bot)[0];
        if (mate && Math.hypot(mate.x - bot.x, mate.y - bot.y) > 4) {
          this.setGoal(bot, m, mate.x, mate.y);
          return;
        }
        const h = Math.max(2, w.zoneHalfSize - 2);
        this.setGoal(bot, m, center + (Math.random() * 2 - 1) * h, center + (Math.random() * 2 - 1) * h);
      }
    }
  }

  // --- Prop hunt -------------------------------------------------------------

  private propHunt(bot: Brawler, m: BotMemory): Command {
    const w = this.world;
    const ph = w.propHunt!;
    const cmd: Command = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, fire: false, superFire: false };
    if (m.round !== ph.round) {
      // New round: forget the old plan.
      m.round = ph.round;
      m.hideSpot = null;
      m.goal = null;
      m.path = [];
      m.targetId = null;
      if (bot.id !== ph.seekerId) this.planHide(bot, m, cmd);
    }
    if (!w.canMove(bot)) return cmd;
    if (bot.id === ph.seekerId) this.seek(bot, m, cmd);
    else this.hide(bot, m, cmd);
    return cmd;
  }

  /** Picks a block and a spot where it blends in: a bush in the grass, a brick in line with a wall, and so on. */
  private planHide(bot: Brawler, m: BotMemory, cmd: Command) {
    const w = this.world;
    let kind = bot.prop ?? 'bush';
    if (w.propHunt!.blocks === 'pick') {
      const r = Math.random();
      kind = r < 0.4 ? 'bush' : r < 0.65 ? 'brick' : r < 0.82 ? 'crate' : r < 0.92 ? 'cube' : 'ammo';
      cmd.prop = kind;
    }
    const spots = this.hidingSpots(kind);
    // Somewhere reachable in the hiding time, not too close to the sleeping seeker.
    const c = MAP_SIZE / 2;
    const options = spots.filter((s) => {
      const d = Math.hypot(s.x - bot.x, s.y - bot.y);
      return d < BRAWLER.speed * PROP_HUNT.hideTime * 0.35 && Math.hypot(s.x - c, s.y - c) > 6;
    });
    const pick = options.length ? options : spots;
    m.hideSpot = pick.length ? pick[Math.floor(Math.random() * pick.length)] : { x: bot.x, y: bot.y };
    this.setGoal(bot, m, m.hideSpot.x, m.hideSpot.y);
  }

  /** Tile centres where a block of this kind would look like it belongs. */
  private hidingSpots(kind: PropKind): { x: number; y: number }[] {
    const w = this.world;
    const map = w.map;
    const out: { x: number; y: number }[] = [];
    const nextTo = (x: number, y: number, test: (tx: number, ty: number) => boolean) =>
      test(x + 1, y) || test(x - 1, y) || test(x, y + 1) || test(x, y - 1);
    const isWall = (tx: number, ty: number) => tx >= 0 && ty >= 0 && tx < map.size && ty < map.size && map.tiles[ty * map.size + tx] === Tile.Wall;
    const isCrate = (tx: number, ty: number) => !!w.crateAt(tx, ty)?.alive;
    if (kind === 'cube' || kind === 'ammo') {
      // Next to one of the decoys of the same kind.
      const decoys = kind === 'cube' ? w.cubes : w.ammoPickups;
      for (const d of decoys) {
        for (const [ox, oy] of [[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]]) {
          if (!w.isSolid(Math.floor(d.x + ox), Math.floor(d.y + oy))) out.push({ x: d.x + ox, y: d.y + oy });
        }
      }
      return out;
    }
    for (let y = 1; y < map.size - 1; y++) {
      for (let x = 1; x < map.size - 1; x++) {
        if (w.isSolid(x, y)) continue;
        const tile = map.tiles[y * map.size + x];
        const fits =
          kind === 'bush' ? tile === Tile.Bush : kind === 'brick' ? nextTo(x, y, isWall) : nextTo(x, y, isCrate);
        if (fits) out.push({ x: x + 0.5, y: y + 0.5 });
      }
    }
    return out;
  }

  private hide(bot: Brawler, m: BotMemory, cmd: Command) {
    const w = this.world;
    const seeker = w.brawlers.find((b) => b.id === w.propHunt!.seekerId)!;
    const d = Math.hypot(seeker.x - bot.x, seeker.y - bot.y);
    // Run for it when the seeker is right on top of you and clearly coming (and sometimes panic).
    if (m.thinkIn <= 0) {
      m.thinkIn = this.skill.thinkInterval;
      const coming = d < 2.6 && w.canSee(seeker, bot) && w.hasLineOfSight(seeker.x, seeker.y, bot.x, bot.y);
      if (coming && m.path.length === 0 && Math.random() < 0.35) {
        const ax = bot.x + ((bot.x - seeker.x) / (d || 1)) * 6;
        const ay = bot.y + ((bot.y - seeker.y) / (d || 1)) * 6;
        this.setGoal(bot, m, ax, ay);
        m.hideSpot = m.goal;
      }
    }
    this.followPath(bot, m, cmd);
  }

  private seek(bot: Brawler, m: BotMemory, cmd: Command) {
    const w = this.world;
    const ph = w.propHunt!;
    if (m.thinkIn <= 0) {
      m.thinkIn = this.skill.thinkInterval;
      const target = m.targetId !== null ? w.brawlers.find((b) => b.id === m.targetId) : undefined;
      if (!target || !target.alive || !w.canSee(bot, target)) m.targetId = this.spotHider(bot)?.id ?? null;
      const chase = m.targetId !== null ? w.brawlers.find((b) => b.id === m.targetId)! : null;
      if (chase) {
        this.setGoal(bot, m, chase.x, chase.y);
      } else if (!m.goal || m.path.length === 0 || Math.hypot(m.goal.x - bot.x, m.goal.y - bot.y) < 1.2) {
        // Search: walk to a random hiding place (bushes are the obvious first look).
        const kinds: PropKind[] = ['bush', 'brick', 'crate', 'cube'];
        const spots = this.hidingSpots(kinds[Math.floor(Math.random() * kinds.length)]);
        const s = spots[Math.floor(Math.random() * spots.length)];
        if (s) this.setGoal(bot, m, s.x, s.y);
      }
    }
    this.followPath(bot, m, cmd);
    const target = m.targetId !== null ? w.brawlers.find((b) => b.id === m.targetId) : undefined;
    if (target && target.alive && ph.phase === 'seek') {
      const dx = target.x - bot.x;
      const dy = target.y - bot.y;
      const d = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx) + (Math.random() * 2 - 1) * m.aimError * 0.5;
      cmd.aimX = Math.cos(a);
      cmd.aimY = Math.sin(a);
      if (d < 1.5 || !w.hasLineOfSight(bot.x, bot.y, target.x, target.y)) {
        // Close enough to just touch them.
        cmd.moveX = dx / (d || 1);
        cmd.moveY = dy / (d || 1);
      } else if (d < ammoOf(bot).range * 0.9 && m.fireDelay <= 0 && bot.ammo >= 1) {
        cmd.fire = true;
        m.fireDelay = (0.5 + Math.random() * 0.5) * this.skill.fireDelay;
      }
    } else if (Math.hypot(cmd.moveX, cmd.moveY) > 0.1) {
      // Swing the flashlight from side to side while walking.
      m.strafe += m.sweep * 0.03;
      if (Math.abs(m.strafe) > 0.7) m.sweep *= -1;
      const a = Math.atan2(cmd.moveY, cmd.moveX) + m.strafe;
      cmd.aimX = Math.cos(a);
      cmd.aimY = Math.sin(a);
    }
  }

  /** Looks around with the flashlight: hiders in its beam may get noticed, moving ones far more easily. */
  private spotHider(bot: Brawler): Brawler | null {
    const w = this.world;
    for (const h of w.brawlers) {
      if (!h.alive || h.id === bot.id || !w.canSee(bot, h)) continue;
      const dx = h.x - bot.x;
      const dy = h.y - bot.y;
      const d = Math.hypot(dx, dy);
      if (d > PROP_HUNT.flashlightRange) continue;
      const off = Math.abs(Math.atan2(Math.sin(Math.atan2(dy, dx) - bot.facing), Math.cos(Math.atan2(dy, dx) - bot.facing)));
      if (d > 2 && off > PROP_HUNT.flashlightAngle) continue;
      if (!w.hasLineOfSight(bot.x, bot.y, h.x, h.y)) continue;
      let chance = this.noticeChance;
      if (Math.hypot(h.moveX, h.moveY) > 0.1) chance *= 4; // moving blocks stand out
      // A block that isn't lined up with the tiles looks out of place.
      if (Math.abs((h.x % 1) - 0.5) > 0.2 || Math.abs((h.y % 1) - 0.5) > 0.2) chance *= 2;
      if (d < 3) chance *= 2;
      if (Math.random() < chance) return h;
    }
    return null;
  }

  private pickTarget(bot: Brawler, maxDistance: number): Brawler | null {
    let best: Brawler | null = null;
    let bestScore = Infinity;
    for (const o of this.world.brawlers) {
      if (!o.alive || o.team === bot.team) continue;
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

  private teammates(bot: Brawler): Brawler[] {
    return this.world.brawlers.filter((o) => o.alive && o.team === bot.team && o.id !== bot.id);
  }

  private fight(bot: Brawler, target: Brawler, m: BotMemory, cmd: Command) {
    const w = this.world;
    const dx = target.x - bot.x;
    const dy = target.y - bot.y;
    const d = Math.hypot(dx, dy);

    // Lead the shot a little, then add personal aim error.
    const ammo = ammoOf(bot);
    const t = d / ammo.speed;
    const lead = this.skill.lead;
    const lx = target.x + target.moveX * BRAWLER.speed * t * lead - bot.x;
    const ly = target.y + target.moveY * BRAWLER.speed * t * lead - bot.y;
    const a = Math.atan2(ly, lx) + (Math.random() * 2 - 1) * m.aimError;
    cmd.aimX = Math.cos(a);
    cmd.aimY = Math.sin(a);

    // Keep a comfortable distance and strafe, unless retreating along a path.
    if (m.path.length === 0) {
      const want = Math.min(5.5, ammo.range * 0.6); // close in with a shotgun
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
    if (this.skill.usesSuper && bot.superCharge >= 1 && d < 6) {
      cmd.superFire = true;
    } else if (w.isRapidFiring(bot) && d < ammo.range * 0.95 && m.fireDelay <= 0) {
      cmd.fire = true;
      m.fireDelay = (0.2 + Math.random() * 0.1) * this.skill.fireDelay;
    } else if (d < ammo.range * 0.95 && m.fireDelay <= 0 && bot.ammo >= 1) {
      cmd.fire = true;
      m.fireDelay = (0.55 + Math.random() * 0.6) * this.skill.fireDelay;
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

function between([min, max]: [number, number]): number {
  return min + Math.random() * (max - min);
}
