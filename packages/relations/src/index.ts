// =============================================================================
// Relations v0.2 — Entry point
// =============================================================================

import { startServer, DEFAULT_PORT } from "./server.js";

const port = parseInt(process.env["RELATIONS_PORT"] ?? String(DEFAULT_PORT), 10);
const { stop } = startServer(port);

// Graceful shutdown
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    console.info(`[relations] Received ${signal} — shutting down`);
    await stop();
    process.exit(0);
  });
}
