import type { PlayerIntent } from '../input';
import type { PlayerLook } from '../render/cosmetics';
import type { Brawler, World } from '../sim/world';
import type { MapTheme } from '../sim/themes';

export interface MatchResult {
  rank: number;
  kills: number;
  cubes: number;
  winner: string | null;
  wins?: number; // prop hunt rounds won
}

/**
 * What the renderer and HUD need from a match, whether the rules run in this
 * browser (vs bots) or on the server (online).
 */
export interface Match {
  readonly world: World;
  readonly playerId: number;
  /** Which season or holiday the arena is dressed for. */
  readonly mapTheme: MapTheme;
  /** Whether the local player can currently see this brawler (bushes hide enemies). */
  isVisible(b: Brawler): boolean;
  /** Hand colour and thumb topper each brawler wears. */
  lookOf(b: Brawler): PlayerLook;
  /** Advance by one rendered frame, applying the player's intent. */
  update(dt: number, intent: PlayerIntent): void;
  /** Set once the local player is knocked out or the match has a winner. */
  readonly result: MatchResult | null;
  dispose(): void;
}
