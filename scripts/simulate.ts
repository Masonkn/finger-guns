// Headless check that a full match of bots plays out: someone wins, nobody gets stuck.
import { BotBrain } from '../src/sim/bot';
import { PLAYER_COUNT, isTeamSize } from '../src/sim/config';
import { Command, World, fingerCount, winnerLabel } from '../src/sim/world';

// npx tsx scripts/simulate.ts [matches] [team size 1-4]
const STEP = 1 / 60;
const matches = Number(process.argv[2] ?? 5);
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
  if (winner === undefined) process.exitCode = 1;
}
