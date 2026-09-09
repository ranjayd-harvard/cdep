import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/tests/**/*.test.ts"],
    setupFiles: ["./src/tests/setup/load-env.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Integration/e2e suites share one live Postgres database and TRUNCATE
    // its tables in beforeEach — same rationale as subscription-service's
    // vitest.config.mts: parallel test files would let one file's TRUNCATE
    // wipe rows another file's test is mid-assertion on.
    fileParallelism: false,
  },
});
