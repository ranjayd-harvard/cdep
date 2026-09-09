import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/tests/**/*.test.ts"],
    setupFiles: ["./src/tests/setup/load-env.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
