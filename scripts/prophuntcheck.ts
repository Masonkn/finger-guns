// Smoke test for prop hunt online: a private prop hunt match with two players, checking the
// round state, disguises and block picks come through. Run with the server up:
// npx tsx scripts/prophuntcheck.ts [ws://localhost:2567/ws]
import WebSocket from 'ws';
import { PROP_KINDS } from '../src/sim/config';
import type { ServerMessage, Snapshot } from '../src/net/protocol';

const URL = process.argv[2] ?? 'ws://localhost:2567/ws';

function client(name: string) {
  const ws = new WebSocket(URL);
  const inbox: ServerMessage[] = [];
  ws.on('message', (d) => inbox.push(JSON.parse(String(d)) as ServerMessage));
  const opened = new Promise((r) => ws.on('open', r));
  const wait = async <T extends ServerMessage>(pred: (m: ServerMessage) => boolean, ms = 5000): Promise<T> => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const i = inbox.findIndex(pred);
      if (i >= 0) return inbox.splice(0, i + 1).pop() as T;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`${name}: timed out`);
  };
  return { ws, inbox, opened, wait, send: (m: object) => ws.send(JSON.stringify(m)) };
}

const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) process.exitCode = 1;
};

const a = client('A');
const b = client('B');
await Promise.all([a.opened, b.opened]);
a.send({ t: 'join', name: 'Mason', mode: 'create', game: 'propHunt', blocks: 'random' });
const lobby = await a.wait<Extract<ServerMessage, { t: 'lobby' }>>((m) => m.t === 'lobby');
check(lobby.game === 'propHunt' && lobby.blocks === 'random' && lobby.canSetGame === true, 'host creates a prop hunt lobby');
b.send({ t: 'join', name: 'Kid', mode: 'code', code: lobby.code });
await a.wait((m) => m.t === 'lobby' && m.players.length === 2);
b.send({ t: 'game', game: 'showdown' }); // only the host can change it
a.send({ t: 'blocks', blocks: 'pick' });
const picked = await b.wait<Extract<ServerMessage, { t: 'lobby' }>>((m) => m.t === 'lobby' && m.blocks === 'pick');
check(picked.game === 'propHunt' && picked.canSetGame === false, 'only the host picks the game and blocks');
a.send({ t: 'start' });
const startA = await a.wait<Extract<ServerMessage, { t: 'start' }>>((m) => m.t === 'start');
const startB = await b.wait<Extract<ServerMessage, { t: 'start' }>>((m) => m.t === 'start');
check(startA.game === 'propHunt' && startA.blocks === 'pick' && startA.teamSize === 1, 'start says prop hunt');
check(new Set(startA.players.map((p) => p.team)).size === 12, 'everyone is on their own team');

const snapA = await a.wait<Snapshot>((m) => m.t === 'snap');
const ph = snapA.ph!;
check(!!ph && ph.phase === 'hide' && ph.round === 1, 'snapshots carry the round state');
// The first seeker is random, often a bot; then both players are hiders.
const seekerIsA = ph.seekerId === startA.you;
const seekerIsB = ph.seekerId === startB.you;
console.log(`     seeker is ${seekerIsA ? 'Mason' : seekerIsB ? 'Kid' : 'a bot'}`);
const hider = seekerIsA ? b : a;
const hiderId = seekerIsA ? startB.you : startA.you;
const seeker = seekerIsA ? a : seekerIsB ? b : null;
const seekerId = ph.seekerId;
const mine = (s: Snapshot, id: number) => s.b.find((x) => x.id === id);

// The hider picks a block; the seeker can't move or see anyone while asleep.
let seq = 1;
const input = (c: typeof a, extra: object = {}) => c.send({ t: 'input', seq: seq++, mx: 1, my: 0, ax: 0, ay: 0, f: 0, s: 0, ...extra });
for (let i = 0; i < 10; i++) {
  input(hider, i === 3 ? { p: PROP_KINDS.indexOf('crate') } : {});
  if (seeker) input(seeker);
  await new Promise((r) => setTimeout(r, 34));
}
await new Promise((r) => setTimeout(r, 200));
hider.inbox.length = 0;
const h = await hider.wait<Snapshot>((m) => m.t === 'snap');
check(mine(h, hiderId)?.pk === PROP_KINDS.indexOf('crate'), 'hider picked the crate');
check(mine(h, seekerId)?.pk === undefined, 'the seeker is not a block');
const sx = mine(h, seekerId)!;
check(Math.abs(sx.x - 25) < 0.01 && Math.abs(sx.y - 25) < 0.01, 'the sleeping seeker stays in the middle');
if (seeker) {
  seeker.inbox.length = 0;
  const s = await seeker.wait<Snapshot>((m) => m.t === 'snap');
  check(s.b.length === 1 && s.b[0].id === seekerId, 'the sleeping seeker sees nobody');
}
// Shooting as a hider swaps to a random block.
input(hider, { f: 1 });
await new Promise((r) => setTimeout(r, 200));
hider.inbox.length = 0;
const h2 = await hider.wait<Snapshot>((m) => m.t === 'snap');
const pk = mine(h2, hiderId)?.pk;
check(pk !== undefined && pk !== PROP_KINDS.indexOf('crate'), `shooting swapped the block to ${PROP_KINDS[pk ?? 0]}`);
a.ws.close();
b.ws.close();
