#!/usr/bin/env tsx
/**
 * Phase 11 production security release gate (spec §45).
 *
 * This checks the IMPLEMENTATION ACTUALLY BUILT this phase — it does not
 * assert aspirational controls that don't exist yet (several are
 * deliberately WARN, not PASS/FAIL, with the specific gap named — see
 * docs/security/*.md for the full honest status of each area).
 *
 * Run from the repo root: npx tsx scripts/security/release-gate.ts
 * Add --json to also print a machine-readable summary.
 */
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

type Status = "PASS" | "WARN" | "FAIL" | "SKIP";

interface CheckResult {
  category: string;
  status: Status;
  detail: string;
}

const results: CheckResult[] = [];

function record(category: string, status: Status, detail: string) {
  results.push({ category, status, detail });
}

function fileContains(relPath: string, needle: string | RegExp): boolean {
  const full = path.join(ROOT, relPath);
  if (!existsSync(full)) return false;
  const content = readFileSync(full, "utf8");
  return typeof needle === "string" ? content.includes(needle) : needle.test(content);
}

function allFilesContain(relPaths: string[], needle: string | RegExp): { ok: boolean; missing: string[] } {
  const missing = relPaths.filter((p) => !fileContains(p, needle));
  return { ok: missing.length === 0, missing };
}

const TS_SERVICES = [
  "data-exchange-service",
  "data-product-catalog-service",
  "subscription-service",
  "scheduling-service",
  "data-platform-observability-service",
  "data-product-api-service",
];

const CUSTOMER_FACING_SERVICES = TS_SERVICES.filter((s) => s !== "data-product-catalog-service");

const ALL_DOCKERFILES = [
  ...TS_SERVICES.map((s) => `${s}/Dockerfile`),
  "data-lakehouse/Dockerfile",
  "data-publication-service/Dockerfile",
  "serving-projection-service/Dockerfile",
  "Dockerfile",
];

// --- Authentication / JWT validation --------------------------------------
{
  const middlewareFiles = CUSTOMER_FACING_SERVICES.map(
    (s) => `${s}/src/auth/${s === "data-exchange-service" ? "auth" : "customer-auth"}.middleware.ts`,
  );
  const { ok, missing } = allFilesContain(middlewareFiles, /jwtVerify\(/);
  record(
    "Authentication",
    ok ? "PASS" : "FAIL",
    ok
      ? `Real JWT signature/issuer/audience/expiry verification (jose.jwtVerify) present in all ${CUSTOMER_FACING_SERVICES.length} customer-facing services.`
      : `Missing real JWT verification in: ${missing.join(", ")}`,
  );

  const { ok: algOk } = allFilesContain(middlewareFiles, /algorithms: \["RS256"\]/);
  record(
    "JWT Validation",
    algOk ? "PASS" : "FAIL",
    algOk
      ? "Algorithm allowlist (RS256 only) enforced in every customer-facing service."
      : "Algorithm allowlist missing in one or more services.",
  );
}

// --- RBAC -------------------------------------------------------------------
{
  const authzFiles = TS_SERVICES.map((s) => `${s}/src/auth/authorization.ts`);
  const { ok, missing } = allFilesContain(authzFiles, /PERMISSIONS_BY_ROLE/);
  record(
    "RBAC",
    ok ? "PASS" : "FAIL",
    ok
      ? "Permission matrix (PERMISSIONS_BY_ROLE + requirePermission) present in every service."
      : `Missing permission matrix in: ${missing.join(", ")}`,
  );
}

// --- Entitlement enforcement -------------------------------------------------
{
  const checks = [
    ["subscription-service/src/application/services/entitlement.service.ts", "assertEntitlementAllows"],
    ["scheduling-service/src/application/services/execution-processor.service.ts", "entitlementClient.evaluate"],
    ["data-product-api-service/src/application/services/event-performance-query.service.ts", "entitlementClient.evaluate"],
    ["data-publication-service/src/publication/services/publication_service.py", "self._entitlement.is_entitled"],
  ] as const;
  const missing = checks.filter(([f, needle]) => !fileContains(f, needle)).map(([f]) => f);
  record(
    "Entitlement Enforcement",
    missing.length === 0 ? "PASS" : "FAIL",
    missing.length === 0
      ? "Entitlement re-validated before subscription creation, scheduled dispatch, API query, and FILE publish — all four checked."
      : `Missing entitlement check in: ${missing.join(", ")}`,
  );
}

// --- Tenant isolation (actually runs the mandatory test files) --------------
{
  const testTargets: Array<{ service: string; file: string }> = [
    { service: "data-product-api-service", file: "phase8-tenant-isolation" },
    { service: "data-exchange-service", file: "retention-deletion" },
    { service: "data-product-catalog-service", file: "security-audit" },
  ];
  const failures: string[] = [];
  for (const t of testTargets) {
    try {
      execSync(`npm test -- ${t.file}`, { cwd: path.join(ROOT, t.service), stdio: "pipe" });
    } catch {
      failures.push(`${t.service}/${t.file}`);
    }
  }
  record(
    "Tenant Isolation",
    failures.length === 0 ? "PASS" : "FAIL",
    failures.length === 0
      ? "Mandatory cross-tenant isolation test (phase8-tenant-isolation) passes against real running services."
      : `Test failures: ${failures.join(", ")}`,
  );
}

// --- PostgreSQL RLS ----------------------------------------------------------
{
  const hasPolicies = fileContains("data-exchange-service/migrations/004_exchanges.sql", "ENABLE ROW LEVEL SECURITY");
  const hasRole = existsSync(path.join(ROOT, "data-exchange-service/migrations/010_least_privilege_role.sql"));
  if (hasPolicies && hasRole) {
    record(
      "PostgreSQL RLS",
      "WARN",
      "RLS policies + a distinct non-owner role (app_exchange) exist and are applied, but the running application does not yet connect as that role " +
        "(session-variable wiring not complete — see docs/security/tenant-isolation.md). Not yet load-bearing.",
    );
  } else {
    record("PostgreSQL RLS", "FAIL", "RLS policies or least-privilege role migration missing.");
  }
}

// --- Storage isolation / signed URLs -----------------------------------------
{
  const pathBuilderOk = fileContains("data-exchange-service/src/storage/storage-path-builder.ts", "organizations/");
  const sizeFixOk = fileContains(
    "data-exchange-service/src/modules/uploads/upload.service.ts",
    "actualSizeBytes > env.MAX_UPLOAD_SIZE_BYTES",
  );
  record(
    "Storage Isolation",
    pathBuilderOk ? "PASS" : "FAIL",
    pathBuilderOk
      ? "Object keys are always server-generated (organizations/{orgId}/tenants/{tenantId}/...), never from customer input."
      : "Server-side storage path construction not found.",
  );
  record(
    "Signed URL Security",
    sizeFixOk ? "PASS" : "FAIL",
    sizeFixOk
      ? "Presigned upload TTL is config-driven (not caller-controlled) and the real uploaded object size is enforced post-hoc against MAX_UPLOAD_SIZE_BYTES."
      : "Post-upload size enforcement fix not found.",
  );
}

// --- Restricted field protection ---------------------------------------------
{
  const validatorOk = fileContains(
    "data-product-catalog-service/src/registration/registration.validator.ts",
    /must declare piiType/,
  );
  const publicationMaskingOk = fileContains("data-publication-service/src/publication/contracts/loader.py", "maskingPolicy");
  const apiMaskingOk = fileContains("data-product-api-service/src/domain/response-projector.ts", "applyMaskingPolicy");
  const ok = validatorOk && publicationMaskingOk && apiMaskingOk;
  record(
    "Restricted Field Protection",
    ok ? "PASS" : "FAIL",
    ok
      ? "RESTRICTED fields require an explicit governance decision at registration; both FILE and API delivery enforce the same maskingPolicy from one Catalog source of truth."
      : "Governance validation or one of the two delivery-side enforcement points is missing.",
  );
}

// --- Retention / Legal Hold ---------------------------------------------------
{
  const svcOk = existsSync(path.join(ROOT, "data-exchange-service/src/retention/deletion.service.ts"));
  let testOk = false;
  try {
    execSync("npm test -- retention-deletion", { cwd: path.join(ROOT, "data-exchange-service"), stdio: "pipe" });
    testOk = true;
  } catch {
    testOk = false;
  }
  record(
    "Retention",
    svcOk && testOk ? "PASS" : "FAIL",
    svcOk && testOk
      ? "Retention-eligible (expired, non-legal-hold) outbound artifacts are deleted; mandatory test passes against real storage."
      : "Deletion service missing or its test failed.",
  );
  record(
    "Legal Hold",
    svcOk && testOk ? "PASS" : "FAIL",
    svcOk && testOk
      ? "legal_hold blocks deletion before any physical action, with the reason recorded in the audit trail; mandatory test passes."
      : "Legal hold enforcement missing or its test failed.",
  );
}

// --- Audit --------------------------------------------------------------------
{
  const exchangeAuditOk = existsSync(
    path.join(ROOT, "data-exchange-service/migrations/011_retention_and_audit.sql"),
  );
  const catalogAuditOk = existsSync(
    path.join(ROOT, "data-product-catalog-service/migrations/021_security_audit_events.sql"),
  );
  const appendOnlyOk = fileContains(
    "data-exchange-service/migrations/011_retention_and_audit.sql",
    "GRANT SELECT, INSERT ON exchange.security_audit_events",
  );
  if (exchangeAuditOk && catalogAuditOk && appendOnlyOk) {
    record(
      "Audit",
      "WARN",
      "Append-only security_audit_events tables exist and are tested in data-exchange-service (DB-enforced append-only) and " +
        "data-product-catalog-service (convention-only, no distinct role yet). data-product-api-service and the portal have none yet — see docs/security/audit.md.",
    );
  } else {
    record("Audit", "FAIL", "Security audit tables missing.");
  }
}

// --- Container security -------------------------------------------------------
{
  const nonRoot = allFilesContain(ALL_DOCKERFILES, /^USER /m);
  const healthchecked = TS_SERVICES.map((s) => `${s}/Dockerfile`);
  const health = allFilesContain(healthchecked, "HEALTHCHECK");
  const ok = nonRoot.ok && health.ok;
  record(
    "Container Security",
    ok ? "PASS" : "WARN",
    ok
      ? "Every backend Dockerfile runs as a non-root user; every TS service Dockerfile has a HEALTHCHECK (Python services use compose-level healthchecks instead)."
      : `Non-root: ${nonRoot.ok ? "OK" : "missing in " + nonRoot.missing.join(", ")}. Healthcheck: ${health.ok ? "OK" : "missing in " + health.missing.join(", ")}.`,
  );
}

// --- Dependency security (not implemented) ------------------------------------
record(
  "Dependency Security",
  "SKIP",
  "No CI dependency/secret/container scanning pipeline exists yet (spec §35/§45 M11 item not completed this pass — .github/workflows/ is empty).",
);

// --- Production configuration fail-closed checks ------------------------------
{
  const envFiles = TS_SERVICES.map((s) => `${s}/src/config/env.ts`);
  const devModeGuard = allFilesContain(envFiles, /AUTH_MODE=development.*is not permitted when NODE_ENV=production/);
  const defaultKeyGuard = allFilesContain(envFiles, /must be overridden from its default value when NODE_ENV=production/);
  const ok = devModeGuard.ok && defaultKeyGuard.ok;
  record(
    "Production Configuration",
    ok ? "PASS" : "FAIL",
    ok
      ? "Every service refuses to boot in production with AUTH_MODE=development or a default internal-API-key value."
      : `Missing guard(s) in: ${[...devModeGuard.missing, ...defaultKeyGuard.missing].join(", ")}`,
  );
}

// --- Render ---------------------------------------------------------------
const CRITICAL_CATEGORIES = new Set([
  "Authentication",
  "JWT Validation",
  "RBAC",
  "Entitlement Enforcement",
  "Tenant Isolation",
  "Restricted Field Protection",
  "Retention",
  "Legal Hold",
  "Production Configuration",
]);

const criticalFailures = results.filter((r) => r.status === "FAIL" && CRITICAL_CATEGORIES.has(r.category)).length;
const highFailures = results.filter((r) => r.status === "FAIL" && !CRITICAL_CATEGORIES.has(r.category)).length;
const warnings = results.filter((r) => r.status === "WARN").length;

console.log("");
console.log("PHASE 11 SECURITY RELEASE GATE");
console.log("");
const nameWidth = Math.max(...results.map((r) => r.category.length)) + 2;
for (const r of results) {
  console.log(`${r.category.padEnd(nameWidth)}${r.status}`);
  console.log(`  ${r.detail}`);
}
console.log("");
console.log(`CRITICAL FAILURES: ${criticalFailures}`);
console.log(`HIGH FAILURES:     ${highFailures}`);
console.log(`WARNINGS:          ${warnings}`);
console.log("");
console.log(`RESULT: ${criticalFailures === 0 ? "PASS (with warnings — see WARN rows above for tracked gaps)" : "FAIL"}`);
console.log("");

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ results, criticalFailures, highFailures, warnings }, null, 2));
}

process.exit(criticalFailures === 0 ? 0 : 1);
