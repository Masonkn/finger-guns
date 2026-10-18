import './style.css';
import { LocalMatch } from './game/local';
import type { Match } from './game/match';
import { Hud } from './hud';
import { Input } from './input';
import { CustomizePanel } from './customize';
import { loadLook } from './render/cosmetics';
import { Connection } from './net/connection';
import { OnlineMatch } from './net/online';
import { BULLET, PLAYER_COUNT, SUPER } from './sim/config';
import { cleanName, type ServerMessage } from './net/protocol';
import { GameScene, createRenderer } from './render/scene';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const canvas = $<HTMLCanvasElement>('#game');
const hudRoot = $('#hud');
const superButton = $('#super');
const abilityButton = $('#ability');
const screens = { menu: $('#menu'), lobby: $('#lobby'), end: $('#end') };
const nameInput = $<HTMLInputElement>('#name');
const codeInput = $<HTMLInputElement>('#code');
const menuError = $('#menu-error');
const renderer = createRenderer(canvas);
let playerLook = loadLook();
const customizeRoot = document.querySelector<HTMLElement>('#customize')!;
const customize = new CustomizePanel(customizeRoot, playerLook, (look) => {
  playerLook = look;
});

type Mode = { kind: 'bots' } | { kind: 'quick' } | { kind: 'create' } | { kind: 'code'; code: string };

interface Running {
  match: Match;
  scene: GameScene;
  hud: Hud;
  mode: Mode;
  overAt: number | null;
}

let running: Running | null = null;
let input: Input | null = null;
let conn: Connection | null = null;

// --- Name -------------------------------------------------------------------

function loadName(): string {
  try {
    return localStorage.getItem('fg-name') ?? '';
  } catch {
    return '';
  }
}

function currentName(): string {
  const name = cleanName(nameInput.value);
  nameInput.value = name;
  try {
    localStorage.setItem('fg-name', name);
  } catch {
    // Private mode: the name just isn't remembered.
  }
  return name;
}

nameInput.value = loadName() || cleanName('');
// Builds with no game server (like the shareable single-file version) only offer bots.
if (import.meta.env.VITE_OFFLINE) {
  $('#play-online').hidden = true;
  $('.private-row').hidden = true;
}
const invite = new URLSearchParams(location.search).get('room');
if (invite) codeInput.value = invite.toUpperCase().slice(0, 4);

// --- Screens ----------------------------------------------------------------

function show(screen: keyof typeof screens | null) {
  for (const [key, el] of Object.entries(screens)) el.hidden = key !== screen;
}

function showMenu(error = '') {
  stopMatch();
  disconnect();
  menuError.textContent = error;
  show('menu');
}

function stopMatch() {
  if (!running) return;
  running.match.dispose();
  running.hud.destroy();
  running.scene.dispose();
  running = null;
}

function disconnect() {
  conn?.close();
  conn = null;
}

function beginMatch(match: Match, mode: Mode) {
  stopMatch();
  const visible = match.isVisible.bind(match);
  const scene = new GameScene(renderer, match.world, match.playerId, visible, match.lookOf.bind(match));
  if (!input) input = new Input(scene, hudRoot, superButton, abilityButton);
  else input.setScene(scene);
  const hud = new Hud(hudRoot, match.world, scene, match.playerId, superButton, abilityButton, visible);
  running = { match, scene, hud, mode, overAt: null };
  show(null);
  // ?debug exposes the running match for poking at from the console (and from tests).
  if (new URLSearchParams(location.search).has('debug')) (window as unknown as { fg: Running }).fg = running;
}

// --- Online -----------------------------------------------------------------

async function playOnline(mode: Exclude<Mode, { kind: 'bots' }>) {
  stopMatch();
  disconnect();
  const name = currentName();
  renderLobby({ t: 'lobby', code: null, players: [{ name, isYou: true }], startsIn: null, canStart: false }, 'Connecting…');
  show('lobby');
  const c = new Connection();
  conn = c;
  try {
    await c.opened;
  } catch {
    if (conn === c) showMenu('Could not reach the game server. Try again in a moment, or play vs bots.');
    return;
  }
  if (conn !== c) return;

  c.onMessage = (msg) => onServerMessage(c, msg, mode);
  c.onClose = (unexpected) => {
    if (!unexpected || conn !== c) return;
    if (running?.match instanceof OnlineMatch && running.match.result) return; // match already decided
    showMenu('Lost connection to the game server.');
  };
  const look = { color: playerLook.color, topper: playerLook.topper };
  if (mode.kind === 'code') c.send({ t: 'join', name, look, mode: 'code', code: mode.code });
  else c.send({ t: 'join', name, look, mode: mode.kind });
}

function onServerMessage(c: Connection, msg: ServerMessage, mode: Mode) {
  switch (msg.t) {
    case 'lobby':
      renderLobby(msg);
      break;
    case 'start':
      // Joining by code once puts you in that room; a rematch should make a new one.
      beginMatch(new OnlineMatch(c, msg), mode.kind === 'code' ? { kind: 'create' } : mode);
      break;
    case 'error':
      showMenu(msg.message);
      break;
    default:
      if (running?.match instanceof OnlineMatch) running.match.handle(msg);
  }
}

function renderLobby(msg: Extract<ServerMessage, { t: 'lobby' }>, status?: string) {
  $('#lobby-title').textContent = msg.code ? 'Private match' : 'Finding players…';
  $('#lobby-code').hidden = !msg.code;
  $('#lobby-code-value').textContent = msg.code ?? '';
  $('#lobby-start').hidden = !msg.canStart;
  const humans = msg.players.length;
  $('#lobby-status').textContent =
    status ??
    (msg.startsIn !== null
      ? `${humans}/${PLAYER_COUNT} players · starting in ${msg.startsIn}s · bots fill empty spots`
      : `${humans}/${PLAYER_COUNT} players · start when everyone's in · bots fill empty spots`);
  const list = $('#lobby-players');
  list.replaceChildren(
    ...msg.players.map((p) => {
      const li = document.createElement('li');
      li.textContent = p.isYou ? `${p.name} (you)` : p.name;
      if (p.isYou) li.className = 'you';
      return li;
    }),
  );
}

$('#lobby-start').addEventListener('click', () => conn?.send({ t: 'start' }));
$('#lobby-cancel').addEventListener('click', () => showMenu());
$('#copy-link').addEventListener('click', async (e) => {
  const button = e.currentTarget as HTMLButtonElement;
  const url = new URL(location.href);
  url.search = `?room=${$('#lobby-code-value').textContent}`;
  try {
    await navigator.clipboard.writeText(url.toString());
    button.textContent = 'Copied!';
  } catch {
    button.textContent = url.toString();
  }
  setTimeout(() => (button.textContent = 'Copy invite link'), 2500);
});

// --- Menu buttons -----------------------------------------------------------

function startMode(mode: Mode) {
  if (mode.kind === 'bots') {
    disconnect();
    beginMatch(new LocalMatch(currentName(), playerLook), mode);
  } else {
    void playOnline(mode);
  }
}

$('#play-online').addEventListener('click', () => startMode({ kind: 'quick' }));
$('#play-bots').addEventListener('click', () => startMode({ kind: 'bots' }));
$('#create-private').addEventListener('click', () => startMode({ kind: 'create' }));
$('#join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = codeInput.value.trim().toUpperCase();
  if (code.length !== 4) {
    menuError.textContent = 'Match codes are 4 letters.';
    return;
  }
  startMode({ kind: 'code', code });
});
$('#play-again').addEventListener('click', () => running && startMode(running.mode));
$('#to-menu').addEventListener('click', () => showMenu());

// --- Frame loop -------------------------------------------------------------

function autoAimDirection(match: Match, range: number): { x: number; y: number } | null {
  const { world } = match;
  const p = world.brawlers.find((b) => b.id === match.playerId)!;
  let best: { x: number; y: number } | null = null;
  let bestD = range;
  for (const b of world.brawlers) {
    if (!b.alive || b.id === p.id || !match.isVisible(b)) continue;
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

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!running || !input) return;
  const { match, scene, hud } = running;
  const world = match.world;
  const player = world.brawlers.find((b) => b.id === match.playerId)!;

  const intent = input.read(player.x, player.y);
  if (intent.autoAim) {
    const d = autoAimDirection(match, intent.superFire ? SUPER.range : BULLET.range);
    if (d) {
      intent.aimX = d.x;
      intent.aimY = d.y;
    }
  }
  match.update(dt, intent);

  for (const e of world.events) {
    if (e.type === 'hit') hud.damagePopup(e.x, e.y, e.damage, e.targetId === player.id, e.blocked);
    if (e.type === 'abilityUnlock' && e.brawlerId === player.id) hud.abilityUnlocked(e.ability);
    if (e.type === 'fingerPickup' && e.brawlerId === player.id) hud.announce(`${e.fingers}-finger gun!`, 1.6);
  }
  scene.render(dt, { x: intent.aimX, y: intent.aimY, active: intent.aimActive, isSuper: intent.superAiming });
  world.events.length = 0;
  hud.update(dt);

  const result = match.result;
  if (result && running.overAt === null) running.overAt = now;
  if (result && running.overAt !== null && now - running.overAt > 1400 && screens.end.hidden && customizeRoot.hidden) {
    const title = $('.end-rank');
    title.textContent = result.rank === 1 ? 'Winner!' : `#${result.rank}`;
    title.classList.toggle('end-win', result.rank === 1);
    const stats = `${result.kills} knockout${result.kills === 1 ? '' : 's'} · ${result.cubes} power cube${result.cubes === 1 ? '' : 's'}`;
    const winner = result.rank !== 1 && result.winner ? ` · ${result.winner} won` : '';
    $('.end-sub').textContent = stats + winner;
    show('end');
  }
}

window.addEventListener('resize', () => running?.scene.resize());
document.querySelectorAll<HTMLElement>('[data-customize]').forEach((b) =>
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    customize.open(b.closest<HTMLElement>('.screen')!);
  }),
);
requestAnimationFrame(frame);
