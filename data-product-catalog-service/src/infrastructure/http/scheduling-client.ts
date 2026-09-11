import { AppError } from "../../common/errors/app-error.js";
import { env, schedulingServiceEnabled } from "../../config/env.js";

// Phase 10 §21 point 2: the retirement guard's "scheduled jobs" blocker
// check. scheduling-service's executions listing has no version-level
// filter (only data_product_id/status/etc.) — client-side filtering by
// `resolved_product_version`/`requested_version_policy` is intentional
// here, not a shortcut; do not assume server-side filtering exists.
export class SchedulingServiceUnavailableError extends AppError {
  constructor(message: string) {
    super("INTERNAL_ERROR", message);
  }
}

const NON_TERMINAL_STATUSES = new Set(["PENDING", "EVALUATING", "ELIGIBLE", "DISPATCHING", "SUBMITTED", "RETRY_WAIT"]);

export interface ScheduledExecutionDTO {
  executionId: string;
  dataProductId: string;
  resolvedProductVersion: string | null;
  requestedVersionPolicy: { type: string; value: string | null };
  status: string;
}

async function fetchJson<T>(path: string): Promise<T> {
  if (!schedulingServiceEnabled) {
    throw new SchedulingServiceUnavailableError("SCHEDULING_SERVICE_URL is not configured.");
  }
  const headers: Record<string, string> = {
    Accept: "application/json",
    "x-internal-api-key": env.SCHEDULING_SERVICE_INTERNAL_API_KEY,
    "x-actor-type": "SERVICE",
    "x-actor-id": "data-product-catalog-service",
    "x-actor-role": "CATALOG_READER",
  };
  let response: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.SCHEDULING_SERVICE_TIMEOUT_SECONDS * 1000);
    try {
      response = await fetch(`${env.SCHEDULING_SERVICE_URL}${path}`, { headers, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    throw new SchedulingServiceUnavailableError(`scheduling-service request to ${path} failed: ${(err as Error).message}`);
  }
  if (!response.ok) {
    throw new SchedulingServiceUnavailableError(`scheduling-service returned ${response.status} for ${path}.`);
  }
  return (await response.json()) as T;
}

// Returns every non-terminal execution for this product/version, paging
// through the full result set (there is no server-side version filter).
export async function listPendingExecutionsForVersion(dataProductId: string, version: string): Promise<ScheduledExecutionDTO[]> {
  const matches: ScheduledExecutionDTO[] = [];
  let offset = 0;
  const limit = 200;
  for (;;) {
    const page = await fetchJson<{ items: Array<Record<string, unknown>> }>(
      `/internal/scheduler/executions?data_product_id=${encodeURIComponent(dataProductId)}&limit=${limit}&offset=${offset}`,
    );
    for (const raw of page.items) {
      const status = raw.status as string;
      const resolvedVersion = raw.resolved_product_version as string | null;
      const requestedPolicy = raw.requested_version_policy as { type: string; value: string | null };
      const matchesVersion = resolvedVersion === version || (requestedPolicy?.type === "EXACT" && requestedPolicy.value === version);
      if (NON_TERMINAL_STATUSES.has(status) && matchesVersion) {
        matches.push({
          executionId: raw.execution_id as string,
          dataProductId: raw.data_product_id as string,
          resolvedProductVersion: resolvedVersion,
          requestedVersionPolicy: requestedPolicy,
          status,
        });
      }
    }
    if (page.items.length < limit) break;
    offset += limit;
  }
  return matches;
}
