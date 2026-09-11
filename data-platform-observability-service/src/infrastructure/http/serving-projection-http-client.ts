import { DependencyError } from "../../common/errors/dependency-error.js";
import { env, servingProjectionServiceEnabled } from "../../config/env.js";
import type { ProjectionRunRecord, ServingProjectionClient } from "../../ports/serving-projection-client.port.js";

interface ProjectionRunWire {
  projection_run_id: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
}

export class ServingProjectionHttpClient implements ServingProjectionClient {
  async listRecent(limit: number): Promise<ProjectionRunRecord[]> {
    if (!servingProjectionServiceEnabled) return [];

    let response: Response;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), env.SERVING_PROJECTION_SERVICE_TIMEOUT_SECONDS * 1000);
      try {
        response = await fetch(`${env.SERVING_PROJECTION_SERVICE_URL}/internal/v1/projection-runs?limit=${limit}`, {
          headers: { Accept: "application/json", "x-internal-api-key": env.SERVING_PROJECTION_SERVICE_INTERNAL_API_KEY },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      throw new DependencyError(`Serving Projection Service request failed: ${(err as Error).message}`, "SERVING_PROJECTION", true);
    }

    if (!response.ok) {
      throw new DependencyError(`Serving Projection Service returned ${response.status}.`, "SERVING_PROJECTION", response.status >= 500);
    }

    const body = (await response.json()) as { items?: ProjectionRunWire[] } | ProjectionRunWire[];
    const items = Array.isArray(body) ? body : (body.items ?? []);
    return items.map((item) => ({
      projectionRunId: item.projection_run_id,
      status: item.status,
      startedAt: item.started_at ? new Date(item.started_at) : null,
      completedAt: item.completed_at ? new Date(item.completed_at) : null,
    }));
  }
}
