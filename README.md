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

- **Desktop:** WASD to move, the mouse to aim, click (or hold) to shoot. Hold Space, E or right-click to aim the super, then release to fire it. Q uses your kill-streak ability.
- **Touch:** the left half of the screen is a floating move stick. On the right half, drag and release to shoot, or tap to auto-aim. Drag the yellow button to fire the super; tap the round ability button next to it.

## Kill rewards and customization

- Every knockout drops the victim's finger (plus any extra fingers they had collected). Picking one up adds a finger to your gun, up to 5: each finger fires one more bullet in a narrow fan.
- Kills build a streak (reset on death) that adds damage and max HP and unlocks abilities: Dash at 2, Shield at 4, Rapid Fire at 6. The ability button uses the best one that is ready.
- **Customize** on the menu picks your hand colour and a thumb topper; the choice is saved in the browser.

## How it's built

- `src/sim/` is the game rules as plain TypeScript in 2D tile coordinates, with no rendering: `world.ts` (movement, bullets, ammo, super, power cubes, bushes, gas), `map.ts` (4-way mirrored arena generator) and `bot.ts` (bot AI with BFS pathfinding). Keeping it separate means it could later run on a server for multiplayer.
- `src/render/` is three.js. It has an orthographic isometric camera, toon shading with inverted-hull outlines, the procedural hand model, and dithered see-through walls and bushes.
- `src/hud.ts` and `src/input.ts` handle the DOM overlay and the mouse, keyboard and touch controls.
- Gameplay tuning lives in `src/sim/config.ts`.

To play a batch of bot-only matches headlessly as a balance check:

```sh
npx rolldown scripts/simulate.ts --format esm --platform node -o /tmp/sim.mjs && node /tmp/sim.mjs 10
```
