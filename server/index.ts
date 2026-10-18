import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer } from 'ws';
import { ClientMessage, ROOM_CODE_LENGTH, TICK, cleanLook, cleanName } from '../src/net/protocol';
import { DEFAULT_BOT_DIFFICULTY, TeamSize, isBotDifficulty, isTeamSize } from '../src/sim/config';
import { Client, Room, send } from './room';

// One process serves the built game (dist/) and runs every match over WebSockets at /ws.

const PORT = Number(process.env.PORT ?? 2567);
const STATIC_DIR = resolve(process.env.STATIC_DIR ?? 'dist');
const LAG_MS = Number(process.env.LAG_MS ?? 0);
const MAX_MESSAGES_PER_SECOND = 90; // inputs arrive at 30/s; anything far above that is abuse

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

const rooms = new Map<string, Room>();
let nextRoomId = 1;

const http = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  // Static files, guarded against path traversal; unknown paths fall back to the game page.
  let pathname = url.pathname;
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    // Keep the raw path; it just won't match a file.
  }
  const requested = normalize(join(STATIC_DIR, pathname));
  let file = requested.startsWith(STATIC_DIR) ? requested : join(STATIC_DIR, 'index.html');
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(STATIC_DIR, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404);
    res.end('Build the client first: npm run build');
    return;
  }
  const isAsset = file.includes(`${join(STATIC_DIR, 'assets')}`);
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'cache-control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 2048 });

wss.on('connection', (ws) => {
  const client: Client = {
    ws,
    name: '',
    look: null,
    room: null,
    team: 0,
    brawlerId: null,
    inputs: [],
    last: null,
    ackSeq: 0,
    moveCredit: 0,
    resultSent: false,
  };
  let windowStart = Date.now();
  let messages = 0;

  ws.on('message', (data) => {
    const now = Date.now();
    if (now - windowStart > 1000) {
      windowStart = now;
      messages = 0;
    }
    if (++messages > MAX_MESSAGES_PER_SECOND) {
      ws.close(1008, 'Too many messages');
      return;
    }
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    if (LAG_MS > 0) setTimeout(() => handle(client, msg), LAG_MS);
    else handle(client, msg);
  });
  ws.on('close', () => client.room?.remove(client));
});

function handle(client: Client, msg: ClientMessage) {
  switch (msg?.t) {
    case 'join': {
      client.room?.remove(client);
      client.name = cleanName(msg.name);
      client.look = cleanLook(msg.look);
      const room = findRoom(client, msg);
      if (room) room.add(client);
      break;
    }
    case 'start':
      client.room?.requestStart(client);
      break;
    case 'mode':
      if (isTeamSize(msg.teamSize)) client.room?.setTeamSize(client, msg.teamSize);
      break;
    case 'difficulty':
      if (isBotDifficulty(msg.level)) client.room?.setDifficulty(client, msg.level);
      break;
    case 'team':
      client.room?.setTeam(client, Number(msg.team));
      break;
    case 'input':
      client.room?.queueInput(client, {
        t: 'input',
        seq: int(msg.seq),
        mx: clamp(msg.mx, 1),
        my: clamp(msg.my, 1),
        ax: clamp(msg.ax, 100),
        ay: clamp(msg.ay, 100),
        f: msg.f ? 1 : 0,
        s: msg.s ? 1 : 0,
        q: msg.q ? 1 : 0,
      });
      break;
    case 'leave':
      client.room?.remove(client);
      break;
  }
}

function findRoom(client: Client, msg: Extract<ClientMessage, { t: 'join' }>): Room | null {
  if (msg.mode === 'code') {
    const code = String(msg.code ?? '').toUpperCase().trim();
    const room = [...rooms.values()].find((r) => r.code === code);
    if (!room) send(client.ws, { t: 'error', message: `No match found with code ${code || '(blank)'}.` });
    else if (room.state !== 'lobby') send(client.ws, { t: 'error', message: 'That match has already started.' });
    else if (room.isFull) send(client.ws, { t: 'error', message: 'That match is full.' });
    else return room;
    return null;
  }
  const teamSize: TeamSize = isTeamSize(msg.teamSize) ? msg.teamSize : 1;
  // A new room starts on its first player's bot difficulty; they can change it in the lobby.
  const level = isBotDifficulty(msg.difficulty) ? msg.difficulty : DEFAULT_BOT_DIFFICULTY;
  if (msg.mode === 'create') return createRoom(newCode(), teamSize, level);
  // Everyone pressing Play online joins the same open lobby, whatever mode or bot level they
  // last used, so friends always find each other. The lobby's first player sets both.
  const open = [...rooms.values()].find((r) => !r.isPrivate && r.state === 'lobby' && !r.isFull);
  return open ?? createRoom(null, teamSize, level);
}

function createRoom(code: string | null, teamSize: TeamSize, difficulty = DEFAULT_BOT_DIFFICULTY): Room {
  const room = new Room(String(nextRoomId++), code, teamSize, difficulty);
  rooms.set(room.id, room);
  return room;
}

function newCode(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O, they read like numbers
  for (;;) {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += letters[Math.floor(Math.random() * letters.length)];
    if (![...rooms.values()].some((r) => r.code === code)) return code;
  }
}

function clamp(v: unknown, limit: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(-limit, Math.min(limit, n)) : 0;
}

function int(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : 0;
}

// Fixed-rate game loop shared by every room, catching up if the timer runs late.
let last = performance.now();
let acc = 0;
setInterval(() => {
  const now = performance.now();
  acc = Math.min(acc + (now - last) / 1000, TICK * 5);
  last = now;
  while (acc >= TICK) {
    acc -= TICK;
    for (const [id, room] of rooms) {
      room.update(TICK);
      if (room.isClosed) {
        for (const c of room.clients) room.remove(c);
        rooms.delete(id);
      }
    }
  }
}, 1000 * TICK * 0.5);

http.listen(PORT, () => console.log(`Finger Guns server on http://localhost:${PORT} (ws at /ws)`));
