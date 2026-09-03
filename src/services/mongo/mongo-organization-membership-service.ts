import type { OrganizationMembershipRequest } from "@/models";
import type { OrganizationMembershipService } from "@/services/interfaces";
import {
  approveMembershipRequest,
  createMembershipRequest,
  findPendingRequestForUser,
  listPendingRequestsForOrganization,
  rejectMembershipRequest,
} from "@/lib/organization-membership-directory";

export class MongoOrganizationMembershipService implements OrganizationMembershipService {
  requestToJoin(
    organizationId: string,
    requester: { userId: string; userName: string; userEmail: string },
  ): Promise<OrganizationMembershipRequest> {
    return createMembershipRequest({ organizationId, ...requester });
  }

  findPendingRequestForUser(userId: string): Promise<OrganizationMembershipRequest | null> {
    return findPendingRequestForUser(userId);
  }

  listPendingRequests(organizationId: string): Promise<OrganizationMembershipRequest[]> {
    return listPendingRequestsForOrganization(organizationId);
  }

  approveRequest(requestId: string, approverId: string): Promise<void> {
    return approveMembershipRequest(requestId, approverId);
  }

  rejectRequest(requestId: string, approverId: string): Promise<void> {
    return rejectMembershipRequest(requestId, approverId);
  }
}
