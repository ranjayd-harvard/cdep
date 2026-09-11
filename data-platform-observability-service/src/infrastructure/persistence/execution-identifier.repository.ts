import type pg from "pg";
import type { IdentifierType } from "../../config/constants.js";
import { identifierKey } from "../../domain/correlation.js";

// Join-key index backing operational_execution_identifiers (migrations/
// 002_...). Upserts are idempotent: re-observing the same (id_type,
// id_value) is a no-op if it already points at the same execution, and
// deliberately never silently repoints it to a different execution (that
// would indicate a genuine correlation bug worth surfacing, not masking).
export async function upsertIdentifier(
  client: pg.Pool | pg.PoolClient,
  params: { idType: IdentifierType; idValue: string; executionId: string; confidence: "EXACT" | "HEURISTIC" },
): Promise<void> {
  await client.query(
    `INSERT INTO operational_execution_identifiers (id_type, id_value, execution_id, correlation_confidence)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id_type, id_value) DO NOTHING`,
    [params.idType, params.idValue, params.executionId, params.confidence],
  );
}

// Batch lookup for the correlation decision (domain/correlation.ts) — one
// query covers every identifier present on the incoming event.
export async function findMatchedExecutionIds(
  client: pg.Pool | pg.PoolClient,
  identifiers: ReadonlyArray<{ idType: IdentifierType; idValue: string }>,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (identifiers.length === 0) return result;

  const { rows } = await client.query<{ id_type: IdentifierType; id_value: string; execution_id: string }>(
    `SELECT id_type, id_value, execution_id FROM operational_execution_identifiers
     WHERE (id_type, id_value) IN (${identifiers.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(", ")})`,
    identifiers.flatMap((id) => [id.idType, id.idValue]),
  );

  for (const row of rows) {
    result.set(identifierKey(row.id_type, row.id_value), row.execution_id);
  }
  return result;
}
