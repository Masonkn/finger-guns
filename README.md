# Finger Guns

A browser battle royale in the style of Brawl Stars Showdown, where every player is a hand firing finger guns. Matches have 12 hands, solo or in teams of 2, 3 or 4, online or against bots.

## Run it

```sh
npm install
npm run server   # game server on :2567 (restarts on changes)
npm run dev      # game page on http://localhost:5173, talking to that server
```

Every match starts in a lobby where you pick **Solo**, **Duos**, **Trios** or **Squads** (teams of 4) and see who's in; bots fill every empty spot up to 12. Open two browser windows to play each other: one creates a **Private match**, the other joins with its code. In a private lobby the host (★, whoever has been there longest) picks the mode and starts the match, and anyone can click a team to move to it. **Play online** matchmakes into a public match of the chosen mode that starts after 12 seconds. **Play vs bots** runs entirely in the browser, with bot teammates in team modes. A **Bots** picker in every lobby sets how well bots play: Very easy, Easy, Normal or Hard. Online, whoever has been in the lobby longest picks it, and a new public lobby starts on its first player's saved level. The levels live in `BOT_SKILL` in `src/sim/config.ts`.

Teammates can't hurt each other, share what they see in bushes, spawn together and show blue rings and health bars; enemies are red. A team places when its last hand is knocked out, and while your teammates are still in, the camera follows them. The ✕ button (or Esc) quits a match; online, a bot takes over your hand.

- `?debug` on the page URL exposes the running match as `window.fg`.
- `LAG_MS=100 npm run server` adds fake latency, so you can feel how the game plays on a slow connection.
- `npm run build` runs the typecheck and builds the page into `dist/`.
- `npm start` runs the server and also serves `dist/`. This is how it runs in production, as one process on one port.

`VITE_OFFLINE=1 npm run build && node scripts/artifact.mjs dist out.html` packs a bots-only build into one self-contained HTML file for sharing.

## Deploying

The `Dockerfile` builds the page and runs the server in one container, listening on `$PORT` (default 8080). Any host that runs a Docker container and allows WebSockets will work, such as Render, Fly.io or Railway. Point the host at this repo and use the Dockerfile; `/health` works as a health check. No accounts or database are needed, because players just pick a nickname.

A single small instance handles many matches. Each match uses about 30 KB/s of bandwidth per player.

## Controls

- **Desktop:** WASD to move, the mouse to aim, click (or hold) to shoot. Hold Space, E or right-click to aim the super, then release to fire it. Q uses your kill-streak ability.
- **Touch:** the left half of the screen is a floating move stick. On the right half, drag and release to shoot, or tap to auto-aim. Drag the yellow button to fire the super; tap the round ability button next to it.

## Kill rewards and customization

- Every knockout drops the victim's finger (plus any extra fingers they had collected). Picking one up adds a finger to your gun, up to 4 (the whole hand opens): each finger fires one more bullet in a narrow fan.
- Kills build a streak (reset on death) that adds damage and max HP and unlocks abilities: Dash at 2, Shield at 4, Rapid Fire at 6. The ability button uses the best one that is ready.
- **Customize** on the menu picks your hand colour and a thumb topper; the choice is saved in the browser.

## How it's built

**Multiplayer.** The server (`server/`) runs the real game for each match at 30 ticks a second. Browsers send only their inputs and receive snapshots back (`src/net/protocol.ts`). Your own hand is predicted, so it moves the instant you press a key, and it's corrected by the server's answer. Everyone else is drawn 100 ms in the past and blended between snapshots (`src/net/online.ts`). Enemies hiding in bushes are never sent to you, so a modified client can't see them. When a player leaves mid-match, a bot takes over their hand.

- `src/sim/` is the game rules as plain TypeScript in 2D tile coordinates, with no rendering: `world.ts` (movement, bullets, ammo, super, power cubes, bushes, gas), `map.ts` (4-way mirrored arena generator) and `bot.ts` (bot AI with BFS pathfinding). Keeping it separate means it could later run on a server for multiplayer.
- `src/render/` is three.js. It has an orthographic isometric camera, toon shading with inverted-hull outlines, the procedural hand model, and dithered see-through walls and bushes.
- `src/game/` holds the local (vs bots) match. The online match is `src/net/online.ts`; both implement the same `Match` interface the renderer uses.
- `src/hud.ts` and `src/input.ts` handle the DOM overlay and the mouse, keyboard and touch controls.
- Gameplay tuning lives in `src/sim/config.ts`.

With the server running, `npx tsx scripts/netcheck.ts` runs a two-client smoke test: a private duos lobby (host-only mode and start, switching teams), input, shared team vision, bush hiding, and a player leaving.

To play a batch of bot-only matches headlessly as a balance check:

```sh
npx tsx scripts/simulate.ts 10      # 10 solo matches
npx tsx scripts/simulate.ts 10 4    # 10 squads matches
```
