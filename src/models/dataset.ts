export const DatasetAccessMethod = {
  API: "API",
  DOWNLOAD: "DOWNLOAD",
  SFTP: "SFTP",
  DATA_SHARE: "DATA_SHARE",
} as const;

export type DatasetAccessMethod =
  (typeof DatasetAccessMethod)[keyof typeof DatasetAccessMethod];

export const DatasetStatus = {
  ACTIVE: "ACTIVE",
  DEPRECATED: "DEPRECATED",
  COMING_SOON: "COMING_SOON",
} as const;

export type DatasetStatus = (typeof DatasetStatus)[keyof typeof DatasetStatus];

export interface DatasetSchemaField {
  field: string;
  type: string;
  required: boolean;
  description: string;
}

export interface DatasetQualityMetrics {
  completeness: number;
  freshness: number;
  validity: number;
  duplicates: number;
}

export interface DatasetDocumentation {
  businessDefinition: string;
  dataContract: string;
  sla: string;
  changeHistory: Array<{
    version: string;
    date: string;
    summary: string;
  }>;
}

/**
 * Documents which column in the underlying data is enforced against the
 * caller's tenant when rows are actually queried. The value is always
 * bound to the authenticated tenant established by `requireTenantContext`
 * (see `src/lib/tenant.ts`) — the row-level analog of the Entitlement
 * check one layer up, never a value a caller can supply.
 */
export interface RowLevelPolicy {
  tenantColumn: string;
  description: string;
}

export interface Dataset {
  id: string;
  name: string;
  displayName: string;
  description: string;
  domain: string;
  owner: string;
  version: string;
  format: string;
  freshness: string;
  lastUpdated: string;
  status: DatasetStatus;
  accessMethods: DatasetAccessMethod[];
  schema: DatasetSchemaField[];
  quality: DatasetQualityMetrics;
  documentation: DatasetDocumentation;
  rowLevelPolicy: RowLevelPolicy;
}
