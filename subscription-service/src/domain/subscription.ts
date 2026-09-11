import type { MinorUpgradeBehavior, SubscriptionStatus } from "../config/constants.js";
import type { VersionPolicy } from "./version-policy.js";

export interface Subscription {
  subscriptionId: string;
  organizationId: string;
  tenantId: string;
  dataProductId: string;
  status: SubscriptionStatus;
  versionPolicy: VersionPolicy;
  minorUpgradeBehavior: MinorUpgradeBehavior;
  lastResolvedVersion: string | null;
  requestedAt: Date;
  activatedAt: Date | null;
  pausedAt: Date | null;
  suspendedAt: Date | null;
  cancelledAt: Date | null;
  suspensionReason: string | null;
  cancellationReason: string | null;
  version: number;
}
