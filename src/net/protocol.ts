// Messages between the browser and the game server, sent as JSON over a WebSocket.
// Shared by both sides so they can't drift apart.

import type { BlockChoice, BotDifficulty, GameMode, TeamSize } from '../sim/config';
import type { GameEvent, PropHuntState } from '../sim/world';
import type { MapChoice, MapTheme } from '../sim/themes';

export const TICK_RATE = 30; // server simulation and snapshot rate, per second
export const TICK = 1 / TICK_RATE;
export const MAX_NAME_LENGTH = 14;
export const ROOM_CODE_LENGTH = 4;

// --- Client -> server --------------------------------------------------------

/** Hand colour and thumb topper, as sent over the wire. The client validates the topper. */
export interface WireLook {
  color: number;
  topper: string;
  glove?: string;
  sleeve?: number;
}

export type ClientMessage =
  | { t: 'join'; name: string; look?: WireLook; mode: 'quick'; teamSize?: TeamSize; difficulty?: BotDifficulty } // matchmaking into a public match
  | {
      t: 'join';
      name: string;
      look?: WireLook;
      mode: 'create';
      teamSize?: TeamSize;
      difficulty?: BotDifficulty;
      game?: GameMode;
      blocks?: BlockChoice;
    } // new private match with a code
  | { t: 'join'; name: string; look?: WireLook; mode: 'code'; code: string } // join a friend's private match
  | { t: 'start' } // host starts a private match
  | { t: 'mode'; teamSize: TeamSize } // longest-waiting player picks solo or a team size
  | { t: 'difficulty'; level: BotDifficulty } // the longest-waiting player picks how well the bots play
  | { t: 'team'; team: number } // move to another team in the lobby
  | { t: 'map'; map: MapChoice } // private host picks a map, or today's featured one
  | { t: 'game'; game: GameMode } // private host picks showdown or prop hunt
  | { t: 'blocks'; blocks: BlockChoice } // private host: prop hunt hiders pick their block, or get a random one
  // q: use the current kill-streak ability; p: prop hunt block picked, as an index into PROP_KINDS
  | { t: 'input'; seq: number; mx: number; my: number; ax: number; ay: number; f: 0 | 1; s: 0 | 1; q?: 0 | 1; p?: number }
  | { t: 'leave' };

// --- Server -> client --------------------------------------------------------

export interface LobbyPlayer {
  name: string;
  isYou: boolean;
  isHost: boolean;
  team: number;
}

/** A brawler as one client sees it. Own brawler carries extra private fields. */
export interface BrawlerState {
  id: number;
  x: number;
  y: number;
  f: number; // facing
  mx: number; // movement direction, drives the walk animation
  my: number;
  hp: number;
  mhp: number;
  cubes: number;
  bush: 0 | 1;
  stk: number; // kill streak
  fg: number[]; // extra fingers, by the id of the brawler each came from
  fx: number; // active effects: 1 shield, 2 rapid fire, 4 dash, 8 burning, 16 chilled
  ak?: number; // bullet type as an index into AMMO_KINDS, left out for normal
  pk?: number; // prop hunt: the block a hider looks like, as an index into PROP_KINDS
  // Own brawler only:
  ammo?: number;
  sup?: number;
  ar?: [dash: number, shield: number, rapidFire: number]; // world time each ability is ready again
  al?: number; // world time any ability can be used again
  au?: number; // world time special bullets run out
}

export const FX_SHIELD = 1;
export const FX_RAPID = 2;
export const FX_DASH = 4;
export const FX_BURN = 8;
export const FX_CHILL = 16;

export interface BulletState {
  id: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  sup: 0 | 1;
  k?: number; // bullet type index into AMMO_KINDS, left out for normal
}

export interface Snapshot {
  t: 'snap';
  tick: number;
  time: number;
  zone: number;
  ack: number; // last input seq the server applied for this client
  alive: number[]; // ids of every brawler still in the match, visible or not
  b: BrawlerState[]; // only the brawlers this client can currently see
  bul: BulletState[];
  cubes: [id: number, x: number, y: number][];
  fingers: [id: number, x: number, y: number, fromId: number][];
  ammo: [id: number, x: number, y: number, kind: number][]; // ammo boxes on the ground
  ph?: PropHuntState; // prop hunt rounds, phase and seeker
  ev: GameEvent[];
}

export type ServerMessage =
  | {
      t: 'lobby';
      code: string | null;
      teamSize: TeamSize;
      difficulty: BotDifficulty;
      map: MapChoice;
      featured: MapTheme; // today's featured map, by the server's date
      players: LobbyPlayer[];
      startsIn: number | null; // public matches start on a timer
      canStart: boolean; // you are the host of a private match
      canSetDifficulty: boolean; // you have been in the lobby longest
      canSetMode: boolean; // same: the longest-waiting player picks solo or a team size
      canSetMap: boolean; // private host only; public matches always play the featured map
      game?: GameMode; // left out by older servers: showdown
      blocks?: BlockChoice;
      canSetGame?: boolean; // private host only; public matches are always showdown
    }
  | {
      t: 'start';
      seed: number;
      you: number;
      teamSize: TeamSize;
      map?: MapTheme; // left out by older servers: summer
      game?: GameMode; // left out: showdown
      blocks?: BlockChoice;
      players: { id: number; name: string; team: number; look: WireLook | null }[];
    }
  | Snapshot
  | { t: 'result'; rank: number; kills: number; cubes: number; winner: string | null; wins?: number }
  | { t: 'error'; message: string };

export function round(n: number, places = 2): number {
  const k = 10 ** places;
  return Math.round(n * k) / k;
}

export function cleanName(raw: unknown): string {
  const name = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  return name || `Hand${Math.floor(1000 + Math.random() * 9000)}`;
}

/** Keeps a client-supplied look to a colour and a short topper id; the client checks the id against its list. */
export function cleanLook(raw: unknown): WireLook | null {
  if (!raw || typeof raw !== 'object') return null;
  const { color, topper, glove, sleeve } = raw as Record<string, unknown>;
  const isColor = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffff;
  const isId = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z]{1,20}$/.test(v);
  if (!isColor(color) || !isId(topper)) return null;
  const look: WireLook = { color, topper };
  if (isId(glove)) look.glove = glove;
  if (isColor(sleeve)) look.sleeve = sleeve;
  return look;
}
