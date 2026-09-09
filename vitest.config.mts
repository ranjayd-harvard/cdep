import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // "data-exchange-service", "data-product-catalog-service",
    // "subscription-service", and "scheduling-service" are independent
    // Node/Fastify projects nested in this directory (see
    // docs/exchange-service-integration.md), each with its own
    // node_modules and its own vitest suite — without this, vitest also
    // picks up those projects' *dependencies'* internal test fixtures
    // (e.g. fastify-plugin/test/esm/*.test.js) as if they were cdep's own
    // tests.
    exclude: [
      "node_modules",
      ".next",
      "e2e",
      "data-exchange-service",
      "data-product-catalog-service",
      "subscription-service",
      "scheduling-service",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
