export const MembershipRequestStatus = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
} as const;

export type MembershipRequestStatus = (typeof MembershipRequestStatus)[keyof typeof MembershipRequestStatus];

export interface OrganizationMembershipRequest {
  id: string;
  organizationId: string;
  userId: string;
  userName: string;
  userEmail: string;
  status: MembershipRequestStatus;
  requestedAt: Date;
  resolvedAt: Date | null;
  resolvedBy: string | null;
}
