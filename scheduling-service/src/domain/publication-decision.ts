import type { IneligibilityReasonCode } from "../config/constants.js";

// First-class decision result (AGENTS.md section 30) — operational
// eligibility logic reads `reasonCode`, never free-text `message` parsing.
export interface PublicationDecision {
  eligible: boolean;
  reasonCode: IneligibilityReasonCode | null;
  message: string;
  resolvedVersion: string | null;
  lifecycleStatus: string | null;
}

export function eligibleDecision(resolvedVersion: string, lifecycleStatus: string): PublicationDecision {
  return { eligible: true, reasonCode: null, message: "Eligible for publication.", resolvedVersion, lifecycleStatus };
}

export function ineligibleDecision(reasonCode: IneligibilityReasonCode, message: string): PublicationDecision {
  return { eligible: false, reasonCode, message, resolvedVersion: null, lifecycleStatus: null };
}
