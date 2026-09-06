export interface InboundManifest {
  manifestVersion: "1.0";
  exchange: {
    exchangeId: string;
    direction: "INBOUND";
    status: string;
  };
  ownership: {
    organizationId: string;
    tenantId: string;
  };
  submittedBy: {
    userId: string | null;
  };
  dataProduct: {
    dataProductId: string;
    schemaVersion: string | null;
  };
  file: {
    originalFilename: string;
    contentType: string;
    format: string;
    sizeBytes: number;
    checksumAlgorithm: "SHA-256";
    checksum: string;
  };
  source: {
    channel: string;
  };
  timestamps: {
    uploadStartedAt: string | null;
    receivedAt: string;
  };
}

export interface OutboundManifest {
  manifestVersion: "1.0";
  exchange: {
    exchangeId: string;
    direction: "OUTBOUND";
    status: string;
  };
  ownership: {
    organizationId: string;
    tenantId: string;
  };
  dataProduct: {
    dataProductId: string;
    schemaVersion: string | null;
  };
  file: {
    publishedFilename: string;
    contentType: string;
    format: string;
    sizeBytes: number;
    recordCount?: number;
    checksumAlgorithm: "SHA-256";
    checksum: string;
  };
  // Populated only for real Gold -> Publication Service handoffs (see
  // modules/outbound-publications/) -- absent for the older fixture-content
  // simulator in modules/publications/. Links this manifest back to the
  // Publication control-plane and, from there, to the exact Gold Iceberg
  // snapshot/pipeline run it was read from (AGENTS.md Phase 4 section 25/41).
  publication?: {
    publicationId: string;
    goldSnapshotId: string | null;
    goldPipelineRunId: string | null;
  };
  timestamps: {
    publishedAt: string;
    expiresAt?: string | null;
  };
}
