import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/tests/**/*.test.ts"],
    setupFiles: ["./src/tests/setup/load-env.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Integration/contract/e2e suites share one live Postgres database and
    // TRUNCATE its tables in beforeEach — running test files in parallel
    // (Vitest's default) lets one file's TRUNCATE wipe rows another file's
    // test is mid-assertion on. Sequential file execution trades some
    // wall-clock time for correctness against shared external state.
    fileParallelism: false,
  },
});
