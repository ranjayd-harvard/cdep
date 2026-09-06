import { AppError } from "../../common/errors/app-error.js";
import { generateExchangeId, generateFileId } from "../../common/ids/id-generator.js";
import { sha256Hex } from "../../common/utils/checksum.js";
import { resolveFileFormat, sanitizeFilename } from "../../common/utils/filename.js";
import { env } from "../../config/env.js";
import { pool } from "../../database/pool.js";
import { withTransaction } from "../../database/transaction.js";
import { appendExchangeEvent } from "../../events/exchange-event.service.js";
import { assertDownloadEntitlement } from "../data-products/data-product.service.js";
import { getDataProduct } from "../data-products/data-product.repository.js";
import { createExchange, createExchangeFile, updateExchangeStatus } from "../exchanges/exchange.repository.js";
import { assertValidTransition } from "../exchanges/exchange-transitions.js";
import { writeOutboundManifest } from "../manifests/manifest.service.js";
import type { OutboundManifest } from "../manifests/manifest.types.js";
import { objectStorage } from "../../storage/index.js";
import { buildOutboundDataKey } from "../../storage/storage-path-builder.js";
import type { CreatePublicationBody } from "./publication.schemas.js";

const OUTBOUND_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Stands in for the future Gold -> Publication Service handoff (AGENTS.md
// section 37/58). Real Gold output bytes don't exist yet in Phase 2, so a
// small deterministic fixture is generated locally instead of reading from
// an actual lakehouse. `sourceObject` is retained purely as audit metadata
// describing where a real publication pipeline would have read from.
function generateFixtureContent(filename: string, format: string): Buffer {
  if (format === "JSON") {
    return Buffer.from(JSON.stringify([{ id: 1, metric: "sample", value: 100 }, { id: 2, metric: "sample", value: 200 }], null, 2));
  }
  if (format === "PARQUET") {
    // Minimal placeholder honoring the PAR1...PAR1 magic-byte framing so
    // downstream structural validation recognizes it as Parquet-shaped.
    return Buffer.concat([Buffer.from("PAR1"), Buffer.from("fixture-payload"), Buffer.from("PAR1")]);
  }
  return Buffer.from(`id,metric,value\n1,sample,100\n2,sample,200\n`);
}

async function assertTenantExists(organizationId: string, tenantId: string): Promise<void> {
  const { rows } = await pool.query(
    `SELECT 1 FROM exchange.tenants WHERE tenant_id = $1 AND organization_id = $2`,
    [tenantId, organizationId],
  );
  if (rows.length === 0) {
    throw new AppError("VALIDATION_ERROR", "Unknown organizationId/tenantId combination.");
  }
}

export interface PublicationResult {
  exchangeId: string;
  status: string;
  filename: string;
}

export async function publishOutboundExchange(body: CreatePublicationBody): Promise<PublicationResult> {
  await assertTenantExists(body.organizationId, body.tenantId);

  const dataProduct = await getDataProduct(body.dataProductId);
  if (!dataProduct || dataProduct.status !== "ACTIVE") {
    throw new AppError("DATA_PRODUCT_NOT_FOUND", "The requested data product was not found.");
  }
  await assertDownloadEntitlement(body.tenantId, body.dataProductId);

  const filename = sanitizeFilename(body.filename);
  const format = resolveFileFormat(filename, "application/octet-stream");
  const contentType = format === "JSON" ? "application/json" : format === "PARQUET" ? "application/x-parquet" : "text/csv";

  const exchangeId = generateExchangeId();
  const expiresAt = new Date(Date.now() + OUTBOUND_EXPIRY_MS);

  await withTransaction(async (client) => {
    await createExchange(
      {
        exchangeId,
        organizationId: body.organizationId,
        tenantId: body.tenantId,
        direction: "OUTBOUND",
        dataProductId: body.dataProductId,
        status: "PREPARING",
        schemaVersion: body.schemaVersion ?? dataProduct.current_schema_version,
        sourceChannel: "GOLD_PUBLICATION",
        expiresAt,
      },
      client,
    );
    await appendExchangeEvent(
      {
        exchangeId,
        eventType: "EXCHANGE_CREATED",
        toStatus: "PREPARING",
        actorType: "SERVICE_ACCOUNT",
        eventData: { dataProductId: body.dataProductId, sourceObject: body.sourceObject ?? null },
      },
      client,
    );
  });

  const objectKey = buildOutboundDataKey(body.organizationId, body.tenantId, exchangeId, filename);
  const content = generateFixtureContent(filename, format);
  const checksum = sha256Hex(content);

  await objectStorage.putObject({ bucket: env.OUTBOUND_BUCKET, key: objectKey, body: content, contentType });
  await createExchangeFile({
    exchangeFileId: generateFileId(),
    exchangeId,
    fileRole: "DATA",
    originalFilename: filename,
    bucketName: env.OUTBOUND_BUCKET,
    objectKey,
    contentType,
    fileFormat: format,
    sizeBytes: content.length,
    checksumAlgorithm: "SHA-256",
    checksum,
  });

  const manifest: OutboundManifest = {
    manifestVersion: "1.0",
    exchange: { exchangeId, direction: "OUTBOUND", status: "READY" },
    ownership: { organizationId: body.organizationId, tenantId: body.tenantId },
    dataProduct: { dataProductId: body.dataProductId, schemaVersion: body.schemaVersion ?? dataProduct.current_schema_version },
    file: {
      publishedFilename: filename,
      contentType,
      format,
      sizeBytes: content.length,
      checksumAlgorithm: "SHA-256",
      checksum,
    },
    timestamps: { publishedAt: new Date().toISOString() },
  };
  const manifestKey = await writeOutboundManifest(objectStorage, env.OUTBOUND_BUCKET, body.organizationId, body.tenantId, exchangeId, manifest);
  await createExchangeFile({
    exchangeFileId: generateFileId(),
    exchangeId,
    fileRole: "MANIFEST",
    storedFilename: "manifest.json",
    bucketName: env.OUTBOUND_BUCKET,
    objectKey: manifestKey,
    contentType: "application/json",
  });

  await withTransaction(async (client) => {
    assertValidTransition("OUTBOUND", "PREPARING", "READY");
    await updateExchangeStatus(exchangeId, body.organizationId, body.tenantId, "READY", {}, client);
    await appendExchangeEvent(
      { exchangeId, eventType: "EXCHANGE_PUBLISHED", fromStatus: "PREPARING", toStatus: "READY", actorType: "SERVICE_ACCOUNT" },
      client,
    );
  });

  return { exchangeId, status: "READY", filename };
}
