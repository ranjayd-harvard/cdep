import { beforeEach, describe, expect, it } from "vitest";
import { ingestParsedEvent } from "../../application/services/event-ingestion.service.js";
import { getDeprecatedVersionUsage, getVersionAdoption } from "../../application/services/version-adoption.service.js";
import { pool, truncateAll } from "../setup/db.js";
import { DEMO_PRODUCT, makeEnvelope } from "../fixtures/envelope-fixtures.js";
import { FakeCatalogClient } from "../fixtures/fake-catalog-client.js";

// Phase 10 §41/§58/§61-62: per-version adoption/deprecated-usage metrics,
// against a fixture with two versions and mixed subscriber resolution —
// mirrors the required worked-example shape (subscriber counts per
// version, adoption percentage, deprecated-version usage flagged
// separately).
const catalogClient = new FakeCatalogClient();

beforeEach(async () => {
  await truncateAll();
  catalogClient.setVersions([
    { version: "1.2.0", lifecycleStatus: "DEPRECATED" },
    { version: "1.3.0", lifecycleStatus: "ACTIVE" },
  ]);
});

describe("version adoption metrics", () => {
  it("reports subscriber counts and adoption percentage split across two versions", async () => {
    // 3 distinct subscribers on 1.3.0 (ACTIVE), 1 on 1.2.0 (DEPRECATED,
    // still riding its grace period).
    for (const [i, sub] of ["sub-a", "sub-b", "sub-c"].entries()) {
      await ingestParsedEvent(
        makeEnvelope({
          eventId: `evt-active-${i}`,
          context: { productVersion: "1.3.0", subscriptionId: sub },
          operation: { stage: "API_DELIVERY", status: "SUCCEEDED" },
        }),
        catalogClient,
      );
    }
    await ingestParsedEvent(
      makeEnvelope({
        eventId: "evt-deprecated-1",
        context: { productVersion: "1.2.0", subscriptionId: "sub-d" },
        operation: { stage: "API_DELIVERY", status: "SUCCEEDED" },
      }),
      catalogClient,
    );

    const adoption = await getVersionAdoption(pool, catalogClient, DEMO_PRODUCT);
    const byVersion = new Map(adoption.map((a) => [a.version, a]));

    expect(byVersion.get("1.3.0")?.subscriberCount).toBe(3);
    expect(byVersion.get("1.2.0")?.subscriberCount).toBe(1);
    expect(byVersion.get("1.3.0")?.adoptionPercentage).toBe(75);
    expect(byVersion.get("1.2.0")?.adoptionPercentage).toBe(25);
    expect(byVersion.get("1.3.0")?.lifecycleStatus).toBe("ACTIVE");
    expect(byVersion.get("1.2.0")?.lifecycleStatus).toBe("DEPRECATED");
  });

  it("isolates deprecated-version usage from the full adoption breakdown", async () => {
    await ingestParsedEvent(
      makeEnvelope({ eventId: "evt-dep-1", context: { productVersion: "1.2.0", subscriptionId: "sub-x" } }),
      catalogClient,
    );
    await ingestParsedEvent(
      makeEnvelope({ eventId: "evt-act-1", context: { productVersion: "1.3.0", subscriptionId: "sub-y" } }),
      catalogClient,
    );

    const deprecated = await getDeprecatedVersionUsage(pool, catalogClient, DEMO_PRODUCT);
    expect(deprecated).toHaveLength(1);
    expect(deprecated[0]!.version).toBe("1.2.0");
    expect(deprecated[0]!.subscriberCount).toBe(1);
  });
});
