// Builds the exact inbound/outbound object-key layout mandated by
// AGENTS.md sections 8 and 9. This is the ONLY place object keys are
// constructed — clients never supply paths (section 60), and callers only
// ever pass in already-trusted server-side values (organizationId/tenantId
// come from RequestContext, never from request bodies).

function datePathParts(date: Date): { yyyy: string; mm: string; dd: string } {
  return {
    yyyy: String(date.getUTCFullYear()),
    mm: String(date.getUTCMonth() + 1).padStart(2, "0"),
    dd: String(date.getUTCDate()).padStart(2, "0"),
  };
}

export function buildInboundDataKey(
  organizationId: string,
  tenantId: string,
  exchangeId: string,
  filename: string,
  date: Date = new Date(),
): string {
  const { yyyy, mm, dd } = datePathParts(date);
  return `organizations/${organizationId}/tenants/${tenantId}/uploads/${yyyy}/${mm}/${dd}/${exchangeId}/data/${filename}`;
}

export function buildInboundMetadataKey(
  organizationId: string,
  tenantId: string,
  exchangeId: string,
  metadataFilename: "manifest.json" | "validation.json" | "processing.json",
  date: Date = new Date(),
): string {
  const { yyyy, mm, dd } = datePathParts(date);
  return `organizations/${organizationId}/tenants/${tenantId}/uploads/${yyyy}/${mm}/${dd}/${exchangeId}/metadata/${metadataFilename}`;
}

export function buildOutboundDataKey(
  organizationId: string,
  tenantId: string,
  exchangeId: string,
  filename: string,
  date: Date = new Date(),
): string {
  const { yyyy, mm, dd } = datePathParts(date);
  return `organizations/${organizationId}/tenants/${tenantId}/downloads/${yyyy}/${mm}/${dd}/${exchangeId}/data/${filename}`;
}

export function buildOutboundMetadataKey(
  organizationId: string,
  tenantId: string,
  exchangeId: string,
  metadataFilename: "manifest.json",
  date: Date = new Date(),
): string {
  const { yyyy, mm, dd } = datePathParts(date);
  return `organizations/${organizationId}/tenants/${tenantId}/downloads/${yyyy}/${mm}/${dd}/${exchangeId}/metadata/${metadataFilename}`;
}
