import { AppError } from "../common/errors/app-error.js";
import { withTransaction } from "../database/transaction.js";
import type { RequestContext } from "../auth/request-context.js";
import type { CompatibilityLevel } from "../config/constants.js";
import { contractDocumentSchema, type ContractDocument } from "./contract-schema.js";
import { validateContractStructure } from "./registration.validator.js";
import { computeContractHash } from "./contract-hash.js";
import { assessCompatibility, type CompatibilityField } from "./compatibility.js";
import { parseSemVer, isAnyBump, isMajorBump, isMinorOrHigherBump } from "../common/utils/semver.js";
import { findDomain } from "../modules/domains/domain.repository.js";
import { findOwner } from "../modules/owners/owner.repository.js";
import {
  createProduct,
  findProduct,
  updateProductDescriptiveFields,
} from "../modules/products/product.repository.js";
import { createVersion, findLatestVersion, findVersion } from "../modules/versions/version.repository.js";
import { insertSchemaFields, listSchemaFields } from "../modules/versions/schema-field.repository.js";
import { insertQualityPolicy } from "../modules/quality/quality.repository.js";
import { insertSlaPolicy } from "../modules/sla/sla.repository.js";
import { insertDeliveryMethod } from "../modules/delivery/delivery.repository.js";
import { insertPublicationPolicy } from "../modules/publication-policies/publication-policy.repository.js";
import { findRegisteredContractForVersion, insertContract } from "../modules/contracts/contract.repository.js";
import { recordEvent } from "./registration-event.repository.js";

export interface RegisterContractInput {
  contract: unknown;
  source?: { repository?: string; path?: string; commit?: string };
  contractFormat?: "YAML" | "JSON";
  actor: RequestContext;
}

export interface RegisterContractResult {
  dataProductId: string;
  version: string;
  dataProductVersionId: string;
  contractId: string;
  contractHash: string;
  compatibility: CompatibilityLevel;
  compatibilityChanges: string[];
  registration: "SUCCESS" | "DUPLICATE";
}

function parseContractOrThrow(raw: unknown): ContractDocument {
  const parsed = contractDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new AppError("CONTRACT_INVALID", `Contract failed structural validation: ${message}`);
  }
  return parsed.data;
}

// Orchestrates spec §15's 13 registration steps end-to-end. Product +
// version + schema + policies + contract are written in a single
// transaction (spec §58/§59) — a failure at any step rolls the whole
// registration back, never leaving a half-created product.
export async function registerContract(input: RegisterContractInput): Promise<RegisterContractResult> {
  const doc = parseContractOrThrow(input.contract);
  validateContractStructure(doc);

  const domain = await findDomain(doc.spec.domain.id);
  if (!domain) {
    throw new AppError("DOMAIN_NOT_FOUND", `Domain '${doc.spec.domain.id}' is not registered. Register it via POST /internal/v1/domains first.`);
  }
  const owner = await findOwner(doc.spec.owner.id);
  if (!owner) {
    throw new AppError("OWNER_NOT_FOUND", `Owner '${doc.spec.owner.id}' is not registered. Register it via POST /internal/v1/owners first.`);
  }

  const dataProductId = doc.metadata.id;
  const newSemVer = parseSemVer(doc.metadata.version);
  if (!newSemVer) {
    throw new AppError("CONTRACT_INVALID", `metadata.version '${doc.metadata.version}' is not a valid semantic version.`);
  }

  const contractHash = computeContractHash(doc);
  const existingProduct = await findProduct(dataProductId);
  const existingVersionRow = existingProduct ? await findVersion(dataProductId, doc.metadata.version) : null;

  if (existingVersionRow) {
    const existingContract = await findRegisteredContractForVersion(existingVersionRow.data_product_version_id);
    if (existingContract && existingContract.contract_hash === contractHash) {
      // Idempotent replay (spec §17): same product + version + hash. No new
      // rows are created; just record that a duplicate was observed.
      await withTransaction(async (client) => {
        await recordEvent(client, {
          dataProductId,
          version: doc.metadata.version,
          eventType: "CONTRACT_DUPLICATE_DETECTED",
          actor: input.actor,
          eventData: { contractHash },
        });
      });
      return {
        dataProductId,
        version: doc.metadata.version,
        dataProductVersionId: existingVersionRow.data_product_version_id,
        contractId: existingContract.contract_id,
        contractHash,
        compatibility: existingVersionRow.breaking_change ? "BREAKING" : "NON_BREAKING",
        compatibilityChanges: [],
        registration: "DUPLICATE",
      };
    }
    throw new AppError(
      "VERSION_ALREADY_EXISTS",
      `Version '${doc.metadata.version}' already exists for '${dataProductId}' with different contract content.`,
    );
  }

  const previousVersionRow = existingProduct ? await findLatestVersion(dataProductId) : null;
  let previousFields: CompatibilityField[] | null = null;
  if (previousVersionRow) {
    const rows = await listSchemaFields(previousVersionRow.data_product_version_id);
    previousFields = rows.map((r) => ({
      fieldName: r.field_name,
      dataType: r.data_type,
      nullable: r.nullable,
      grainKey: r.grain_key,
      businessKey: r.business_key,
      customerVisible: r.customer_visible,
    }));
  }

  const compatibility = assessCompatibility(previousFields, doc.spec.schema);

  if (previousVersionRow) {
    const prevSemVer = parseSemVer(previousVersionRow.version)!;

    if (!isAnyBump(prevSemVer, newSemVer)) {
      throw new AppError(
        "VERSION_ALREADY_EXISTS",
        `New version '${doc.metadata.version}' must be greater than the latest registered version '${previousVersionRow.version}'.`,
      );
    }

    if (compatibility.level === "BREAKING" && !isMajorBump(prevSemVer, newSemVer)) {
      throw new AppError(
        "BREAKING_CHANGE_REQUIRES_MAJOR_VERSION",
        `Breaking change detected (${compatibility.changes.join("; ")}) but '${doc.metadata.version}' is not a major version bump over '${previousVersionRow.version}'. Use ${prevSemVer.major + 1}.0.0 or higher.`,
      );
    }

    if (compatibility.level === "NON_BREAKING" && !isMinorOrHigherBump(prevSemVer, newSemVer)) {
      throw new AppError(
        "CONTRACT_INVALID",
        `Additive/non-breaking change detected but '${doc.metadata.version}' is only a patch bump over '${previousVersionRow.version}'. Use at least a minor version bump (${prevSemVer.major}.${prevSemVer.minor + 1}.0).`,
      );
    }
  }

  const { versionRow, contract } = await withTransaction(async (client) => {
    let product = existingProduct;
    if (!product) {
      product = await createProduct(client, {
        dataProductId,
        name: doc.metadata.name,
        displayName: doc.metadata.name,
        domainId: domain.domain_id,
        ownerId: owner.owner_id,
        description: doc.spec.description,
        productType: doc.spec.productType,
        subscribable: false,
        discoverable: true,
      });
      await recordEvent(client, {
        dataProductId,
        eventType: "PRODUCT_CREATED",
        actor: input.actor,
        eventData: { name: doc.metadata.name, domainId: domain.domain_id, ownerId: owner.owner_id },
      });
    } else {
      await updateProductDescriptiveFields(client, dataProductId, {
        displayName: doc.metadata.name,
        description: doc.spec.description,
        ownerId: owner.owner_id,
      });
    }

    const versionRow = await createVersion(client, {
      dataProductId,
      version: doc.metadata.version,
      contractVersion: doc.metadata.version,
      schemaVersion: doc.metadata.version,
      description: doc.spec.description,
      grainDefinition: doc.spec.grain.description,
      breakingChange: compatibility.level === "BREAKING",
    });
    await recordEvent(client, {
      dataProductId,
      version: doc.metadata.version,
      eventType: "VERSION_CREATED",
      actor: input.actor,
      eventData: { lifecycleStatus: "DRAFT" },
    });

    await insertSchemaFields(client, versionRow.data_product_version_id, doc.spec.schema);

    await insertQualityPolicy(client, {
      dataProductVersionId: versionRow.data_product_version_id,
      minimumCompletenessPercent: doc.spec.quality.minimumCompletenessPercent,
      maximumInvalidPercent: doc.spec.quality.maximumInvalidPercent,
      grainUniqueRequired: doc.spec.quality.grainUniqueRequired,
      rules: doc.spec.quality.rules,
    });

    await insertSlaPolicy(client, {
      dataProductVersionId: versionRow.data_product_version_id,
      freshnessMinutes: doc.spec.sla.freshnessMinutes,
      availabilityTargetPercent: doc.spec.sla.availabilityTargetPercent,
      deliveryDeadlineExpression: doc.spec.sla.deliveryDeadlineExpression,
      maximumPublicationLatencyMinutes: doc.spec.sla.maximumPublicationLatencyMinutes,
    });

    for (const method of doc.spec.delivery.methods) {
      await insertDeliveryMethod(client, {
        dataProductVersionId: versionRow.data_product_version_id,
        method: method.type,
        enabled: method.enabled,
        configuration: method.formats ? { formats: method.formats } : method.api ? { ...method.api } : {},
      });
    }

    await insertPublicationPolicy(client, {
      dataProductVersionId: versionRow.data_product_version_id,
      defaultFormat: doc.spec.publication.defaultFormat,
      supportedFormats: doc.spec.publication.supportedFormats ?? (doc.spec.publication.defaultFormat ? [doc.spec.publication.defaultFormat] : []),
      expirationHours: doc.spec.publication.expirationHours,
      filenamePattern: doc.spec.publication.filenamePattern,
      compressionPolicy: doc.spec.publication.compression,
      defaultDeliveryMode: doc.spec.publication.defaultDeliveryMode,
    });

    const contract = await insertContract(client, {
      dataProductVersionId: versionRow.data_product_version_id,
      contractVersion: doc.metadata.version,
      contractFormat: input.contractFormat ?? "YAML",
      contractBody: doc,
      contractHash,
      sourceRepository: input.source?.repository,
      sourcePath: input.source?.path,
      sourceCommit: input.source?.commit,
      registeredBy: input.actor.actorId,
    });

    await recordEvent(client, {
      dataProductId,
      version: doc.metadata.version,
      eventType: "CONTRACT_REGISTERED",
      actor: input.actor,
      eventData: {
        contractId: contract.contract_id,
        contractHash,
        sourceRepository: input.source?.repository,
        sourcePath: input.source?.path,
        sourceCommit: input.source?.commit,
      },
    });

    await recordEvent(client, {
      dataProductId,
      version: doc.metadata.version,
      eventType: "COMPATIBILITY_CHECK_PASSED",
      actor: input.actor,
      eventData: {
        compatibility: compatibility.level,
        changes: compatibility.changes,
        previousVersion: previousVersionRow?.version ?? null,
      },
    });

    return { versionRow, contract };
  });

  return {
    dataProductId,
    version: doc.metadata.version,
    dataProductVersionId: versionRow.data_product_version_id,
    contractId: contract.contract_id,
    contractHash,
    compatibility: compatibility.level,
    compatibilityChanges: compatibility.changes,
    registration: "SUCCESS",
  };
}

// Exported for the CLI validate/register scripts and for tests, so the
// exact same parsing path the API uses is exercised locally without a
// running server.
export { parseContractOrThrow };
