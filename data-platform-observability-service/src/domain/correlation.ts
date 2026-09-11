import { IDENTIFIER_TYPES, type IdentifierType } from "../config/constants.js";

export type CorrelationDecision =
  | { action: "ATTACH"; executionId: string; confidence: "EXACT" | "HEURISTIC" }
  | { action: "CREATE" };

// Assembles the identifiers present on an incoming normalized event in
// IDENTIFIER_TYPES priority order (plan section 5) — a downstream id like
// publication_id is checked before an upstream one like inbound_exchange_id
// since it's more likely to already be indexed by the time a later event
// arrives.
export function orderIdentifiersByPriority(
  present: Partial<Record<IdentifierType, string>>,
): Array<{ idType: IdentifierType; idValue: string }> {
  const ordered: Array<{ idType: IdentifierType; idValue: string }> = [];
  for (const idType of IDENTIFIER_TYPES) {
    const value = present[idType];
    if (value) ordered.push({ idType, idValue: value });
  }
  return ordered;
}

export interface CorrelationInput {
  // Identifiers present on the incoming event, already ordered by priority
  // (orderIdentifiersByPriority above).
  identifiers: Array<{ idType: IdentifierType; idValue: string }>;
  // Pre-resolved by the repository layer: for each (idType, idValue) pair
  // already present in operational_execution_identifiers, the execution_id
  // it maps to. Key is `${idType}:${idValue}`. Kept as a resolved map
  // (rather than an async lookup function) so this function stays pure and
  // synchronously unit-testable.
  matchedExecutionIds: ReadonlyMap<string, string>;
  // The most recent still-open execution for this event's
  // (organization, tenant, data_product, product_version) scope, already
  // queried by the repository within CORRELATION_WINDOW_MINUTES — null if
  // none exists. Only consulted when no exact identifier match is found.
  mostRecentOpenExecutionId: string | null;
}

export function identifierKey(idType: IdentifierType, idValue: string): string {
  return `${idType}:${idValue}`;
}

// The correlation decision (plan section 5): exact ID match first (chained
// fields hit the same flat index under a different original id_type, so
// this single pass covers both "direct" and "chained" matches), heuristic
// scope+time-window fallback second, new execution only if neither hits.
export function decideCorrelation(input: CorrelationInput): CorrelationDecision {
  for (const { idType, idValue } of input.identifiers) {
    const match = input.matchedExecutionIds.get(identifierKey(idType, idValue));
    if (match) {
      return { action: "ATTACH", executionId: match, confidence: "EXACT" };
    }
  }

  if (input.mostRecentOpenExecutionId) {
    return { action: "ATTACH", executionId: input.mostRecentOpenExecutionId, confidence: "HEURISTIC" };
  }

  return { action: "CREATE" };
}
