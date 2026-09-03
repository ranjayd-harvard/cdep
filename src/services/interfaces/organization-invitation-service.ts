import type { OrganizationInvitation, UserRole } from "@/models";

export interface OrganizationInvitationService {
  inviteToOrganization(input: {
    organizationId: string;
    tenantId: string;
    email: string;
    role: UserRole;
    invitedBy: string;
  }): Promise<OrganizationInvitation>;
  listPendingInvitations(organizationId: string): Promise<OrganizationInvitation[]>;
  revokeInvitation(invitationId: string): Promise<void>;
}
