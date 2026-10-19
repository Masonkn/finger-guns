// Headless check that a full match of bots plays out: someone wins, nobody gets stuck.
import { BotBrain } from '../src/sim/bot';
import { PLAYER_COUNT, isBlockChoice, isBotDifficulty, isTeamSize } from '../src/sim/config';
import { Command, World, fingerCount, winnerLabel } from '../src/sim/world';

// npx tsx scripts/simulate.ts [matches] [team size 1-4]
// npx tsx scripts/simulate.ts [matches] prop [pick|random] [bot level 0-3]
const STEP = 1 / 60;
const matches = Number(process.argv[2] ?? 5);
if (process.argv[3] === 'prop') {
  simulatePropHunt();
  process.exit();
}
const teamSize = Number(process.argv[3] ?? 1);
if (!isTeamSize(teamSize)) throw new Error('Team size must be 1 to 4');
for (let m = 0; m < matches; m++) {
  const slots = Array.from({ length: PLAYER_COUNT }, (_, i) => ({ name: `Bot${i}`, isBot: true, team: Math.floor(i / teamSize) }));
  const world = new World(1000 + m * 7919, slots, teamSize);
  const brain = new BotBrain(world);
  let shots = 0;
  let crates = 0;
  let fingerPickups = 0;
  const abilities = { dash: 0, shield: 0, rapidFire: 0 };
  let blocked = 0;
  const ammoPickups: Record<string, number> = {};
  while (world.winnerId === null && world.time < 300) {
    const cmds = new Map<number, Command>();
    for (const b of world.brawlers) if (b.alive) cmds.set(b.id, brain.command(b, STEP));
    world.step(STEP, cmds);
    for (const e of world.events) {
      if (e.type === 'shot') shots++;
      if (e.type === 'crateBreak') crates++;
      if (e.type === 'fingerPickup') fingerPickups++;
      if (e.type === 'ability') abilities[e.ability]++;
      if (e.type === 'hit' && e.blocked) blocked++;
      if (e.type === 'ammoPickup') ammoPickups[e.kind] = (ammoPickups[e.kind] ?? 0) + 1;
    }
    world.events.length = 0;
  }
  const winner = world.brawlers.find((b) => b.id === world.winnerId);
  const zoneDeaths = world.brawlers.filter((b) => !b.alive).length;
  const maxStreak = Math.max(...world.brawlers.map((b) => b.kills));
  const ranks = new Set(world.brawlers.map((b) => b.rank));
  console.log(
    `match ${m}: ${world.time.toFixed(1)}s, winner ${winnerLabel(world) ?? 'none'} (placings ${[...ranks].sort((a, b) => a - b).join(',')})`,
  );
  console.log(
    `  top hand ${winner?.name ?? 'none'} (${winner?.kills ?? 0} KOs, ${winner?.cubes ?? 0} cubes, ${winner ? fingerCount(winner) : 0} fingers, streak ${winner?.streak ?? 0}), shots ${shots}, crates broken ${crates}/${world.crates.length}, eliminated ${zoneDeaths}, finger pickups ${fingerPickups}, best streak ${maxStreak}, abilities dash ${abilities.dash} / shield ${abilities.shield} (${blocked} blocked) / rapid ${abilities.rapidFire}`,
  );
  console.log(`  ammo pickups ${Object.entries(ammoPickups).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`);
  if (winner === undefined) process.exitCode = 1;
}

function simulatePropHunt() {
  const blocks = process.argv[4] ?? 'pick';
  const level = Number(process.argv[5] ?? 2);
  if (!isBlockChoice(blocks) || !isBotDifficulty(level)) throw new Error('Usage: prop [pick|random] [0-3]');
  for (let m = 0; m < matches; m++) {
    const slots = Array.from({ length: PLAYER_COUNT }, (_, i) => ({ name: `Bot${i}`, isBot: true, team: i }));
    const world = new World(2000 + m * 7919, slots, 1, 'propHunt', blocks);
    const brain = new BotBrain(world, level);
    const name = (id: number | null) => world.brawlers.find((b) => b.id === id)?.name ?? '-';
    let shots = 0;
    let disguises = 0;
    while (world.winnerId === null && world.time < 1200) {
      const cmds = new Map<number, Command>();
      for (const b of world.brawlers) if (b.alive && b.isBot) cmds.set(b.id, brain.command(b, STEP));
      world.step(STEP, cmds);
      for (const e of world.events) {
        if (e.type === 'shot') shots++;
        if (e.type === 'disguise') disguises++;
        if (e.type === 'roundStart') console.log(`  round ${e.round} at ${world.time.toFixed(0)}s: ${name(e.seekerId)} is it`);
        if (e.type === 'roundOver') {
          const ph = world.propHunt!;
          console.log(`    found ${ph.found.length}/11 (first ${name(ph.found[0] ?? null)}), winners ${e.winners.map(name).join(', ')}, ${world.time.toFixed(0)}s`);
        }
      }
      world.events.length = 0;
    }
    const ranks = world.brawlers.map((b) => b.rank).sort((a, b) => a - b);
    console.log(`match ${m}: ${world.time.toFixed(0)}s, winner ${winnerLabel(world)}, ${shots} seeker shots, ${disguises} block changes, ranks ${ranks.join(',')}`);
    if (world.winnerId === null) process.exitCode = 1;
  }
}
