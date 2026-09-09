import { v7 as uuidv7 } from "uuid";
import { ID_PREFIXES } from "../../config/constants.js";

// Public identifiers are UUIDv7 (time-ordered) rendered without dashes,
// prefixed by resource type — mirrors data-exchange-service and
// data-product-catalog-service.
function generate(prefix: string): string {
  return `${prefix}-${uuidv7().replace(/-/g, "")}`;
}

export const generateEntitlementId = () => generate(ID_PREFIXES.entitlement);
export const generateSubscriptionId = () => generate(ID_PREFIXES.subscription);
export const generateDeliveryPreferenceId = () => generate(ID_PREFIXES.deliveryPreference);
export const generateAuditEventId = () => generate(ID_PREFIXES.auditEvent);
export const generateCorrelationId = () => generate(ID_PREFIXES.correlation);
