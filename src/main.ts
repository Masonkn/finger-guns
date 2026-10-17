import './style.css';
import { BULLET, SUPER } from './sim/config';
import { BotBrain } from './sim/bot';
import { Command, World } from './sim/world';
import { GameScene, createRenderer } from './render/scene';
import { Hud } from './hud';
import { Input } from './input';

const BOT_NAMES = ['Knuckles', 'Pinky', 'Thumbs', 'Lefty', 'Digit', 'Palmer', 'Pointer', 'Mitts', 'Ringo'];
const STEP = 1 / 60;

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const hudRoot = document.querySelector<HTMLElement>('#hud')!;
const superButton = document.querySelector<HTMLElement>('#super')!;
const menu = document.querySelector<HTMLElement>('#menu')!;
const endScreen = document.querySelector<HTMLElement>('#end')!;
const renderer = createRenderer(canvas);

interface Match {
  world: World;
  bots: BotBrain;
  scene: GameScene;
  hud: Hud;
  input: Input;
  endShownAt: number | null;
}

let match: Match | null = null;
let input: Input | null = null;

function startMatch() {
  if (match) {
    match.hud.destroy();
    match.scene.dispose();
  }
  const seed = Math.floor(Math.random() * 1e9);
  const names = ['You', ...shuffle(BOT_NAMES)];
  const world = new World(seed, names);
  const playerId = world.brawlers[0].id;
  const scene = new GameScene(renderer, world, playerId);
  if (!input) input = new Input(scene, hudRoot, superButton);
  else input.setScene(scene);
  const hud = new Hud(hudRoot, world, scene, playerId, superButton);
  match = { world, bots: new BotBrain(world), scene, hud, input, endShownAt: null };
  menu.hidden = true;
  endScreen.hidden = true;
  // ?debug exposes the match for poking at from the console (and from tests).
  if (new URLSearchParams(location.search).has('debug')) (window as unknown as { fg: Match }).fg = match;
}

function autoAimDirection(world: World, playerId: number, range: number): { x: number; y: number } | null {
  const p = world.brawlers.find((b) => b.id === playerId)!;
  let best: { x: number; y: number } | null = null;
  let bestD = range;
  for (const b of world.brawlers) {
    if (!b.alive || b.id === playerId || !world.canSee(p, b)) continue;
    const d = Math.hypot(b.x - p.x, b.y - p.y);
    if (d < bestD && world.hasLineOfSight(p.x, p.y, b.x, b.y)) {
      bestD = d;
      best = { x: b.x - p.x, y: b.y - p.y };
    }
  }
  if (best) return best;
  for (const c of world.crates) {
    if (!c.alive) continue;
    const d = Math.hypot(c.x + 0.5 - p.x, c.y + 0.5 - p.y);
    if (d < bestD) {
      bestD = d;
      best = { x: c.x + 0.5 - p.x, y: c.y + 0.5 - p.y };
    }
  }
  return best;
}

let last = performance.now();
let acc = 0;

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!match) return;
  const { world, bots, scene, hud } = match;
  const player = world.brawlers[0];

  const intent = match.input.read(player.x, player.y);
  if (intent.autoAim) {
    const d = autoAimDirection(world, player.id, intent.superFire ? SUPER.range : BULLET.range);
    if (d) {
      intent.aimX = d.x;
      intent.aimY = d.y;
    }
  }

  acc += dt;
  let firstStep = true;
  while (acc >= STEP) {
    acc -= STEP;
    const commands = new Map<number, Command>();
    for (const b of world.brawlers) {
      if (!b.alive) continue;
      if (b.isBot) commands.set(b.id, bots.command(b, STEP));
    }
    // One-shot actions (tap to fire, super release) only apply on the first sim step of a frame.
    commands.set(player.id, {
      moveX: intent.moveX,
      moveY: intent.moveY,
      aimX: intent.aimX,
      aimY: intent.aimY,
      fire: intent.fire && firstStep,
      superFire: intent.superFire && firstStep,
    });
    firstStep = false;
    world.step(STEP, commands);
  }

  for (const e of world.events) {
    if (e.type === 'hit') hud.damagePopup(e.x, e.y, e.damage, e.targetId === player.id);
  }
  scene.render(dt, { x: intent.aimX, y: intent.aimY, active: intent.aimActive, isSuper: intent.superAiming });
  world.events.length = 0;
  hud.update(dt);

  const over = !player.alive || world.winnerId !== null;
  if (over && match.endShownAt === null) match.endShownAt = now;
  if (over && match.endShownAt !== null && now - match.endShownAt > 1400 && endScreen.hidden) showEnd(player.rank, player.kills, player.cubes);
}

function showEnd(rank: number, kills: number, cubes: number) {
  const title = endScreen.querySelector<HTMLElement>('.end-rank')!;
  const sub = endScreen.querySelector<HTMLElement>('.end-sub')!;
  title.textContent = rank === 1 ? 'Winner!' : `#${rank}`;
  title.classList.toggle('end-win', rank === 1);
  sub.textContent = `${kills} knockout${kills === 1 ? '' : 's'} · ${cubes} power cube${cubes === 1 ? '' : 's'}`;
  endScreen.hidden = false;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

window.addEventListener('resize', () => match?.scene.resize());
document.querySelectorAll<HTMLElement>('[data-play]').forEach((b) =>
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    startMatch();
  }),
);
requestAnimationFrame(frame);
