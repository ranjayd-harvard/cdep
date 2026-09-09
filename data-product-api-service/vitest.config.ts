import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/tests/**/*.test.ts"],
    setupFiles: ["./src/tests/setup/load-env.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Integration/e2e suites share one live serving-store Postgres and
    // truncate its tables in beforeEach -- same rationale as subscription-
    // service/scheduling-service's own vitest.config.ts.
    fileParallelism: false,
  },
});
