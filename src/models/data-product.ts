export const DataProductStatus = {
  ACTIVE: "ACTIVE",
  DEPRECATED: "DEPRECATED",
  COMING_SOON: "COMING_SOON",
} as const;

export type DataProductStatus = (typeof DataProductStatus)[keyof typeof DataProductStatus];

/**
 * A Data Product groups one or more Datasets into the unit that
 * Entitlements are actually granted against. It is shared catalog
 * content — the same DataProduct document is visible to every tenant —
 * so, unlike Entitlement, it carries no tenantId of its own.
 */
export interface DataProduct {
  id: string;
  name: string;
  displayName: string;
  description: string;
  domain: string;
  owner: string;
  status: DataProductStatus;
}
