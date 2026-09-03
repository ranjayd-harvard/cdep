export type OrganizationStatus = "active" | "inactive";

export interface Organization {
  id: string;
  name: string;
  displayName: string;
  status: OrganizationStatus;
}
