import type { Organization } from "@/models";
import type { OrganizationService } from "@/services/interfaces";
import {
  createOrganization,
  findOrganizationById,
  listOrganizations,
  searchOrganizationsByName,
  setOrganizationStatus,
} from "@/lib/organization-directory";

export class MongoOrganizationService implements OrganizationService {
  getOrganization(organizationId: string): Promise<Organization | null> {
    return findOrganizationById(organizationId);
  }

  createOrganization(input: { displayName: string }): Promise<Organization> {
    return createOrganization(input);
  }

  searchOrganizationsByName(query: string): Promise<Organization[]> {
    return searchOrganizationsByName(query);
  }

  listOrganizations(): Promise<Organization[]> {
    return listOrganizations();
  }

  setOrganizationStatus(organizationId: string, status: Organization["status"]): Promise<void> {
    return setOrganizationStatus(organizationId, status);
  }
}
