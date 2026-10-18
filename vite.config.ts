import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 1000 },
  server: {
    // `npm run dev` talks to the game server from `npm run server`.
    proxy: { '/ws': { target: 'ws://localhost:2567', ws: true } },
  },
});
