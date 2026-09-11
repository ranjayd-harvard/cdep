import { describe, expect, it } from "vitest";
import { decideCorrelation, identifierKey, orderIdentifiersByPriority } from "../../domain/correlation.js";

describe("orderIdentifiersByPriority", () => {
  it("orders present identifiers by IDENTIFIER_TYPES priority, dropping absent ones", () => {
    const ordered = orderIdentifiersByPriority({
      INBOUND_EXCHANGE_ID: "exch-1",
      PUBLICATION_ID: "pub-1",
    });
    expect(ordered).toEqual([
      { idType: "PUBLICATION_ID", idValue: "pub-1" },
      { idType: "INBOUND_EXCHANGE_ID", idValue: "exch-1" },
    ]);
  });
});

describe("decideCorrelation", () => {
  it("attaches to an execution on an exact identifier match", () => {
    const decision = decideCorrelation({
      identifiers: [{ idType: "PUBLICATION_ID", idValue: "pub-1" }],
      matchedExecutionIds: new Map([[identifierKey("PUBLICATION_ID", "pub-1"), "oexec-1"]]),
      mostRecentOpenExecutionId: null,
    });
    expect(decision).toEqual({ action: "ATTACH", executionId: "oexec-1", confidence: "EXACT" });
  });

  it("checks identifiers in priority order and stops at the first match", () => {
    const decision = decideCorrelation({
      identifiers: [
        { idType: "PUBLICATION_ID", idValue: "pub-unknown" },
        { idType: "INGESTION_ID", idValue: "ing-1" },
      ],
      matchedExecutionIds: new Map([[identifierKey("INGESTION_ID", "ing-1"), "oexec-2"]]),
      mostRecentOpenExecutionId: null,
    });
    expect(decision).toEqual({ action: "ATTACH", executionId: "oexec-2", confidence: "EXACT" });
  });

  it("falls back to the heuristic scope match when no exact identifier matches", () => {
    const decision = decideCorrelation({
      identifiers: [{ idType: "PUBLICATION_ID", idValue: "pub-unknown" }],
      matchedExecutionIds: new Map(),
      mostRecentOpenExecutionId: "oexec-3",
    });
    expect(decision).toEqual({ action: "ATTACH", executionId: "oexec-3", confidence: "HEURISTIC" });
  });

  it("creates a new execution when nothing matches at all", () => {
    const decision = decideCorrelation({
      identifiers: [],
      matchedExecutionIds: new Map(),
      mostRecentOpenExecutionId: null,
    });
    expect(decision).toEqual({ action: "CREATE" });
  });
});
