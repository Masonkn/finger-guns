// Headless check that a full match of bots plays out: someone wins, nobody gets stuck.
import { BotBrain } from '../src/sim/bot';
import { Command, World } from '../src/sim/world';

const STEP = 1 / 60;
const matches = Number(process.argv[2] ?? 5);
for (let m = 0; m < matches; m++) {
  const names = Array.from({ length: 10 }, (_, i) => `Bot${i}`);
  const world = new World(1000 + m * 7919, names.map((name) => ({ name, isBot: true })));
  const brain = new BotBrain(world);
  let shots = 0;
  let crates = 0;
  while (world.winnerId === null && world.time < 300) {
    const cmds = new Map<number, Command>();
    for (const b of world.brawlers) if (b.alive) cmds.set(b.id, brain.command(b, STEP));
    world.step(STEP, cmds);
    for (const e of world.events) {
      if (e.type === 'shot') shots++;
      if (e.type === 'crateBreak') crates++;
    }
    world.events.length = 0;
  }
  const winner = world.brawlers.find((b) => b.id === world.winnerId);
  const zoneDeaths = world.brawlers.filter((b) => !b.alive).length;
  console.log(
    `match ${m}: ${world.time.toFixed(1)}s, winner ${winner?.name ?? 'none'} (${winner?.kills ?? 0} KOs, ${winner?.cubes ?? 0} cubes), shots ${shots}, crates broken ${crates}/${world.crates.length}, eliminated ${zoneDeaths}`,
  );
}
