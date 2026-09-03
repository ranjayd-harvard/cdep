import type { OrganizationMembershipRequest } from "@/models";

export interface OrganizationMembershipService {
  requestToJoin(
    organizationId: string,
    requester: { userId: string; userName: string; userEmail: string },
  ): Promise<OrganizationMembershipRequest>;
  findPendingRequestForUser(userId: string): Promise<OrganizationMembershipRequest | null>;
  listPendingRequests(organizationId: string): Promise<OrganizationMembershipRequest[]>;
  approveRequest(requestId: string, approverId: string): Promise<void>;
  rejectRequest(requestId: string, approverId: string): Promise<void>;
}
