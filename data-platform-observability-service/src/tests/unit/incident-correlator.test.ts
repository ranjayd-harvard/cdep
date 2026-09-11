import { describe, expect, it } from "vitest";
import { findIncidentToJoin } from "../../domain/alerting/incident-correlator.js";

describe("findIncidentToJoin", () => {
  it("joins an existing incident when a recent alert in the same scope already has one", () => {
    const incidentId = findIncidentToJoin(
      { tenantId: "t1", dataProductId: "event-performance", productVersion: "1.3.0", openedAt: new Date("2026-09-09T05:31:00Z") },
      [
        {
          alertId: "alrt-1",
          tenantId: "t1",
          dataProductId: "event-performance",
          productVersion: "1.3.0",
          openedAt: new Date("2026-09-09T05:29:00Z"),
          incidentId: "inc-1",
        },
      ],
      30,
    );
    expect(incidentId).toBe("inc-1");
  });

  it("does not join across a different product/version scope", () => {
    const incidentId = findIncidentToJoin(
      { tenantId: "t1", dataProductId: "event-performance", productVersion: "1.3.0", openedAt: new Date("2026-09-09T05:31:00Z") },
      [
        {
          alertId: "alrt-1",
          tenantId: "t1",
          dataProductId: "venue-insights",
          productVersion: "1.0.0",
          openedAt: new Date("2026-09-09T05:29:00Z"),
          incidentId: "inc-1",
        },
      ],
      30,
    );
    expect(incidentId).toBeNull();
  });

  it("does not join once the correlation window has elapsed", () => {
    const incidentId = findIncidentToJoin(
      { tenantId: "t1", dataProductId: "event-performance", productVersion: "1.3.0", openedAt: new Date("2026-09-09T06:31:00Z") },
      [
        {
          alertId: "alrt-1",
          tenantId: "t1",
          dataProductId: "event-performance",
          productVersion: "1.3.0",
          openedAt: new Date("2026-09-09T05:29:00Z"),
          incidentId: "inc-1",
        },
      ],
      30,
    );
    expect(incidentId).toBeNull();
  });
});
