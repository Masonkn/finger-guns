# Finger Guns

A browser battle royale in the style of Brawl Stars Showdown, where every player is a hand firing finger guns. v1 is single player against 9 bots.

## Run it

```sh
npm install
npm run dev      # http://localhost:5173 (add ?debug to expose the match as window.fg)
npm run build    # typecheck + production build into dist/
```

`node scripts/artifact.mjs dist out.html` packs a build into one self-contained HTML file for sharing.

## Controls

- **Desktop:** WASD to move, the mouse to aim, click (or hold) to shoot. Hold Space, E or right-click to aim the super, then release to fire it.
- **Touch:** the left half of the screen is a floating move stick. On the right half, drag and release to shoot, or tap to auto-aim. Drag the yellow button to fire the super.

## How it's built

- `src/sim/` is the game rules as plain TypeScript in 2D tile coordinates, with no rendering: `world.ts` (movement, bullets, ammo, super, power cubes, bushes, gas), `map.ts` (4-way mirrored arena generator) and `bot.ts` (bot AI with BFS pathfinding). Keeping it separate means it could later run on a server for multiplayer.
- `src/render/` is three.js. It has an orthographic isometric camera, toon shading with inverted-hull outlines, the procedural hand model, and dithered see-through walls and bushes.
- `src/hud.ts` and `src/input.ts` handle the DOM overlay and the mouse, keyboard and touch controls.
- Gameplay tuning lives in `src/sim/config.ts`.

To play a batch of bot-only matches headlessly as a balance check:

```sh
npx rolldown scripts/simulate.ts --format esm --platform node -o /tmp/sim.mjs && node /tmp/sim.mjs 10
```
