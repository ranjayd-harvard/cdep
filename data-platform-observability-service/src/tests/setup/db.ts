import { pool } from "../../database/pool.js";

const TABLES = [
  "incident_alerts",
  "incidents",
  "alerts",
  "sla_evaluations",
  "sla_definitions",
  "operational_metrics",
  "operational_events",
  "operational_stage_runs",
  "operational_execution_identifiers",
  "operational_executions",
  "service_health",
  "reconciliation_runs",
  "maintenance_windows",
];

// Integration/e2e suites share one live Postgres and TRUNCATE between
// tests (vitest.config.mts sets fileParallelism:false for exactly this
// reason) — mirrors every TS sibling's own tests/setup/db.ts.
export async function truncateAll(): Promise<void> {
  await pool.query(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
}

export { pool };
