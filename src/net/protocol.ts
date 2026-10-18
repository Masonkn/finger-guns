// Messages between the browser and the game server, sent as JSON over a WebSocket.
// Shared by both sides so they can't drift apart.

import type { BotDifficulty, TeamSize } from '../sim/config';
import type { GameEvent } from '../sim/world';

export const TICK_RATE = 30; // server simulation and snapshot rate, per second
export const TICK = 1 / TICK_RATE;
export const MAX_NAME_LENGTH = 14;
export const ROOM_CODE_LENGTH = 4;

// --- Client -> server --------------------------------------------------------

/** Hand colour and thumb topper, as sent over the wire. The client validates the topper. */
export interface WireLook {
  color: number;
  topper: string;
}

export type ClientMessage =
  | { t: 'join'; name: string; look?: WireLook; mode: 'quick'; teamSize?: TeamSize } // matchmaking into a public match
  | { t: 'join'; name: string; look?: WireLook; mode: 'create'; teamSize?: TeamSize; difficulty?: BotDifficulty } // new private match with a code
  | { t: 'join'; name: string; look?: WireLook; mode: 'code'; code: string } // join a friend's private match
  | { t: 'start' } // host starts a private match
  | { t: 'mode'; teamSize: TeamSize } // host picks solo or a team size for a private match
  | { t: 'difficulty'; level: BotDifficulty } // host picks how well the bots play in a private match
  | { t: 'team'; team: number } // move to another team in the lobby
  // q: use the current kill-streak ability
  | { t: 'input'; seq: number; mx: number; my: number; ax: number; ay: number; f: 0 | 1; s: 0 | 1; q?: 0 | 1 }
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
  fx: number; // active ability effects: 1 shield, 2 rapid fire, 4 dash
  // Own brawler only:
  ammo?: number;
  sup?: number;
  ar?: [dash: number, shield: number, rapidFire: number]; // world time each ability is ready again
  al?: number; // world time any ability can be used again
}

export const FX_SHIELD = 1;
export const FX_RAPID = 2;
export const FX_DASH = 4;

export interface BulletState {
  id: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  sup: 0 | 1;
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
  ev: GameEvent[];
}

export type ServerMessage =
  | {
      t: 'lobby';
      code: string | null;
      teamSize: TeamSize;
      difficulty: BotDifficulty;
      players: LobbyPlayer[];
      startsIn: number | null; // public matches start on a timer
      canStart: boolean; // you are the host of a private match
    }
  | {
      t: 'start';
      seed: number;
      you: number;
      teamSize: TeamSize;
      players: { id: number; name: string; team: number; look: WireLook | null }[];
    }
  | Snapshot
  | { t: 'result'; rank: number; kills: number; cubes: number; winner: string | null }
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
  const { color, topper } = raw as Record<string, unknown>;
  if (typeof color !== 'number' || !Number.isInteger(color) || color < 0 || color > 0xffffff) return null;
  if (typeof topper !== 'string' || !/^[a-zA-Z]{1,20}$/.test(topper)) return null;
  return { color, topper };
}
