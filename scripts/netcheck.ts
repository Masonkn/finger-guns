// Smoke test for the game server: two clients make a private duos match, team up, play a few seconds, one leaves.
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
console.log('lobby players', lobby2.players.map((p) => `${p.name}${p.isHost ? ' (host)' : ''} team ${p.team}`).join(', '));
// Only the host can change the mode or start.
b.send({ t: 'mode', teamSize: 4 });
b.send({ t: 'difficulty', level: 3 });
a.send({ t: 'difficulty', level: 0 });
const easy = await a.wait<Extract<ServerMessage, { t: 'lobby' }>>((m) => m.t === 'lobby' && m.difficulty === 0);
console.log('host set bots to very easy; guest change ignored:', !a.inbox.some((m) => m.t === 'lobby' && m.difficulty === 3), easy.difficulty);
b.send({ t: 'start' });
a.send({ t: 'mode', teamSize: 2 });
const duos = await a.wait<Extract<ServerMessage, { t: 'lobby' }>>((m) => m.t === 'lobby' && m.teamSize === 2);
console.log('host picked duos:', duos.players.map((p) => `${p.name} team ${p.team}`).join(', '));
if (!duos.players.every((p) => p.team === 0)) throw new Error('duos should seat A and B together');
b.send({ t: 'team', team: 3 });
await a.wait((m) => m.t === 'lobby' && m.players.some((p) => !p.isYou && p.team === 3));
b.send({ t: 'team', team: 0 });
const together = await a.wait<Extract<ServerMessage, { t: 'lobby' }>>(
  (m) => m.t === 'lobby' && m.players.length === 2 && m.players.every((p) => p.team === 0) && m !== duos,
);
console.log('B moved to team 3 and back to team 0:', together.players.map((p) => p.team).join(','));
if (a.inbox.some((m) => m.t === 'start')) throw new Error('non-host was able to start');
// Only the private host picks the map; the guest's pick is ignored.
b.send({ t: 'map', map: 'christmas' });
a.send({ t: 'map', map: 'halloween' });
const spooky = await b.wait<Extract<ServerMessage, { t: 'lobby' }>>((m) => m.t === 'lobby' && m.map === 'halloween');
console.log('host picked Halloween; guest pick ignored:', !b.inbox.some((m) => m.t === 'lobby' && m.map === 'christmas'), 'featured today', spooky.featured);
a.send({ t: 'start' });
const startA = await a.wait<Extract<ServerMessage, { t: 'start' }>>((m) => m.t === 'start');
const startB = await b.wait<Extract<ServerMessage, { t: 'start' }>>((m) => m.t === 'start');
console.log('started, seed', startA.seed, 'A is', startA.you, 'B is', startB.you, 'players', startA.players.length, 'team size', startA.teamSize);
const teamOf = (id: number) => startA.players.find((p) => p.id === id)!.team;
console.log('A and B on the same team:', teamOf(startA.you) === teamOf(startB.you));
console.log('both play the same map:', startA.map, startB.map);
if (startA.map !== 'halloween' || startB.map !== 'halloween') throw new Error('map not sent to both players');
const teamSizes = new Map<number, number>();
for (const p of startA.players) teamSizes.set(p.team, (teamSizes.get(p.team) ?? 0) + 1);
console.log('teams:', [...teamSizes.values()].join(','));

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
console.log('A always sees teammate B:', snapsA.every((s) => !s.alive.includes(startB.you) || s.b.some((x) => x.id === startB.you)));
const shots = snapsA.flatMap((s) => s.ev).filter((e) => e.type === 'shot' && e.brawlerId === startA.you).length;
console.log('A shots registered:', shots);
// A bush hider should only be sent when close or right after shooting.
const lastShot = new Map<number, number>();
let hiddenLeak = false;
for (const s of snapsA) {
  for (const e of s.ev) if (e.type === 'shot') lastShot.set(e.brawlerId, s.time);
  const team = s.b.filter((x) => teamOf(x.id) === teamOf(startA.you));
  for (const x of s.b) {
    if (teamOf(x.id) === teamOf(startA.you) || x.bush !== 1) continue;
    const near = team.some((m) => Math.hypot(x.x - m.x, x.y - m.y) < 2.4);
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

// Public lobbies: everyone lands in the same open lobby whatever their saved mode and level;
// the first player in sets both, later players can't change them.
const c = client('C');
const d = client('D');
await Promise.all([c.opened, d.opened]);
c.send({ t: 'join', name: 'Carl', mode: 'quick', teamSize: 3, difficulty: 1 });
const cl = await c.wait<Extract<ServerMessage, { t: 'lobby' }>>((m) => m.t === 'lobby');
d.send({ t: 'join', name: 'Dee', mode: 'quick', teamSize: 1, difficulty: 3 });
const both = await c.wait<Extract<ServerMessage, { t: 'lobby' }>>((m) => m.t === 'lobby' && m.players.length === 2);
console.log('different saved modes still meet in one public lobby:', both.players.map((p) => p.name).join(' + '), 'mode', both.teamSize);
d.send({ t: 'mode', teamSize: 4 });
c.send({ t: 'mode', teamSize: 2 });
await d.wait((m) => m.t === 'lobby' && m.teamSize === 2);
console.log('leader switched mode to duos; follower change ignored:', !d.inbox.some((m) => m.t === 'lobby' && m.teamSize === 4));
d.send({ t: 'difficulty', level: 3 });
c.send({ t: 'difficulty', level: 0 });
const dl = await d.wait<Extract<ServerMessage, { t: 'lobby' }>>((m) => m.t === 'lobby' && m.difficulty === 0);
console.log('public lobby started on first player\'s level:', cl.difficulty === 1, '; leader changed it to', dl.difficulty, '; follower ignored:', !d.inbox.some((m) => m.t === 'lobby' && m.difficulty === 3), '; follower can set:', dl.canSetDifficulty);
c.ws.close();
d.ws.close();
await new Promise((r) => setTimeout(r, 300));
process.exit(0);
