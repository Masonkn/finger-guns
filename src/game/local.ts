import type { PlayerIntent } from '../input';
import { type PlayerLook, randomLook } from '../render/cosmetics';
import { PLAYER_COUNT } from '../sim/config';
import { BotBrain } from '../sim/bot';
import { Brawler, Command, World } from '../sim/world';
import type { Match, MatchResult } from './match';

const STEP = 1 / 60;
const BOT_NAMES = ['Knuckles', 'Pinky', 'Thumbs', 'Lefty', 'Digit', 'Palmer', 'Pointer', 'Mitts', 'Ringo'];

/** Single-player match against bots, simulated entirely in the browser. */
export class LocalMatch implements Match {
  readonly world: World;
  readonly playerId: number;
  private bots: BotBrain;
  private acc = 0;
  private looks = new Map<number, PlayerLook>();

  constructor(name: string, look: PlayerLook) {
    const bots = shuffle(BOT_NAMES).slice(0, PLAYER_COUNT - 1);
    this.world = new World(Math.floor(Math.random() * 1e9), [
      { name, isBot: false },
      ...bots.map((n) => ({ name: n, isBot: true })),
    ]);
    this.playerId = this.world.brawlers[0].id;
    this.bots = new BotBrain(this.world);
    for (const b of this.world.brawlers) this.looks.set(b.id, b.id === this.playerId ? look : randomLook());
  }

  lookOf(b: Brawler): PlayerLook {
    return this.looks.get(b.id)!;
  }

  isVisible(b: Brawler): boolean {
    const me = this.world.brawlers[0];
    return b.id === me.id || !me.alive || this.world.canSee(me, b);
  }

  update(dt: number, intent: PlayerIntent) {
    const world = this.world;
    const player = world.brawlers[0];
    this.acc += dt;
    let firstStep = true;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      const commands = new Map<number, Command>();
      for (const b of world.brawlers) {
        if (b.alive && b.isBot) commands.set(b.id, this.bots.command(b, STEP));
      }
      // One-shot actions (tap to fire, super release) only apply on the first sim step of a frame.
      commands.set(player.id, {
        moveX: intent.moveX,
        moveY: intent.moveY,
        aimX: intent.aimX,
        aimY: intent.aimY,
        fire: intent.fire && firstStep,
        superFire: intent.superFire && firstStep,
        ability: intent.ability && firstStep ? 'auto' : null,
      });
      firstStep = false;
      world.step(STEP, commands);
    }
  }

  get result(): MatchResult | null {
    const me = this.world.brawlers[0];
    if (me.alive && this.world.winnerId === null) return null;
    const winner = this.world.brawlers.find((b) => b.id === this.world.winnerId);
    return { rank: me.rank, kills: me.kills, cubes: me.cubes, winner: winner?.name ?? null };
  }

  dispose() {}
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
