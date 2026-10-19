import './style.css';
import { LocalMatch } from './game/local';
import type { Match } from './game/match';
import { Hud } from './hud';
import { Input } from './input';
import { CustomizePanel } from './customize';
import { loadLook } from './render/cosmetics';
import { Connection } from './net/connection';
import { OnlineMatch } from './net/online';
import {
  BOT_DIFFICULTY_NAMES,
  BotDifficulty,
  DEFAULT_BOT_DIFFICULTY,
  PLAYER_COUNT,
  SUPER,
  TEAM_MODE_NAMES,
  TEAM_SIZES,
  TeamSize,
  isBotDifficulty,
  isTeamSize,
  teamCount,
} from './sim/config';
import { type LobbyPlayer, type ServerMessage, cleanName } from './net/protocol';
import { GameScene, createRenderer } from './render/scene';
import { type World, ammoOf } from './sim/world';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const canvas = $<HTMLCanvasElement>('#game');
const hudRoot = $('#hud');
const superButton = $('#super');
const abilityButton = $('#ability');
const quitButton = $('#quit');
const screens = { menu: $('#menu'), lobby: $('#lobby'), quit: $('#quit-confirm'), end: $('#end') };
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
  lobbyMode = null;
  lastLobby = null;
  menuError.textContent = error;
  show('menu');
}

function stopMatch() {
  if (!running) return;
  running.match.dispose();
  running.hud.destroy();
  running.scene.dispose();
  running = null;
  quitButton.style.display = 'none';
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
  lobbyMode = null;
  lastLobby = null;
  quitButton.style.display = 'block';
  show(null);
  // ?debug exposes the running match for poking at from the console (and from tests).
  if (new URLSearchParams(location.search).has('debug')) (window as unknown as { fg: Running }).fg = running;
}

// --- Lobby ------------------------------------------------------------------

// Everyone passes through the lobby before a match: pick solo or a team size, see who's in.
let teamSize: TeamSize = loadTeamSize();
let difficulty: BotDifficulty = loadDifficulty();
let lobbyMode: Mode | null = null; // the lobby on screen, if any
let lastLobby: LobbyMessage | null = null;

type LobbyMessage = Extract<ServerMessage, { t: 'lobby' }>;

function loadTeamSize(): TeamSize {
  try {
    const n = Number(localStorage.getItem('fg-team-size'));
    return isTeamSize(n) ? n : 1;
  } catch {
    return 1;
  }
}

function saveTeamSize(size: TeamSize) {
  teamSize = size;
  try {
    localStorage.setItem('fg-team-size', String(size));
  } catch {
    // Not remembered in private mode.
  }
}

function loadDifficulty(): BotDifficulty {
  try {
    const n = Number(localStorage.getItem('fg-bot-difficulty') ?? DEFAULT_BOT_DIFFICULTY);
    return isBotDifficulty(n) ? n : DEFAULT_BOT_DIFFICULTY;
  } catch {
    return DEFAULT_BOT_DIFFICULTY;
  }
}

function saveDifficulty(level: BotDifficulty) {
  difficulty = level;
  try {
    localStorage.setItem('fg-bot-difficulty', String(level));
  } catch {
    // Not remembered in private mode.
  }
}

interface LobbyView {
  title: string;
  code: string | null;
  teamSize: TeamSize;
  players: LobbyPlayer[];
  status: string;
  canStart: boolean;
  startLabel: string;
  canPickMode: boolean;
  canPickTeam: boolean;
  difficulty: BotDifficulty | null; // null hides the picker
  canPickDifficulty: boolean;
}

function openBotsLobby() {
  stopMatch();
  disconnect();
  lobbyMode = { kind: 'bots' };
  renderBotsLobby();
  show('lobby');
}

function renderBotsLobby() {
  renderLobby({
    title: 'Vs bots',
    code: null,
    teamSize,
    players: [{ name: currentName(), isYou: true, isHost: true, team: 0 }],
    status: teamSize > 1 ? 'Bots fill your team and every other spot' : `You vs ${PLAYER_COUNT - 1} bots`,
    canStart: true,
    startLabel: 'START',
    canPickMode: true,
    canPickTeam: false,
    difficulty,
    canPickDifficulty: true,
  });
}

function renderServerLobby(msg: LobbyMessage, status?: string) {
  lastLobby = msg;
  const humans = msg.players.length;
  const host = msg.players.find((p) => p.isHost);
  let line: string;
  if (status) line = status;
  else if (msg.startsIn !== null) line = `${humans}/${PLAYER_COUNT} players · starting in ${msg.startsIn}s · bots fill empty spots`;
  else if (msg.canStart) line = `${humans}/${PLAYER_COUNT} players · start when everyone's in · bots fill empty spots`;
  else line = `${humans}/${PLAYER_COUNT} players · waiting for ${host?.name ?? 'the host'} to start`;
  renderLobby({
    title: msg.code ? 'Private match' : 'Finding players…',
    code: msg.code,
    teamSize: msg.teamSize,
    players: msg.players,
    status: line,
    canStart: msg.canStart,
    startLabel: 'START NOW',
    // Public lobbies are split by mode, so picking one moves you to that queue.
    canPickMode: msg.canSetMode && !status,
    canPickTeam: msg.teamSize > 1 && !status,
    difficulty: msg.difficulty,
    canPickDifficulty: msg.canSetDifficulty && !status,
  });
}

function renderLobby(v: LobbyView) {
  $('#lobby-title').textContent = v.title;
  $('#lobby-code').hidden = !v.code;
  $('#lobby-code-value').textContent = v.code ?? '';
  const start = $('#lobby-start');
  start.hidden = !v.canStart;
  start.textContent = v.startLabel;
  $('#lobby-status').textContent = v.status;
  $('#lobby-difficulty').hidden = v.difficulty === null;
  if (v.difficulty !== null) {
    // Big tap-friendly steps rather than a range input, which iPads won't drag inside the lobby.
    $('#difficulty-steps').replaceChildren(
      ...BOT_DIFFICULTY_NAMES.map((label, level) => {
        const b = document.createElement('button');
        b.className = `difficulty-step${level === v.difficulty ? ' mode-on' : ''}`;
        b.textContent = label;
        b.disabled = !v.canPickDifficulty && level !== v.difficulty;
        b.setAttribute('aria-pressed', String(level === v.difficulty));
        b.addEventListener('click', () => isBotDifficulty(level) && pickDifficulty(level));
        return b;
      }),
    );
    const leader = v.players[0];
    $('#difficulty-note').textContent =
      v.canPickDifficulty || !leader || leader.isYou ? '' : `${leader.name} picks the mode and how well the bots play`;
  }

  $('#lobby-modes').replaceChildren(
    ...TEAM_SIZES.map((size) => {
      const b = document.createElement('button');
      b.className = `mode-chip${size === v.teamSize ? ' mode-on' : ''}`;
      b.textContent = TEAM_MODE_NAMES[size];
      b.title = size === 1 ? 'Every hand for itself' : `Teams of ${size}`;
      b.disabled = !v.canPickMode && size !== v.teamSize;
      b.setAttribute('aria-pressed', String(size === v.teamSize));
      b.addEventListener('click', () => pickTeamSize(size));
      return b;
    }),
  );

  const nameRow = (p: LobbyPlayer | undefined) => {
    const li = document.createElement('li');
    if (!p) {
      li.textContent = 'Bot';
      li.className = 'empty';
      return li;
    }
    li.textContent = `${p.name}${p.isYou ? ' (you)' : ''}${p.isHost ? ' ★' : ''}`;
    if (p.isYou) li.className = 'you';
    return li;
  };

  const box = $('#lobby-teams');
  if (v.teamSize === 1) {
    const list = document.createElement('ul');
    list.className = 'lobby-players';
    for (let i = 0; i < PLAYER_COUNT; i++) list.append(nameRow(v.players[i]));
    box.replaceChildren(list);
    return;
  }
  const me = v.players.find((p) => p.isYou);
  const cards: HTMLElement[] = [];
  for (let t = 0; t < teamCount(v.teamSize); t++) {
    const members = v.players.filter((p) => p.team === t);
    const card = document.createElement('div');
    card.className = `lobby-team${me?.team === t ? ' lobby-team-mine' : ''}`;
    const head = document.createElement('div');
    head.className = 'lobby-team-name';
    head.textContent = `Team ${t + 1}`;
    const list = document.createElement('ul');
    for (let i = 0; i < v.teamSize; i++) list.append(nameRow(members[i]));
    card.append(head, list);
    if (v.canPickTeam && me && me.team !== t && members.length < v.teamSize) {
      card.classList.add('lobby-team-open');
      card.tabIndex = 0;
      card.title = 'Join this team';
      const join = () => conn?.send({ t: 'team', team: t });
      card.addEventListener('click', join);
      card.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && join());
    }
    cards.push(card);
  }
  box.replaceChildren(...cards);
}

function pickDifficulty(level: BotDifficulty) {
  saveDifficulty(level);
  if (lobbyMode?.kind === 'bots') renderBotsLobby();
  else if (lastLobby && lastLobby.difficulty !== level) conn?.send({ t: 'difficulty', level });
}

function pickTeamSize(size: TeamSize) {
  if (!lobbyMode) return;
  if (lobbyMode.kind === 'bots') {
    saveTeamSize(size);
    renderBotsLobby();
  } else if (lastLobby && lastLobby.teamSize !== size) {
    conn?.send({ t: 'mode', teamSize: size });
    saveTeamSize(size);
  }
}

// --- Online -----------------------------------------------------------------

async function playOnline(mode: Exclude<Mode, { kind: 'bots' }>) {
  stopMatch();
  disconnect();
  lobbyMode = mode;
  const name = currentName();
  renderServerLobby(
    {
      t: 'lobby',
      code: null,
      teamSize,
      difficulty,
      players: [{ name, isYou: true, isHost: false, team: 0 }],
      startsIn: null,
      canStart: false,
      canSetDifficulty: false,
      canSetMode: false,
    },
    'Connecting…',
  );
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
  const look = { color: playerLook.color, topper: playerLook.topper, glove: playerLook.glove, sleeve: playerLook.sleeve };
  if (mode.kind === 'code') c.send({ t: 'join', name, look, mode: 'code', code: mode.code });
  else if (mode.kind === 'create') c.send({ t: 'join', name, look, mode: 'create', teamSize, difficulty });
  else c.send({ t: 'join', name, look, mode: 'quick', teamSize, difficulty });
}

function onServerMessage(c: Connection, msg: ServerMessage, mode: Mode) {
  switch (msg.t) {
    case 'lobby':
      renderServerLobby(msg);
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

$('#lobby-start').addEventListener('click', () => {
  if (lobbyMode?.kind === 'bots') startBotsMatch();
  else conn?.send({ t: 'start' });
});
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

// --- Quitting mid-match -----------------------------------------------------

function openQuitConfirm() {
  if (!running || !screens.end.hidden || !customizeRoot.hidden) return;
  $('#quit-note').textContent =
    running.match instanceof OnlineMatch
      ? 'A bot will take over your hand for the rest of the match.'
      : 'This match will end and you go back to the menu.';
  show('quit');
}

function closeQuitConfirm() {
  if (!screens.quit.hidden) show(null);
}

quitButton.addEventListener('pointerdown', (e) => e.stopPropagation()); // don't shoot through it
quitButton.addEventListener('click', openQuitConfirm);
$('#quit-yes').addEventListener('click', () => showMenu());
$('#quit-no').addEventListener('click', closeQuitConfirm);
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.repeat) return;
  if (!screens.quit.hidden) closeQuitConfirm();
  else if (running && screens.end.hidden) openQuitConfirm();
});

// --- Menu buttons -----------------------------------------------------------

function startBotsMatch() {
  disconnect();
  lobbyMode = null;
  beginMatch(new LocalMatch(currentName(), playerLook, teamSize, difficulty), { kind: 'bots' });
}

function startMode(mode: Mode) {
  if (mode.kind === 'bots') openBotsLobby();
  else void playOnline(mode);
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
// Vs bots goes straight into another match with the same teams; online goes back to a lobby.
$('#play-again').addEventListener('click', () => {
  if (!running) return;
  if (running.mode.kind === 'bots') startBotsMatch();
  else startMode(running.mode);
});
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

function nameOf(world: World, id: number): string {
  return world.brawlers.find((b) => b.id === id)?.name ?? 'Your teammate';
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
    const d = autoAimDirection(match, intent.superFire ? SUPER.range : ammoOf(player).range);
    if (d) {
      intent.aimX = d.x;
      intent.aimY = d.y;
    }
  }
  match.update(dt, intent);

  for (const e of world.events) {
    if (e.type === 'hit') hud.damagePopup(e.x, e.y, e.damage, e.targetId === player.id, e.blocked);
    if (e.type === 'abilityUnlock' && e.brawlerId === player.id) hud.abilityUnlocked(e.ability);
    if (e.type === 'fingerPickup' && e.brawlerId === player.id) {
      hud.announce(e.sharedBy ? `${nameOf(world, e.sharedBy)} shared a finger! ${e.fingers}-finger gun!` : `${e.fingers}-finger gun!`, 1.8);
    }
    if (e.type === 'pickup' && e.brawlerId === player.id && e.sharedBy) {
      hud.announce(`${nameOf(world, e.sharedBy)} shared a power cube!`, 1.6);
    }
    if (e.type === 'ammoPickup' && e.brawlerId === player.id) hud.ammoPickedUp(e.kind);
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
    quitButton.style.display = 'none';
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
