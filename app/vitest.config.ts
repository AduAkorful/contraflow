import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // The anvil-backed integration test spins up a local chain and deploys real compiled
    // contracts — slower than the pure-function unit tests, given its own timeout below.
    testTimeout: 30_000,
  },
});
