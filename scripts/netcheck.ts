// Smoke test for the game server: two clients make a private match, play a few seconds, one leaves.
// Run with the server up: npx tsx scripts/netcheck.ts [ws://localhost:2567/ws]
import WebSocket from 'ws';
import type { ServerMessage } from '../src/net/protocol';

const URL = process.argv[2] ?? 'ws://localhost:2567/ws';

function client(name: string) {
  const ws = new WebSocket(URL);
  const inbox: ServerMessage[] = [];
  const waiters: [(m: ServerMessage) => boolean, (m: ServerMessage) => void][] = [];
  ws.on('message', (d) => {
    const m = JSON.parse(String(d)) as ServerMessage;
    inbox.push(m);
    for (const w of [...waiters]) if (w[0](m)) { waiters.splice(waiters.indexOf(w), 1); w[1](m); }
  });
  const wait = <T extends ServerMessage>(pred: (m: ServerMessage) => boolean, ms = 5000) =>
    new Promise<T>((res, rej) => {
      const hit = inbox.find(pred);
      if (hit) return res(hit as T);
      const timer = setTimeout(() => rej(new Error(`${name}: timed out`)), ms);
      waiters.push([pred, (m) => { clearTimeout(timer); res(m as T); }]);
    });
  const opened = new Promise((r) => ws.on('open', r));
  return { ws, inbox, wait, opened, send: (m: object) => ws.send(JSON.stringify(m)) };
}

const a = client('A');
const b = client('B');
await Promise.all([a.opened, b.opened]);
a.send({ t: 'join', name: 'Alice', mode: 'create' });
const lobby = await a.wait<Extract<ServerMessage, { t: 'lobby' }>>((m) => m.t === 'lobby');
console.log('private code', lobby.code);
b.send({ t: 'join', name: 'Bob<script>', mode: 'code', code: lobby.code });
const lobby2 = await a.wait<Extract<ServerMessage, { t: 'lobby' }>>((m) => m.t === 'lobby' && m.players.length === 2);
console.log('lobby players', lobby2.players.map((p) => p.name).join(', '));
b.send({ t: 'start' });
const startA = await a.wait<Extract<ServerMessage, { t: 'start' }>>((m) => m.t === 'start');
const startB = await b.wait<Extract<ServerMessage, { t: 'start' }>>((m) => m.t === 'start');
console.log('started, seed', startA.seed, 'A is', startA.you, 'B is', startB.you, 'players', startA.players.length);

let seq = 0;
const timer = setInterval(() => {
  seq++;
  a.send({ t: 'input', seq, mx: 1, my: 0, ax: 1, ay: 0, f: seq % 10 === 0 ? 1 : 0, s: 0 });
  b.send({ t: 'input', seq, mx: 0, my: 1, ax: 0, ay: 1, f: 0, s: 0 });
}, 1000 / 30);

await new Promise((r) => setTimeout(r, 3000));
const snapsA = a.inbox.filter((m) => m.t === 'snap') as Extract<ServerMessage, { t: 'snap' }>[];
const lastA = snapsA[snapsA.length - 1];
const meA = lastA.b.find((x) => x.id === startA.you)!;
const bytes = JSON.stringify(lastA).length;
console.log(`A got ${snapsA.length} snapshots in 3s, last ack ${lastA.ack}/${seq}, size ${bytes} B`);
console.log(`A moved from spawn to (${meA.x}, ${meA.y}), ammo ${meA.ammo}; sees ${lastA.b.length}/${lastA.alive.length} alive brawlers`);
const shots = snapsA.flatMap((s) => s.ev).filter((e) => e.type === 'shot' && e.brawlerId === startA.you).length;
console.log('A shots registered:', shots);
// A bush hider should only be sent when close or right after shooting.
const lastShot = new Map<number, number>();
let hiddenLeak = false;
for (const s of snapsA) {
  for (const e of s.ev) if (e.type === 'shot') lastShot.set(e.brawlerId, s.time);
  const me = s.b.find((x) => x.id === startA.you)!;
  for (const x of s.b) {
    if (x.id === startA.you || x.bush !== 1) continue;
    const near = Math.hypot(x.x - me.x, x.y - me.y) < 2.4;
    const shotRecently = s.time - (lastShot.get(x.id) ?? -10) < 0.65;
    if (!near && !shotRecently) hiddenLeak = true;
  }
}
console.log('hidden bush positions leaked:', hiddenLeak);

clearInterval(timer);
b.ws.close();
await new Promise((r) => setTimeout(r, 1500));
const after = a.inbox.filter((m) => m.t === 'snap').slice(-1)[0] as Extract<ServerMessage, { t: 'snap' }>;
console.log('B left; B still alive in match (now a bot):', after.alive.includes(startB.you));
a.ws.close();
await new Promise((r) => setTimeout(r, 300));
process.exit(0);
