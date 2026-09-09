// npm run seed
//
// Provisions the reference data (Domain + Owner) that the Event Performance
// example contract needs to exist before it can be registered — spec §31.
// Registration itself creates the Data Product/Version/Schema/Contract; it
// deliberately does NOT auto-create Domains/Owners (see registration.service.ts),
// so this script (or the equivalent POST /internal/v1/domains|owners calls)
// is the one-time setup step before the Contract-as-Code workflow.
import { pool } from "../src/database/pool.js";
import { findDomain, createDomain } from "../src/modules/domains/domain.repository.js";
import { findOwner, createOwner } from "../src/modules/owners/owner.repository.js";
import { logger } from "../src/common/logger/logger.js";

async function main() {
  const existingDomain = await findDomain("events");
  if (existingDomain) {
    logger.info("Domain 'events' already exists");
  } else {
    await createDomain({ domainId: "events", name: "events", displayName: "Events", description: "Event ticketing and performance data." });
    logger.info("Created domain 'events'");
  }

  const existingOwner = await findOwner("event-analytics");
  if (existingOwner) {
    logger.info("Owner 'event-analytics' already exists");
  } else {
    await createOwner({
      ownerId: "event-analytics",
      ownerType: "TEAM",
      name: "Event Analytics",
      team: "Event Analytics",
    });
    logger.info("Created owner 'event-analytics'");
  }

  await pool.end();
}

main().catch((err) => {
  logger.error({ err }, "Seed failed");
  process.exit(1);
});
