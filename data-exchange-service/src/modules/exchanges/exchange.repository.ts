import type pg from "pg";
import { pool } from "../../database/pool.js";
import type { ExchangeStatus } from "../../config/constants.js";
import type {
  CreateExchangeInput,
  ExchangeFileRow,
  ExchangeRow,
  ExchangeRowWithFilename,
  ListExchangesFilter,
  ListExchangesInternalFilter,
} from "./exchange.types.js";

// ---------------------------------------------------------------------------
// MANDATORY CODING RULE (AGENTS.md section 30): every query in this file
// that touches a tenant-owned row MUST filter by organization_id AND
// tenant_id. Functions here take those as required (non-optional) leading
// parameters specifically to make it structurally awkward to forget them.
// ---------------------------------------------------------------------------

export async function createExchange(
  input: CreateExchangeInput,
  client: pg.PoolClient | pg.Pool = pool,
): Promise<ExchangeRow> {
  const { rows } = await client.query<ExchangeRow>(
    `INSERT INTO exchange.exchanges
       (exchange_id, organization_id, tenant_id, direction, data_product_id,
        initiated_by_user_id, status, schema_version, source_channel,
        started_at, expires_at, correlation_id, idempotency_key,
        created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), $10, $11, $12, now(), now())
     RETURNING *`,
    [
      input.exchangeId,
      input.organizationId,
      input.tenantId,
      input.direction,
      input.dataProductId,
      input.initiatedByUserId ?? null,
      input.status,
      input.schemaVersion ?? null,
      input.sourceChannel ?? null,
      input.expiresAt ?? null,
      input.correlationId ?? null,
      input.idempotencyKey ?? null,
    ],
  );
  return rows[0]!;
}

export async function findExchangeByIdempotencyKey(
  organizationId: string,
  tenantId: string,
  idempotencyKey: string,
): Promise<ExchangeRow | null> {
  const { rows } = await pool.query<ExchangeRow>(
    `SELECT * FROM exchange.exchanges
     WHERE organization_id = $1 AND tenant_id = $2 AND idempotency_key = $3`,
    [organizationId, tenantId, idempotencyKey],
  );
  return rows[0] ?? null;
}

export async function getExchangeById(
  exchangeId: string,
  organizationId: string,
  tenantId: string,
  client: pg.PoolClient | pg.Pool = pool,
): Promise<ExchangeRow | null> {
  const { rows } = await client.query<ExchangeRow>(
    `SELECT * FROM exchange.exchanges
     WHERE exchange_id = $1 AND organization_id = $2 AND tenant_id = $3`,
    [exchangeId, organizationId, tenantId],
  );
  return rows[0] ?? null;
}

// Deliberate, explicit exception to the MANDATORY CODING RULE above: this
// looks up an exchange by ID alone, with no organization/tenant filter.
// It exists only for privileged internal (service-to-service) callers --
// e.g. the lakehouse ingestion pipeline resolving a manifest before it has
// any way of already knowing the owning org/tenant. Never call this from a
// customer-facing (requireAuth()) route.
export async function getExchangeByIdInternal(
  exchangeId: string,
  client: pg.PoolClient | pg.Pool = pool,
): Promise<ExchangeRow | null> {
  const { rows } = await client.query<ExchangeRow>(
    `SELECT * FROM exchange.exchanges WHERE exchange_id = $1`,
    [exchangeId],
  );
  return rows[0] ?? null;
}

// Deliberate, explicit exception to the MANDATORY CODING RULE above (see
// getExchangeByIdInternal above): cross-tenant listing for the superadmin
// portal's Lakehouse Ingestion page (/admin/lakehouse). Never call this
// from a customer-facing (requireAuth()) route.
export async function listExchangesInternal(
  filter: ListExchangesInternalFilter,
): Promise<ExchangeRowWithFilename[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.direction) {
    params.push(filter.direction);
    conditions.push(`e.direction = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(filter.limit);

  // LEFT JOIN LATERAL, not a plain join: an exchange can have more than one
  // exchange_files row (manifest, validation report, ...) -- this picks at
  // most one, the DATA file, per exchange. Only original_filename crosses
  // this boundary; bucket_name/object_key stay internal (see the DDL
  // comment in migrations/005_exchange_files.sql).
  const { rows } = await pool.query<ExchangeRowWithFilename>(
    `SELECT e.*, f.original_filename AS data_filename
     FROM exchange.exchanges e
     LEFT JOIN LATERAL (
       SELECT original_filename FROM exchange.exchange_files
       WHERE exchange_id = e.exchange_id AND file_role = 'DATA'
       LIMIT 1
     ) f ON true
     ${where}
     ORDER BY e.created_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return rows;
}

export async function listExchanges(
  organizationId: string,
  tenantId: string,
  filter: ListExchangesFilter,
): Promise<{ items: ExchangeRow[]; nextCursor: string | null }> {
  const conditions: string[] = ["organization_id = $1", "tenant_id = $2"];
  const params: unknown[] = [organizationId, tenantId];

  if (filter.direction) {
    params.push(filter.direction);
    conditions.push(`direction = $${params.length}`);
  }
  if (filter.status) {
    params.push(filter.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filter.dataProductId) {
    params.push(filter.dataProductId);
    conditions.push(`data_product_id = $${params.length}`);
  }
  if (filter.from) {
    params.push(filter.from);
    conditions.push(`created_at >= $${params.length}`);
  }
  if (filter.to) {
    params.push(filter.to);
    conditions.push(`created_at <= $${params.length}`);
  }
  if (filter.cursor) {
    const decoded = decodeCursor(filter.cursor);
    params.push(decoded.createdAt, decoded.exchangeId);
    conditions.push(`(created_at, exchange_id) < ($${params.length - 1}, $${params.length})`);
  }

  const limit = filter.limit;
  params.push(limit + 1);

  const { rows } = await pool.query<ExchangeRow>(
    `SELECT * FROM exchange.exchanges
     WHERE ${conditions.join(" AND ")}
     ORDER BY created_at DESC, exchange_id DESC
     LIMIT $${params.length}`,
    params,
  );

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.created_at, last.exchange_id) : null;

  return { items, nextCursor };
}

function encodeCursor(createdAt: Date, exchangeId: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${exchangeId}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: string; exchangeId: string } {
  const [createdAt, exchangeId] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  if (!createdAt || !exchangeId) {
    throw new Error("Invalid pagination cursor.");
  }
  return { createdAt, exchangeId };
}

export async function updateExchangeStatus(
  exchangeId: string,
  organizationId: string,
  tenantId: string,
  status: ExchangeStatus,
  extra: Partial<{
    receivedAt: Date | null;
    completedAt: Date | null;
    recordCount: number | null;
    errorCount: number | null;
  }> = {},
  client: pg.PoolClient | pg.Pool = pool,
): Promise<ExchangeRow | null> {
  const { rows } = await client.query<ExchangeRow>(
    `UPDATE exchange.exchanges
     SET status = $4,
         received_at = COALESCE($5, received_at),
         completed_at = COALESCE($6, completed_at),
         record_count = COALESCE($7, record_count),
         error_count = COALESCE($8, error_count),
         updated_at = now()
     WHERE exchange_id = $1 AND organization_id = $2 AND tenant_id = $3
     RETURNING *`,
    [
      exchangeId,
      organizationId,
      tenantId,
      status,
      extra.receivedAt ?? null,
      extra.completedAt ?? null,
      extra.recordCount ?? null,
      extra.errorCount ?? null,
    ],
  );
  return rows[0] ?? null;
}

export async function createExchangeFile(
  file: {
    exchangeFileId: string;
    exchangeId: string;
    fileRole: string;
    originalFilename?: string | null;
    storedFilename?: string | null;
    bucketName: string;
    objectKey: string;
    contentType?: string | null;
    fileFormat?: string | null;
    sizeBytes?: number | null;
    checksumAlgorithm?: string | null;
    checksum?: string | null;
  },
  client: pg.PoolClient | pg.Pool = pool,
): Promise<ExchangeFileRow> {
  const { rows } = await client.query<ExchangeFileRow>(
    `INSERT INTO exchange.exchange_files
       (exchange_file_id, exchange_id, file_role, original_filename, stored_filename,
        bucket_name, object_key, content_type, file_format, size_bytes,
        checksum_algorithm, checksum, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
     ON CONFLICT (bucket_name, object_key) DO UPDATE SET
        checksum = COALESCE(EXCLUDED.checksum, exchange.exchange_files.checksum),
        checksum_algorithm = COALESCE(EXCLUDED.checksum_algorithm, exchange.exchange_files.checksum_algorithm),
        size_bytes = COALESCE(EXCLUDED.size_bytes, exchange.exchange_files.size_bytes),
        content_type = COALESCE(EXCLUDED.content_type, exchange.exchange_files.content_type),
        file_format = COALESCE(EXCLUDED.file_format, exchange.exchange_files.file_format)
     RETURNING *`,
    [
      file.exchangeFileId,
      file.exchangeId,
      file.fileRole,
      file.originalFilename ?? null,
      file.storedFilename ?? null,
      file.bucketName,
      file.objectKey,
      file.contentType ?? null,
      file.fileFormat ?? null,
      file.sizeBytes ?? null,
      file.checksumAlgorithm ?? null,
      file.checksum ?? null,
    ],
  );
  return rows[0]!;
}

export async function getExchangeFiles(exchangeId: string, client: pg.PoolClient | pg.Pool = pool): Promise<ExchangeFileRow[]> {
  const { rows } = await client.query<ExchangeFileRow>(
    `SELECT * FROM exchange.exchange_files WHERE exchange_id = $1 ORDER BY created_at ASC`,
    [exchangeId],
  );
  return rows;
}

export async function getExchangeFileByRole(
  exchangeId: string,
  fileRole: string,
  client: pg.PoolClient | pg.Pool = pool,
): Promise<ExchangeFileRow | null> {
  const { rows } = await client.query<ExchangeFileRow>(
    `SELECT * FROM exchange.exchange_files WHERE exchange_id = $1 AND file_role = $2 LIMIT 1`,
    [exchangeId, fileRole],
  );
  return rows[0] ?? null;
}
