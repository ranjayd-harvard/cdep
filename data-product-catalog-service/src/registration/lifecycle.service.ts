import { AppError } from "../common/errors/app-error.js";
import { withTransaction } from "../database/transaction.js";
import type { RequestContext } from "../auth/request-context.js";
import { findProduct, setCurrentActiveVersion, setProductStatus } from "../modules/products/product.repository.js";
import {
  findActiveVersion,
  findVersion,
  setLifecycleStatus,
  type DataProductVersionRow,
} from "../modules/versions/version.repository.js";
import { listSchemaFields } from "../modules/versions/schema-field.repository.js";
import { findSlaPolicy } from "../modules/sla/sla.repository.js";
import { findQualityPolicy } from "../modules/quality/quality.repository.js";
import { findRegisteredContractForVersion } from "../modules/contracts/contract.repository.js";
import { recordEvent } from "./registration-event.repository.js";

async function requireProductAndVersion(dataProductId: string, version: string): Promise<DataProductVersionRow> {
  const product = await findProduct(dataProductId);
  if (!product) throw new AppError("PRODUCT_NOT_FOUND", `Data Product '${dataProductId}' was not found.`);
  const versionRow = await findVersion(dataProductId, version);
  if (!versionRow) throw new AppError("VERSION_NOT_FOUND", `Version '${version}' of '${dataProductId}' was not found.`);
  return versionRow;
}

// Spec §20: registration alone never makes a version ACTIVE. Activation
// validates the version is fully formed (contract + schema + SLA/quality
// policy all present), then supersedes at most one prior canonical ACTIVE
// version (Phase 5's one-ACTIVE-version-per-product rule — spec §10).
export async function activateVersion(
  dataProductId: string,
  version: string,
  actor: RequestContext,
): Promise<DataProductVersionRow> {
  const versionRow = await requireProductAndVersion(dataProductId, version);

  if (versionRow.lifecycle_status === "RETIRED") {
    throw new AppError("VERSION_NOT_ACTIVATABLE", `Version '${version}' is RETIRED and cannot be reactivated.`);
  }

  const contract = await findRegisteredContractForVersion(versionRow.data_product_version_id);
  if (!contract) {
    throw new AppError("VERSION_NOT_ACTIVATABLE", `Version '${version}' has no registered contract.`);
  }
  const fields = await listSchemaFields(versionRow.data_product_version_id);
  if (fields.length === 0) {
    throw new AppError("VERSION_NOT_ACTIVATABLE", `Version '${version}' has no schema fields.`);
  }
  const [sla, quality] = await Promise.all([
    findSlaPolicy(versionRow.data_product_version_id),
    findQualityPolicy(versionRow.data_product_version_id),
  ]);
  if (!sla || !quality) {
    throw new AppError("VERSION_NOT_ACTIVATABLE", `Version '${version}' is missing its SLA or quality policy.`);
  }

  return withTransaction(async (client) => {
    const currentActive = await findActiveVersion(dataProductId, client);
    if (currentActive && currentActive.data_product_version_id !== versionRow.data_product_version_id) {
      await setLifecycleStatus(client, currentActive.data_product_version_id, "DEPRECATED", { deprecatedAt: new Date() });
      await recordEvent(client, {
        dataProductId,
        version: currentActive.version,
        eventType: "VERSION_DEPRECATED",
        actor,
        eventData: { reason: `superseded by ${version}`, supersededBy: version },
      });
    }

    await setLifecycleStatus(client, versionRow.data_product_version_id, "ACTIVE", { effectiveFrom: new Date() });
    await setCurrentActiveVersion(client, dataProductId, version);
    await recordEvent(client, {
      dataProductId,
      version,
      eventType: "VERSION_ACTIVATED",
      actor,
      eventData: { previousActiveVersion: currentActive?.version ?? null },
    });

    return { ...versionRow, lifecycle_status: "ACTIVE" };
  });
}

export async function deprecateVersion(
  dataProductId: string,
  version: string,
  input: { reason?: string; replacementVersion?: string },
  actor: RequestContext,
): Promise<DataProductVersionRow> {
  const versionRow = await requireProductAndVersion(dataProductId, version);
  if (versionRow.lifecycle_status === "RETIRED") {
    throw new AppError("CONFLICT", `Version '${version}' is RETIRED and cannot be deprecated.`);
  }

  return withTransaction(async (client) => {
    await setLifecycleStatus(client, versionRow.data_product_version_id, "DEPRECATED", { deprecatedAt: new Date() });

    if (versionRow.lifecycle_status === "ACTIVE") {
      await setCurrentActiveVersion(client, dataProductId, null);
    }

    await recordEvent(client, {
      dataProductId,
      version,
      eventType: "VERSION_DEPRECATED",
      actor,
      eventData: { reason: input.reason ?? null, replacementVersion: input.replacementVersion ?? null },
    });

    return { ...versionRow, lifecycle_status: "DEPRECATED" };
  });
}

export async function retireVersion(
  dataProductId: string,
  version: string,
  input: { reason?: string; force?: boolean },
  actor: RequestContext,
): Promise<DataProductVersionRow> {
  const versionRow = await requireProductAndVersion(dataProductId, version);
  if (versionRow.lifecycle_status === "RETIRED") {
    throw new AppError("CONFLICT", `Version '${version}' is already RETIRED.`);
  }
  if (versionRow.lifecycle_status === "ACTIVE" && !input.force) {
    throw new AppError(
      "VERSION_NOT_RETIRABLE",
      `Version '${version}' is the current ACTIVE version. Activate a replacement first, or pass force=true to retire it as part of retiring the whole product.`,
    );
  }

  return withTransaction(async (client) => {
    await setLifecycleStatus(client, versionRow.data_product_version_id, "RETIRED", { retiredAt: new Date() });

    if (versionRow.lifecycle_status === "ACTIVE") {
      await setCurrentActiveVersion(client, dataProductId, null);
      await setProductStatus(client, dataProductId, "RETIRED");
    }

    await recordEvent(client, {
      dataProductId,
      version,
      eventType: "VERSION_RETIRED",
      actor,
      eventData: { reason: input.reason ?? null, force: Boolean(input.force) },
    });

    return { ...versionRow, lifecycle_status: "RETIRED" };
  });
}
