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
    // data-exchange-service is an independent Node/Fastify project nested
    // in this directory (see docs/exchange-service-integration.md) — its
    // own package.json/eslint.config.mjs/tsconfig.json own its linting.
    "data-exchange-service/**",
  ]),
]);

export default eslintConfig;
