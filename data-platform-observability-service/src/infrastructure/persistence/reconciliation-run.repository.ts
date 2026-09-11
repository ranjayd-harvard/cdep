import type pg from "pg";

export async function startReconciliationRun(client: pg.Pool | pg.PoolClient, reconciliationRunId: string, adapterName: string): Promise<void> {
  await client.query(`INSERT INTO reconciliation_runs (reconciliation_run_id, adapter_name) VALUES ($1, $2)`, [
    reconciliationRunId,
    adapterName,
  ]);
}

export async function completeReconciliationRun(
  client: pg.Pool | pg.PoolClient,
  params: {
    reconciliationRunId: string;
    status: "SUCCEEDED" | "FAILED";
    recordsScanned: number;
    driftDetectedCount: number;
    driftRepairedCount: number;
    errorMessage: string | null;
  },
): Promise<void> {
  await client.query(
    `UPDATE reconciliation_runs SET
       status = $2, completed_at = now(), records_scanned = $3, drift_detected_count = $4,
       drift_repaired_count = $5, error_message = $6
     WHERE reconciliation_run_id = $1`,
    [params.reconciliationRunId, params.status, params.recordsScanned, params.driftDetectedCount, params.driftRepairedCount, params.errorMessage],
  );
}

export async function listRecentReconciliationRuns(client: pg.Pool | pg.PoolClient, adapterName?: string, limit = 50): Promise<any[]> {
  if (adapterName) {
    const { rows } = await client.query(
      `SELECT * FROM reconciliation_runs WHERE adapter_name = $1 ORDER BY started_at DESC LIMIT $2`,
      [adapterName, Math.min(limit, 200)],
    );
    return rows;
  }
  const { rows } = await client.query(`SELECT * FROM reconciliation_runs ORDER BY started_at DESC LIMIT $1`, [Math.min(limit, 200)]);
  return rows;
}
