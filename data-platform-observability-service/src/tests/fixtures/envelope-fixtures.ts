import type { EventEnvelope } from "../../application/dto/event-envelope.dto.js";

export const DEMO_ORG = "org-vobis-org-722aea";
export const DEMO_TENANT = "tenant-default-47d849";
export const DEMO_PRODUCT = "event-performance";
export const DEMO_VERSION = "1.3.0";

type EnvelopeOverrides = Partial<Omit<EventEnvelope, "context" | "correlation" | "operation">> & {
  context?: Partial<EventEnvelope["context"]>;
  correlation?: Partial<EventEnvelope["correlation"]>;
  operation?: Partial<EventEnvelope["operation"]>;
};

let counter = 0;

// A minimal, valid envelope with sensible demo-scope defaults — tests
// override only what's relevant to what they're checking.
export function makeEnvelope(overrides: EnvelopeOverrides = {}): EventEnvelope {
  counter += 1;
  return {
    eventId: overrides.eventId ?? `test-evt-${counter}`,
    eventType: overrides.eventType ?? "TEST_EVENT",
    occurredAt: overrides.occurredAt ?? new Date().toISOString(),
    source: overrides.source ?? { service: "test-service", entityType: "test_entity", entityId: `entity-${counter}` },
    context: {
      organizationId: DEMO_ORG,
      tenantId: DEMO_TENANT,
      dataProductId: DEMO_PRODUCT,
      productVersion: DEMO_VERSION,
      ...overrides.context,
    },
    correlation: { ...overrides.correlation },
    operation: {
      stage: overrides.operation?.stage,
      status: overrides.operation?.status,
      attempt: overrides.operation?.attempt ?? 1,
      errorCategory: overrides.operation?.errorCategory,
      errorCode: overrides.operation?.errorCode,
      errorMessage: overrides.operation?.errorMessage,
    },
    metrics: overrides.metrics ?? {},
    metadata: overrides.metadata ?? {},
  };
}
