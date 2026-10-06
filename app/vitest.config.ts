import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": root,
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    // The anvil-backed integration test spins up a local chain and deploys real compiled
    // contracts — slower than the pure-function unit tests, given its own timeout below.
    testTimeout: 30_000,
  },
});
