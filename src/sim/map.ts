import { MAP_SIZE, TeamSize, teamCount } from './config';
import { mulberry32 } from './rng';

export const enum Tile {
  Empty = 0,
  Wall = 1,
  Bush = 2,
}

export interface GameMap {
  size: number;
  tiles: Uint8Array; // size * size, index = y * size + x
  crateTiles: { x: number; y: number }[];
  spawns: { x: number; y: number }[]; // grouped by team: team t's hands use spawns[t * teamSize ...]
}

export function tileAt(map: GameMap, x: number, y: number): Tile {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= map.size || ty >= map.size) return Tile.Wall;
  return map.tiles[ty * map.size + tx] as Tile;
}

/**
 * Builds a 4-way mirrored arena, the way Showdown maps are symmetric so no
 * spawn is favoured. One quadrant is generated and reflected across both axes.
 */
export function generateMap(seed: number, teamSize: TeamSize = 1): GameMap {
  const size = MAP_SIZE;
  const half = size / 2;
  const rand = mulberry32(seed);
  const q = new Uint8Array(half * half); // quadrant, top-left
  const qCrates: { x: number; y: number }[] = [];
  const qi = (x: number, y: number) => y * half + x;

  // Wall segments and L shapes.
  for (let n = 0; n < 14; n++) {
    const x = 2 + Math.floor(rand() * (half - 4));
    const y = 2 + Math.floor(rand() * (half - 4));
    const len = 2 + Math.floor(rand() * 4);
    const horizontal = rand() < 0.5;
    for (let i = 0; i < len; i++) {
      const wx = horizontal ? x + i : x;
      const wy = horizontal ? y : y + i;
      if (wx < half && wy < half) q[qi(wx, wy)] = Tile.Wall;
    }
    if (rand() < 0.35) {
      // Short perpendicular arm.
      for (let i = 1; i < 3; i++) {
        const wx = horizontal ? x : x + i;
        const wy = horizontal ? y + i : y;
        if (wx < half && wy < half) q[qi(wx, wy)] = Tile.Wall;
      }
    }
  }

  // Bush patches.
  for (let n = 0; n < 12; n++) {
    const cx = 1 + rand() * (half - 2);
    const cy = 1 + rand() * (half - 2);
    const r = 1 + rand() * 1.4;
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        if (x < 0 || y < 0 || x >= half || y >= half) continue;
        if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r && q[qi(x, y)] === Tile.Empty) {
          q[qi(x, y)] = Tile.Bush;
        }
      }
    }
  }

  // Crates (they hold power cubes).
  let placed = 0;
  for (let tries = 0; tries < 200 && placed < 6; tries++) {
    const x = 1 + Math.floor(rand() * (half - 1));
    const y = 1 + Math.floor(rand() * (half - 1));
    if (q[qi(x, y)] !== Tile.Empty) continue;
    if (qCrates.some((c) => Math.abs(c.x - x) + Math.abs(c.y - y) < 4)) continue;
    qCrates.push({ x, y });
    placed++;
  }

  // Mirror the quadrant into the full map.
  const tiles = new Uint8Array(size * size);
  const crateSet = new Set<number>();
  for (let y = 0; y < half; y++) {
    for (let x = 0; x < half; x++) {
      const t = q[qi(x, y)];
      for (const [mx, my] of mirrors(x, y, size)) tiles[my * size + mx] = t;
    }
  }
  for (const c of qCrates) {
    for (const [mx, my] of mirrors(c.x, c.y, size)) crateSet.add(my * size + mx);
  }

  // Spawns on a ring around the centre, one point per team with teammates huddled
  // around it; clear the ground around each.
  const spawns: { x: number; y: number }[] = [];
  const ringRadius = half - 4;
  const angleOffset = rand() * Math.PI * 2;
  const teams = teamCount(teamSize);
  for (let t = 0; t < teams; t++) {
    const a = angleOffset + (t / teams) * Math.PI * 2;
    const cx = half + Math.cos(a) * ringRadius;
    const cy = half + Math.sin(a) * ringRadius;
    for (const [ox, oy] of TEAM_HUDDLE[teamSize]) {
      // Offsets are along the ring (ox) and toward the centre (oy).
      const sx = cx - Math.sin(a) * ox - Math.cos(a) * oy;
      const sy = cy + Math.cos(a) * ox - Math.sin(a) * oy;
      spawns.push({ x: sx, y: sy });
      clearArea(tiles, crateSet, size, sx, sy, 1.6);
    }
  }
  clearArea(tiles, crateSet, size, half, half, 2);

  // Make sure every spawn connects to the centre, carving a corridor if walls box one in.
  let reachable = floodFill(tiles, size, Math.floor(half), Math.floor(half));
  for (const s of spawns) {
    if (reachable[Math.floor(s.y) * size + Math.floor(s.x)]) continue;
    const steps = Math.ceil(Math.hypot(half - s.x, half - s.y) * 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      clearArea(tiles, crateSet, size, s.x + (half - s.x) * t, s.y + (half - s.y) * t, 0.8);
    }
    reachable = floodFill(tiles, size, Math.floor(half), Math.floor(half));
  }

  // Seal off any pockets the player could never walk into.
  for (let i = 0; i < tiles.length; i++) {
    if (!reachable[i] && tiles[i] !== Tile.Wall) {
      tiles[i] = Tile.Wall;
      crateSet.delete(i);
    }
  }

  const crateTiles = [...crateSet].map((i) => ({ x: i % size, y: Math.floor(i / size) }));
  return { size, tiles, crateTiles, spawns };
}

const TEAM_HUDDLE: Record<TeamSize, [number, number][]> = {
  1: [[0, 0]],
  2: [[-0.8, 0], [0.8, 0]],
  3: [[-1.1, 0], [1.1, 0], [0, 1.1]],
  4: [[-0.8, -0.4], [0.8, -0.4], [-0.8, 0.9], [0.8, 0.9]],
};

function mirrors(x: number, y: number, size: number): [number, number][] {
  const fx = size - 1 - x;
  const fy = size - 1 - y;
  return [
    [x, y],
    [fx, y],
    [x, fy],
    [fx, fy],
  ];
}

function clearArea(
  tiles: Uint8Array,
  crates: Set<number>,
  size: number,
  cx: number,
  cy: number,
  r: number,
) {
  for (let y = Math.floor(cy - r); y <= cy + r; y++) {
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r) continue;
      if (tiles[y * size + x] === Tile.Wall) tiles[y * size + x] = Tile.Empty;
      crates.delete(y * size + x);
    }
  }
}

function floodFill(tiles: Uint8Array, size: number, sx: number, sy: number): Uint8Array {
  const seen = new Uint8Array(size * size);
  const stack = [sy * size + sx];
  seen[stack[0]] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % size;
    const y = (i - x) / size;
    const next = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ];
    for (const [nx, ny] of next) {
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const ni = ny * size + nx;
      if (seen[ni] || tiles[ni] === Tile.Wall) continue;
      seen[ni] = 1;
      stack.push(ni);
    }
  }
  return seen;
}
