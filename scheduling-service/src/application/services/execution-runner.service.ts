import { withTransaction } from "../../database/transaction.js";
import { claimReadyExecutions } from "../../infrastructure/persistence/execution.repository.js";
import type { Clock } from "../../ports/clock.port.js";
import type { ExecutionProcessor } from "./execution-processor.service.js";

const CLAIM_BATCH_SIZE = 50;

// Fulfills both the "dispatch what DueScheduleScanner found" role and the
// RetryCoordinator role (AGENTS.md section 13/40) — a fresh PENDING row
// (from a scheduled due-scan or a manual trigger) and a RETRY_WAIT row
// whose next_retry_at has arrived are claimed and processed identically:
// ExecutionProcessor always re-runs the full revalidation pipeline rather
// than resuming mid-flight, since dependency state may have changed since
// the last attempt. Claiming (FOR UPDATE SKIP LOCKED, short transaction)
// and processing (network calls) are deliberately separate steps.
export class ExecutionRunner {
  constructor(
    private readonly clock: Clock,
    private readonly processor: ExecutionProcessor,
  ) {}

  async runOnce(): Promise<{ processed: number }> {
    const now = this.clock.now();
    const claimed = await withTransaction((client) => claimReadyExecutions(client, now, CLAIM_BATCH_SIZE));

    for (const execution of claimed) {
      await this.processor.process(execution);
    }

    return { processed: claimed.length };
  }
}
