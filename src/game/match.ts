import type { PlayerIntent } from '../input';
import type { Brawler, World } from '../sim/world';

export interface MatchResult {
  rank: number;
  kills: number;
  cubes: number;
  winner: string | null;
}

/**
 * What the renderer and HUD need from a match, whether the rules run in this
 * browser (vs bots) or on the server (online).
 */
export interface Match {
  readonly world: World;
  readonly playerId: number;
  /** Whether the local player can currently see this brawler (bushes hide enemies). */
  isVisible(b: Brawler): boolean;
  /** Advance by one rendered frame, applying the player's intent. */
  update(dt: number, intent: PlayerIntent): void;
  /** Set once the local player is knocked out or the match has a winner. */
  readonly result: MatchResult | null;
  dispose(): void;
}
