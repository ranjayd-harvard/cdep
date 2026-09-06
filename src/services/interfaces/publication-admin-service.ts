/**
 * Superadmin-only surface over data-publication-service's internal API --
 * backs the "Publish Gold Product" panel on `/admin/lakehouse/pipelines`.
 * Deliberately a separate interface/implementation from
 * `LakehouseAdminService`, mirroring that service's own precedent: this
 * talks to a different backend (data-publication-service, not
 * data-lakehouse) with its own base URL/key, so keeping it structurally
 * separate avoids a false coupling between two independently-deployable
 * services.
 */
export interface PublicationRunRow {
  publicationId: string;
  organizationId: string;
  tenantId: string;
  dataProductId: string;
  productVersion: string;
  sourceGoldTable: string;
  sourceGoldSnapshotId: string | null;
  sourcePipelineRunId: string | null;
  requestedFormat: string | null;
  status: string;
  inputRecordCount: number | null;
  outputRecordCount: number | null;
  artifactCount: number | null;
  outboundExchangeId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface PublicationArtifactRow {
  artifactId: string;
  filename: string;
  format: string;
  contentType: string | null;
  compression: string | null;
  sizeBytes: number | null;
  checksumAlgorithm: string | null;
  checksum: string | null;
  recordCount: number | null;
}

export interface PublicationQualityResultRow {
  ruleName: string;
  severity: string;
  totalCount: number | null;
  failedCount: number | null;
  passed: boolean;
}

export interface PublicationRunDetail {
  run: PublicationRunRow;
  artifacts: PublicationArtifactRow[];
  qualityResults: PublicationQualityResultRow[];
}

export interface TriggerPublishResult {
  ok: boolean;
  publicationId?: string;
  status?: string;
  outboundExchangeId?: string | null;
  outputRecordCount?: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface PublicationAdminService {
  listPublications(limit?: number): Promise<{ available: boolean; items: PublicationRunRow[] }>;
  getPublicationDetail(publicationId: string): Promise<PublicationRunDetail | null>;
  triggerPublish(pipelineRunId: string, format?: string, republish?: boolean): Promise<TriggerPublishResult>;
}
