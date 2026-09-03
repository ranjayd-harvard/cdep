import type { OrganizationInvitation, UserRole } from "@/models";
import type { OrganizationInvitationService } from "@/services/interfaces";
import {
  createInvitation,
  listPendingInvitationsForOrganization,
  revokeInvitation,
} from "@/lib/organization-invitation-directory";

export class MongoOrganizationInvitationService implements OrganizationInvitationService {
  inviteToOrganization(input: {
    organizationId: string;
    tenantId: string;
    email: string;
    role: UserRole;
    invitedBy: string;
  }): Promise<OrganizationInvitation> {
    return createInvitation(input);
  }

  listPendingInvitations(organizationId: string): Promise<OrganizationInvitation[]> {
    return listPendingInvitationsForOrganization(organizationId);
  }

  revokeInvitation(invitationId: string): Promise<void> {
    return revokeInvitation(invitationId);
  }
}
