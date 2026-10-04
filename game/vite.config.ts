import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: true,
    proxy: { "/ws": { target: "ws://127.0.0.1:8787", ws: true } },
  },
  build: { target: "es2020", chunkSizeWarningLimit: 900 },
});
