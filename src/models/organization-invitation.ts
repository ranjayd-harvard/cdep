import type { UserRole } from "./user";

export const InvitationStatus = {
  PENDING: "PENDING",
  ACCEPTED: "ACCEPTED",
  DECLINED: "DECLINED",
  REVOKED: "REVOKED",
} as const;

export type InvitationStatus = (typeof InvitationStatus)[keyof typeof InvitationStatus];

export interface OrganizationInvitation {
  id: string;
  organizationId: string;
  tenantId: string;
  email: string;
  role: UserRole;
  status: InvitationStatus;
  invitedBy: string;
  invitedAt: Date;
  resolvedAt: Date | null;
}
