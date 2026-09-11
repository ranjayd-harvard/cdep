import type pg from "pg";

export type ServiceHealthStatus = "OK" | "DEGRADED" | "UNAVAILABLE";

export async function recordServiceHealth(
  client: pg.Pool | pg.PoolClient,
  params: { serviceName: string; status: ServiceHealthStatus; latencyMs: number | null; errorMessage: string | null },
): Promise<void> {
  await client.query(
    `INSERT INTO service_health (service_name, status, latency_ms, error_message) VALUES ($1, $2, $3, $4)`,
    [params.serviceName, params.status, params.latencyMs, params.errorMessage],
  );
}

export interface LatestServiceHealth {
  serviceName: string;
  status: ServiceHealthStatus;
  checkedAt: Date;
  latencyMs: number | null;
}

// Distinct from Data Product health (spec section 32) — this only answers
// "is the sibling service itself reachable", one row per service name.
export async function latestHealthPerService(client: pg.Pool | pg.PoolClient): Promise<LatestServiceHealth[]> {
  const { rows } = await client.query(
    `SELECT DISTINCT ON (service_name) service_name, status, checked_at, latency_ms
     FROM service_health ORDER BY service_name, checked_at DESC`,
  );
  return rows.map((r) => ({ serviceName: r.service_name, status: r.status, checkedAt: r.checked_at, latencyMs: r.latency_ms }));
}
