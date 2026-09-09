import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // data-exchange-service, data-product-catalog-service,
    // subscription-service, and scheduling-service are independent Node/
    // Fastify projects nested in this directory (see
    // docs/exchange-service-integration.md) — each owns its own
    // package.json/eslint.config.mjs/tsconfig.json and its own linting.
    "data-exchange-service/**",
    "data-product-catalog-service/**",
    "subscription-service/**",
    "scheduling-service/**",
  ]),
]);

export default eslintConfig;
