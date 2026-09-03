import type { Organization } from "@/models";

export interface OrganizationService {
  getOrganization(organizationId: string): Promise<Organization | null>;
  createOrganization(input: { displayName: string }): Promise<Organization>;
  searchOrganizationsByName(query: string): Promise<Organization[]>;
  listOrganizations(): Promise<Organization[]>;
  setOrganizationStatus(organizationId: string, status: Organization["status"]): Promise<void>;
}
