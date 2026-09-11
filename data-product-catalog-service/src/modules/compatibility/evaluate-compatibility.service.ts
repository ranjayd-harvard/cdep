import { AppError } from "../../common/errors/app-error.js";
import { withTransaction } from "../../database/transaction.js";
import type { RequestContext } from "../../auth/request-context.js";
import { contractDocumentSchema } from "../../registration/contract-schema.js";
import { findProduct } from "../products/product.repository.js";
import { findLatestVersion } from "../versions/version.repository.js";
import { assessCompatibility, type CompatibilityChange } from "./compatibility.service.js";
import { recordCompatibilityResult } from "./compatibility-result.repository.js";
import { buildPreviousCompatibilitySide, toDeliverySnapshots } from "./compatibility-context.js";
import { recordEvent } from "../../registration/registration-event.repository.js";
import type { CompatibilityLevel } from "../../config/constants.js";
import { bumpKind } from "../../common/utils/semver.js";

export interface EvaluateCompatibilityResult {
  dataProductId: string;
  sourceVersion: string | null;
  targetVersion: string;
  compatibility: CompatibilityLevel;
  validVersionBump: boolean;
  changes: CompatibilityChange[];
}

// Spec §23: a dry-run that runs the compatibility engine against a
// candidate contract WITHOUT creating a version row — used before actual
// registration to inspect the diff and decide whether to proceed. Still
// persists a version_compatibility_results row and a COMPATIBILITY_EVALUATED
// event (spec §14: every evaluation, not just ones that create a version).
export async function evaluateCompatibility(
  dataProductId: string,
  targetVersion: string,
  candidateContract: unknown,
  actor: RequestContext,
): Promise<EvaluateCompatibilityResult> {
  const product = await findProduct(dataProductId);
  if (!product) {
    throw new AppError("PRODUCT_NOT_FOUND", `Data Product '${dataProductId}' was not found.`);
  }

  const parsed = contractDocumentSchema.safeParse(candidateContract);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new AppError("CONTRACT_INVALID", `Candidate contract failed structural validation: ${message}`);
  }
  const doc = parsed.data;

  const previousVersionRow = await findLatestVersion(dataProductId);
  const previousSide = previousVersionRow ? await buildPreviousCompatibilitySide(previousVersionRow) : null;

  const compatibility = assessCompatibility({
    previous: previousSide,
    next: {
      fields: doc.spec.schema,
      quality: {
        minimumCompletenessPercent: doc.spec.quality.minimumCompletenessPercent,
        maximumInvalidPercent: doc.spec.quality.maximumInvalidPercent,
        grainUniqueRequired: doc.spec.quality.grainUniqueRequired,
        rules: doc.spec.quality.rules,
      },
      sla: {
        freshnessMinutes: doc.spec.sla.freshnessMinutes,
        availabilityTargetPercent: doc.spec.sla.availabilityTargetPercent,
        deliveryDeadlineExpression: doc.spec.sla.deliveryDeadlineExpression,
        maximumPublicationLatencyMinutes: doc.spec.sla.maximumPublicationLatencyMinutes,
      },
      delivery: toDeliverySnapshots(
        doc.spec.delivery.methods.map((m) => ({
          type: m.type,
          enabled: m.enabled,
          configuration: m.api ? { filters: m.api.filters, sorts: m.api.sorts } : {},
        })),
      ),
    },
  });

  const validVersionBump = previousVersionRow
    ? isValidBump(compatibility.level, bumpKind(previousVersionRow.version, targetVersion))
    : true;

  await withTransaction(async (client) => {
    await recordCompatibilityResult(client, {
      dataProductId,
      fromVersion: previousVersionRow?.version ?? null,
      toVersion: targetVersion,
      level: compatibility.level,
      changes: compatibility.changes,
    });
    await recordEvent(client, {
      dataProductId,
      version: targetVersion,
      eventType: "COMPATIBILITY_EVALUATED",
      actor,
      eventData: {
        compatibility: compatibility.level,
        changes: compatibility.changes,
        fromVersion: previousVersionRow?.version ?? null,
        toVersion: targetVersion,
        dryRun: true,
      },
    });
  });

  return {
    dataProductId,
    sourceVersion: previousVersionRow?.version ?? null,
    targetVersion,
    compatibility: compatibility.level,
    validVersionBump,
    changes: compatibility.changes,
  };
}

function isValidBump(level: CompatibilityLevel, kind: ReturnType<typeof bumpKind>): boolean {
  if (kind === "SAME" || kind === "INVALID") return false;
  if (level === "BREAKING") return kind === "MAJOR";
  if (level === "NON_BREAKING") return kind === "MAJOR" || kind === "MINOR";
  return true; // METADATA_ONLY: any forward bump (patch/minor/major) is valid
}
