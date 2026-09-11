import { beforeEach, describe, expect, it } from "vitest";
import { ingestParsedEvent } from "../../application/services/event-ingestion.service.js";
import { listAlerts } from "../../infrastructure/persistence/alert.repository.js";
import { createMaintenanceWindow } from "../../infrastructure/persistence/maintenance-window.repository.js";
import { generateMaintenanceWindowId } from "../../common/ids/id-generator.js";
import { pool, truncateAll } from "../setup/db.js";
import { DEMO_PRODUCT, DEMO_TENANT, DEMO_VERSION, makeEnvelope } from "../fixtures/envelope-fixtures.js";
import { FakeCatalogClient } from "../fixtures/fake-catalog-client.js";

const catalogClient = new FakeCatalogClient();

beforeEach(async () => {
  await truncateAll();
  catalogClient.setVersionDetail(null);
});

describe("alert lifecycle (spec sections 21-24)", () => {
  it("opens a PUBLICATION_FAILED alert when a publication stage fails", async () => {
    const result = await ingestParsedEvent(
      makeEnvelope({
        eventId: "alert-pub-fail",
        correlation: { publicationId: "pub-alert-1" },
        operation: { stage: "PUBLICATION", status: "FAILED", errorCode: "ARTIFACT_EXPORT_TIMEOUT" },
      }),
      catalogClient,
    );

    const alerts = await listAlerts(pool, { tenantId: DEMO_TENANT, dataProductId: DEMO_PRODUCT });
    const alert = alerts.find((a) => a.alertType === "PUBLICATION_FAILED");
    expect(alert).toBeDefined();
    expect(alert!.state).toBe("OPEN");
    expect(alert!.executionId).toBe(result.executionId);
  });

  it("does not duplicate an alert on repeated fires for the same execution — reopens instead of duplicating", async () => {
    const envelope = makeEnvelope({
      eventId: "alert-repeat-1",
      correlation: { publicationId: "pub-alert-repeat" },
      operation: { stage: "PUBLICATION", status: "FAILED" },
    });
    await ingestParsedEvent(envelope, catalogClient);
    // A second, distinct event for the SAME failed stage/execution (e.g. a
    // reconciliation replay) must not create a second alert row.
    await ingestParsedEvent(
      makeEnvelope({ ...envelope, eventId: "alert-repeat-2" }),
      catalogClient,
    );

    const alerts = await listAlerts(pool, { tenantId: DEMO_TENANT, dataProductId: DEMO_PRODUCT });
    const matching = alerts.filter((a) => a.alertType === "PUBLICATION_FAILED");
    expect(matching).toHaveLength(1);
  });

  it("auto-resolves a prior execution's alert once a later execution in the same scope recovers (spec section 40)", async () => {
    const failed = await ingestParsedEvent(
      makeEnvelope({
        eventId: "recovery-fail",
        correlation: { publicationId: "pub-recovery-fail", outboundExchangeId: "exc-recovery-fail" },
        operation: { stage: "PUBLICATION", status: "FAILED" },
      }),
      catalogClient,
    );

    let alerts = await listAlerts(pool, { tenantId: DEMO_TENANT, dataProductId: DEMO_PRODUCT });
    const openAlert = alerts.find((a) => a.executionId === failed.executionId);
    expect(openAlert?.state).toBe("OPEN");

    // A second, later execution in the same (tenant, product, version)
    // scope completes successfully end-to-end.
    await ingestParsedEvent(
      makeEnvelope({
        eventId: "recovery-success",
        correlation: { publicationId: "pub-recovery-success", outboundExchangeId: "exc-recovery-success" },
        operation: { stage: "PUBLICATION", status: "SUCCEEDED" },
      }),
      catalogClient,
    );
    await ingestParsedEvent(
      makeEnvelope({
        eventId: "recovery-success-delivered",
        correlation: { outboundExchangeId: "exc-recovery-success" },
        operation: { stage: "OUTBOUND_EXCHANGE", status: "SUCCEEDED" },
      }),
      catalogClient,
    );

    alerts = await listAlerts(pool, { tenantId: DEMO_TENANT, dataProductId: DEMO_PRODUCT });
    const resolvedAlert = alerts.find((a) => a.alertId === openAlert!.alertId);
    // History preserved — same row, now RESOLVED, never deleted.
    expect(resolvedAlert?.state).toBe("RESOLVED");
  });

  it("suppresses an alert opened during an active maintenance window instead of leaving it OPEN", async () => {
    await createMaintenanceWindow(pool, {
      maintenanceWindowId: generateMaintenanceWindowId(),
      scope: "PRODUCT_VERSION",
      scopeValue: `${DEMO_PRODUCT}:${DEMO_VERSION}`,
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 60 * 60_000),
      reason: "Planned Gold reprocessing",
      createdBy: "test-operator",
    });

    await ingestParsedEvent(
      makeEnvelope({
        eventId: "suppressed-1",
        correlation: { publicationId: "pub-suppressed-1" },
        operation: { stage: "PUBLICATION", status: "FAILED" },
      }),
      catalogClient,
    );

    const alerts = await listAlerts(pool, { tenantId: DEMO_TENANT, dataProductId: DEMO_PRODUCT });
    const alert = alerts.find((a) => a.alertType === "PUBLICATION_FAILED");
    expect(alert?.state).toBe("SUPPRESSED");
  });

  it("correlates multiple CRITICAL alerts for the same execution into one incident", async () => {
    const result = await ingestParsedEvent(
      makeEnvelope({
        eventId: "incident-1",
        correlation: { ingestionId: "ing-incident-1" },
        operation: { stage: "BRONZE_INGESTION", status: "FAILED" },
      }),
      catalogClient,
    );
    await ingestParsedEvent(
      makeEnvelope({
        eventId: "incident-2",
        correlation: { ingestionId: "ing-incident-1", publicationId: "pub-incident-1" },
        operation: { stage: "PUBLICATION", status: "FAILED" },
      }),
      catalogClient,
    );

    const alerts = await listAlerts(pool, { tenantId: DEMO_TENANT, dataProductId: DEMO_PRODUCT });
    const withIncident = alerts.filter((a) => a.executionId === result.executionId && a.incidentId !== null);
    expect(withIncident.length).toBeGreaterThan(0);
    const incidentIds = new Set(withIncident.map((a) => a.incidentId));
    expect(incidentIds.size).toBe(1);
  });
});
