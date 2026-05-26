import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,           // explicit imports keep test files self-documenting
    include: ["src/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/index.ts",
        "src/server.ts",
        // Infrastructure — requires real PG connection; tested via integration tests
        "src/db.ts",
        // Pure TypeScript type declarations — no runtime logic to measure
        "src/types.ts",
        // Event handlers — integration-level; defer to integration test suite
        "src/event-handlers/**",
      ],
      thresholds: {
        lines:       85,
        functions:   85,
        branches:    80,
        statements:  85,
      },
    },
  },
});
