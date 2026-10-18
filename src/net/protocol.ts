// Messages between the browser and the game server, sent as JSON over a WebSocket.
// Shared by both sides so they can't drift apart.

import type { GameEvent } from '../sim/world';

export const TICK_RATE = 30; // server simulation and snapshot rate, per second
export const TICK = 1 / TICK_RATE;
export const MAX_NAME_LENGTH = 14;
export const ROOM_CODE_LENGTH = 4;

// --- Client -> server --------------------------------------------------------

export type ClientMessage =
  | { t: 'join'; name: string; mode: 'quick' } // matchmaking into a public match
  | { t: 'join'; name: string; mode: 'create' } // new private match with a code
  | { t: 'join'; name: string; mode: 'code'; code: string } // join a friend's private match
  | { t: 'start' } // start a private match early
  | { t: 'input'; seq: number; mx: number; my: number; ax: number; ay: number; f: 0 | 1; s: 0 | 1 }
  | { t: 'leave' };

// --- Server -> client --------------------------------------------------------

export interface LobbyPlayer {
  name: string;
  isYou: boolean;
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
  // Own brawler only:
  ammo?: number;
  sup?: number;
}

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
  ev: GameEvent[];
}

export type ServerMessage =
  | { t: 'lobby'; code: string | null; players: LobbyPlayer[]; startsIn: number | null; canStart: boolean }
  | { t: 'start'; seed: number; you: number; players: { id: number; name: string }[] }
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
