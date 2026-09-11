import type pg from "pg";
import type { CatalogClient } from "../../ports/catalog-client.port.js";
import { generateSlaDefinitionId } from "../../common/ids/id-generator.js";
import { upsertDefinitionIfChanged } from "../../infrastructure/persistence/sla-definition.repository.js";
import { logger } from "../../common/logger/logger.js";

// Caches catalog's declared SLA into this service's own sla_definitions
// table (spec section 12) — append-and-supersede, never a competing
// definition. Called whenever an execution is created/updated for a
// (product, version) this service hasn't synced SLA for recently, and by
// the periodic catalog-sla-poller for every scope with recent activity.
export async function syncSlaDefinitionsFromCatalog(
  client: pg.Pool | pg.PoolClient,
  catalogClient: CatalogClient,
  dataProductId: string,
  productVersion: string,
  now: Date,
): Promise<void> {
  const detail = await catalogClient.getVersionDetail(dataProductId, productVersion);
  if (!detail?.sla) {
    logger.debug({ dataProductId, productVersion }, "catalog-sla-sync: no SLA declared for this product/version");
    return;
  }

  await upsertDefinitionIfChanged(client, {
    newId: generateSlaDefinitionId(),
    dataProductId,
    productVersion,
    slaType: "BUSINESS",
    stage: null,
    catalogReference: null,
    target: {
      deliveryDeadlineExpression: detail.sla.deliveryDeadlineExpression,
      availabilityTargetPercent: detail.sla.availabilityTargetPercent,
    },
    now,
  });

  await upsertDefinitionIfChanged(client, {
    newId: generateSlaDefinitionId(),
    dataProductId,
    productVersion,
    slaType: "TECHNICAL",
    stage: null,
    catalogReference: null,
    target: {
      freshnessMinutes: detail.sla.freshnessMinutes,
      maximumPublicationLatencyMinutes: detail.sla.maximumPublicationLatencyMinutes,
    },
    now,
  });
}
