import { v7 as uuidv7 } from "uuid";
import { ID_PREFIXES } from "../../config/constants.js";

// Public identifiers are UUIDv7 (time-ordered) rendered without dashes,
// prefixed by resource type — mirrors data-exchange-service. Note:
// domain_id / owner_id / data_product_id are NOT generated here — those are
// human/contract-assigned slugs (e.g. "events", "event-performance"), per
// spec §7/§8/§9's worked examples.
function generate(prefix: string): string {
  return `${prefix}-${uuidv7().replace(/-/g, "")}`;
}

export const generateDataProductVersionId = () => generate(ID_PREFIXES.dataProductVersion);
export const generateSchemaFieldId = () => generate(ID_PREFIXES.schemaField);
export const generateContractId = () => generate(ID_PREFIXES.contract);
export const generateQualityPolicyId = () => generate(ID_PREFIXES.qualityPolicy);
export const generateSlaPolicyId = () => generate(ID_PREFIXES.slaPolicy);
export const generateDeliveryMethodId = () => generate(ID_PREFIXES.deliveryMethod);
export const generatePublicationPolicyId = () => generate(ID_PREFIXES.publicationPolicy);
export const generateRegistrationEventId = () => generate(ID_PREFIXES.registrationEvent);
export const generateCorrelationId = () => generate(ID_PREFIXES.correlation);
export const generateCompatibilityResultId = () => generate(ID_PREFIXES.compatibilityResult);
export const generateVersionDependencyId = () => generate(ID_PREFIXES.versionDependency);
export const generateMigrationPlanId = () => generate(ID_PREFIXES.migrationPlan);
export const generateMigrationSubscriptionId = () => generate(ID_PREFIXES.migrationSubscription);
export const generateVersionApprovalId = () => generate(ID_PREFIXES.versionApproval);
export const generateBetaOptInId = () => generate(ID_PREFIXES.betaOptIn);
export const generateAuditEventId = () => generate(ID_PREFIXES.auditEvent);
