import { AppError } from "../../common/errors/app-error.js";
import { withTransaction } from "../../database/transaction.js";
import { withIdempotency, type IdempotentResult } from "../../infrastructure/idempotency/with-idempotency.js";
import type { RequestContext } from "../../auth/request-context.js";
import { findProduct } from "../products/product.repository.js";
import { findActiveVersion, findVersion } from "../versions/version.repository.js";
import { findLatestCompatibilityResult } from "../compatibility/compatibility-result.repository.js";
import { listSubscriptionsRequiringMigration } from "../impact-analysis/impact-analysis.service.js";
import { updateSubscriptionVersionPolicy } from "../../infrastructure/http/subscription-client.js";
import { recordEvent } from "../../registration/registration-event.repository.js";
import type { CompatibilityLevel } from "../../config/constants.js";
import {
  createMigrationPlan,
  findMigrationPlan,
  insertMigrationSubscription,
  listMigrationPlans,
  listMigrationSubscriptions,
  setMigrationPlanStatus,
  setMigrationSubscriptionStatus,
  type MigrationPlanRow,
} from "./migration-plan.repository.js";

export interface CreateMigrationPlanInput {
  toVersion: string;
  startAt?: Date;
  deadline?: Date;
  reason?: string;
  idempotencyKey?: string;
}

// Spec §35: server computes fromVersion (current canonical ACTIVE),
// compatibility (from the latest version_compatibility_results row for
// that pair), and affected_subscriptions (from impact analysis) at
// creation time — snapshotted into migration_subscriptions rows with
// status='PENDING', one per subscription that actually needs to move.
export async function createMigration(
  dataProductId: string,
  input: CreateMigrationPlanInput,
  actor: RequestContext,
): Promise<IdempotentResult<{ migration: MigrationPlanRow; affectedSubscriptions: number }>> {
  return withIdempotency(
    { idempotencyKey: input.idempotencyKey, scope: dataProductId, operation: "CREATE_MIGRATION", requestBody: input },
    async () => {
      const product = await findProduct(dataProductId);
      if (!product) throw new AppError("PRODUCT_NOT_FOUND", `Data Product '${dataProductId}' was not found.`);

      const toRow = await findVersion(dataProductId, input.toVersion);
      if (!toRow) throw new AppError("VERSION_NOT_FOUND", `Version '${input.toVersion}' of '${dataProductId}' was not found.`);

      const fromRow = await findActiveVersion(dataProductId);
      if (!fromRow) throw new AppError("VERSION_NOT_FOUND", `'${dataProductId}' has no current ACTIVE version to migrate from.`);

      const latestCompat = await findLatestCompatibilityResult(dataProductId, input.toVersion);
      const compatibility = latestCompat?.compatibility_level ?? (toRow.compatibility_type as CompatibilityLevel);

      const affected = await listSubscriptionsRequiringMigration(dataProductId, fromRow.version);

      const { migration, affectedSubscriptions } = await withTransaction(async (client) => {
        const migration = await createMigrationPlan(client, {
          dataProductId,
          fromVersion: fromRow.version,
          toVersion: input.toVersion,
          compatibility,
          startAt: input.startAt,
          deadline: input.deadline,
          reason: input.reason,
          createdBy: actor.actorId,
        });
        for (const sub of affected) {
          await insertMigrationSubscription(client, {
            migrationId: migration.migration_id,
            subscriptionId: sub.subscriptionId,
            organizationId: sub.organizationId,
            tenantId: sub.tenantId,
          });
        }
        await recordEvent(client, {
          dataProductId,
          version: input.toVersion,
          eventType: "MIGRATION_CREATED",
          actor,
          eventData: {
            migrationId: migration.migration_id,
            fromVersion: fromRow.version,
            toVersion: input.toVersion,
            compatibility,
            affectedSubscriptions: affected.length,
          },
        });
        return { migration, affectedSubscriptions: affected.length };
      });

      return { status: 201, body: { migration, affectedSubscriptions }, resourceId: migration.migration_id };
    },
  );
}

export async function getMigration(migrationId: string) {
  const migration = await findMigrationPlan(migrationId);
  if (!migration) throw new AppError("MIGRATION_NOT_FOUND", `Migration '${migrationId}' was not found.`);
  const subscriptions = await listMigrationSubscriptions(migrationId);
  return { migration, subscriptions };
}

export function listMigrations(dataProductId: string) {
  return listMigrationPlans(dataProductId);
}

// Spec §35: NON_BREAKING plans may auto-execute (move each PENDING
// subscription's version_policy to EXACT(toVersion) via subscription-
// service's own update path). BREAKING plans never auto-execute — this is
// the concrete enforcement of "do not automatically change customer
// subscriptions during breaking major migrations without policy/approval."
// A BREAKING migration whose every subscription has *already* been moved
// (e.g. each tenant/operator individually re-pinned to the new version)
// may still be marked COMPLETED — execute() only refuses to perform the
// moves itself.
export async function executeMigration(migrationId: string, actor: RequestContext) {
  const migration = await findMigrationPlan(migrationId);
  if (!migration) throw new AppError("MIGRATION_NOT_FOUND", `Migration '${migrationId}' was not found.`);
  if (migration.status === "COMPLETED" || migration.status === "CANCELLED") {
    return { migration, results: [] as Array<{ subscriptionId: string; status: string }> };
  }

  const subscriptions = await listMigrationSubscriptions(migrationId);
  const pending = subscriptions.filter((s) => s.status === "PENDING");

  if (migration.compatibility === "BREAKING") {
    const stillPending = pending.length;
    if (stillPending > 0) {
      await withTransaction((client) => setMigrationPlanStatus(client, migrationId, "BLOCKED"));
      throw new AppError(
        "MIGRATION_REQUIRES_MANUAL_ACTION",
        `Migration '${migrationId}' is BREAKING — ${stillPending} subscription(s) have not yet been individually moved and cannot be auto-executed.`,
      );
    }
    await withTransaction((client) => setMigrationPlanStatus(client, migrationId, "COMPLETED"));
    return { migration: { ...migration, status: "COMPLETED" as const }, results: [] };
  }

  await withTransaction((client) => setMigrationPlanStatus(client, migrationId, "IN_PROGRESS"));

  const results: Array<{ subscriptionId: string; status: string }> = [];
  for (const sub of pending) {
    try {
      await updateSubscriptionVersionPolicy(sub.subscription_id, migration.to_version);
      await withTransaction(async (client) => {
        await setMigrationSubscriptionStatus(client, sub.migration_subscription_id, "MIGRATED", { migratedAt: new Date() });
        await recordEvent(client, {
          dataProductId: migration.data_product_id,
          version: migration.to_version,
          eventType: "SUBSCRIPTION_MIGRATED",
          actor,
          eventData: { migrationId, subscriptionId: sub.subscription_id, fromVersion: migration.from_version, toVersion: migration.to_version },
        });
      });
      results.push({ subscriptionId: sub.subscription_id, status: "MIGRATED" });
    } catch (err) {
      await withTransaction((client) =>
        setMigrationSubscriptionStatus(client, sub.migration_subscription_id, "FAILED", { failureReason: (err as Error).message }),
      );
      results.push({ subscriptionId: sub.subscription_id, status: "FAILED" });
    }
  }

  const finalSubscriptions = await listMigrationSubscriptions(migrationId);
  const allTerminal = finalSubscriptions.every((s) => s.status === "MIGRATED" || s.status === "SKIPPED");
  const finalStatus = allTerminal ? "COMPLETED" : "BLOCKED";
  await withTransaction(async (client) => {
    await setMigrationPlanStatus(client, migrationId, finalStatus);
    await recordEvent(client, {
      dataProductId: migration.data_product_id,
      version: migration.to_version,
      eventType: "MIGRATION_STATUS_CHANGED",
      actor,
      eventData: { migrationId, status: finalStatus },
    });
  });

  return { migration: { ...migration, status: finalStatus }, results };
}
