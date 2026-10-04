import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: true,
    proxy: { "/ws": { target: "ws://127.0.0.1:8787", ws: true } },
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 2000,
    // Two pages: the globe (front door) and the game.
    rollupOptions: { input: { main: "index.html", globe: "globe.html" } },
  },
});
