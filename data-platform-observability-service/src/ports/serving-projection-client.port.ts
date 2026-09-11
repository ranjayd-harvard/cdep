// Boundary for serving-projection-service's ops-only /internal/v1/
// projection-runs. projection_runs carries no tenant columns (confirmed) —
// this only ever feeds service_health, never a per-execution stage (plan
// section 9 flagged reduction #4).
export interface ProjectionRunRecord {
  projectionRunId: string;
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface ServingProjectionClient {
  listRecent(limit: number): Promise<ProjectionRunRecord[]>;
}
