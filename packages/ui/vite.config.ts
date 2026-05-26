import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relations UI — Vite config
// Dev: npm run dev → http://localhost:5733
// Backend: packages/relations/ at http://localhost:7330
// Proxy /api/* → backend so no CORS issues during dev.

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5733,
    proxy: {
      "/api": {
        target: "http://localhost:7330",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
