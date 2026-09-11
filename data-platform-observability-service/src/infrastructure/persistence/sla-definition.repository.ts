import type pg from "pg";
import type { OperationalStage, SlaType } from "../../config/constants.js";

export interface SlaDefinitionRow {
  slaDefinitionId: string;
  dataProductId: string;
  productVersion: string;
  slaType: SlaType;
  stage: OperationalStage | null;
  catalogReference: string | null;
  target: Record<string, unknown>;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

// Postgres JSONB does not preserve the original key insertion order (it
// canonicalizes on write) — comparing raw JSON.stringify output against a
// freshly-constructed JS object literal would therefore false-positive as
// "changed" whenever the two happen to serialize keys in a different
// order, even when semantically identical. Sorting keys before stringifying
// makes the comparison order-independent.
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)))
      : val,
  );
}

function fromWire(row: any): SlaDefinitionRow {
  return {
    slaDefinitionId: row.sla_definition_id,
    dataProductId: row.data_product_id,
    productVersion: row.product_version,
    slaType: row.sla_type,
    stage: row.stage,
    catalogReference: row.catalog_reference,
    target: row.target,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
  };
}

// The single currently-active definition for (product, version, type[, stage])
// at a given instant — used both for live evaluation and for re-evaluating
// what was active at a past execution's started_at (spec section 12's
// Phase-10-forward multi-version compatibility).
export async function findActiveDefinition(
  client: pg.Pool | pg.PoolClient,
  params: { dataProductId: string; productVersion: string; slaType: SlaType; stage: OperationalStage | null; at: Date },
): Promise<SlaDefinitionRow | null> {
  const { rows } = await client.query(
    `SELECT * FROM sla_definitions
     WHERE data_product_id = $1 AND product_version = $2 AND sla_type = $3
       AND (stage IS NOT DISTINCT FROM $4)
       AND effective_from <= $5 AND (effective_to IS NULL OR effective_to > $5)
     ORDER BY effective_from DESC LIMIT 1`,
    [params.dataProductId, params.productVersion, params.slaType, params.stage, params.at],
  );
  return rows[0] ? fromWire(rows[0]) : null;
}

// Append-and-supersede: never UPDATEs an existing definition's target in
// place (plan section 6) — closes the currently-active row (if its target
// actually differs) and inserts a new one, preserving full history.
export async function upsertDefinitionIfChanged(
  client: pg.Pool | pg.PoolClient,
  params: {
    newId: string;
    dataProductId: string;
    productVersion: string;
    slaType: SlaType;
    stage: OperationalStage | null;
    catalogReference: string | null;
    target: Record<string, unknown>;
    now: Date;
  },
): Promise<SlaDefinitionRow> {
  const current = await findActiveDefinition(client, {
    dataProductId: params.dataProductId,
    productVersion: params.productVersion,
    slaType: params.slaType,
    stage: params.stage,
    at: params.now,
  });

  if (current && canonicalJson(current.target) === canonicalJson(params.target)) {
    return current;
  }

  if (current) {
    await client.query("UPDATE sla_definitions SET effective_to = $2 WHERE sla_definition_id = $1", [
      current.slaDefinitionId,
      params.now,
    ]);
  }

  const { rows } = await client.query(
    `INSERT INTO sla_definitions
       (sla_definition_id, data_product_id, product_version, sla_type, stage, catalog_reference, target, effective_from)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      params.newId,
      params.dataProductId,
      params.productVersion,
      params.slaType,
      params.stage,
      params.catalogReference,
      params.target,
      params.now,
    ],
  );
  return fromWire(rows[0]!);
}
