import { DependencyError } from "../../common/errors/dependency-error.js";
import { env, schedulingServiceEnabled } from "../../config/env.js";
import type { ScheduledExecutionRecord, SchedulingClient } from "../../ports/scheduling-client.port.js";

interface ScheduledExecutionWire {
  execution_id: string;
  subscription_id: string;
  organization_id: string;
  tenant_id: string;
  data_product_id: string;
  resolved_product_version: string | null;
  delivery_method: "FILE" | "API" | null;
  status: string;
  scheduled_for: string | null;
  publication_id: string | null;
  failure_category: string | null;
  failure_code: string | null;
}

export class SchedulingHttpClient implements SchedulingClient {
  async listExecutions(params: { scheduledFrom?: Date; scheduledTo?: Date; limit: number }): Promise<ScheduledExecutionRecord[]> {
    if (!schedulingServiceEnabled) return [];

    const query = new URLSearchParams({ limit: String(params.limit) });
    if (params.scheduledFrom) query.set("scheduled_from", params.scheduledFrom.toISOString());
    if (params.scheduledTo) query.set("scheduled_to", params.scheduledTo.toISOString());

    let response: Response;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), env.SCHEDULING_SERVICE_TIMEOUT_SECONDS * 1000);
      try {
        response = await fetch(`${env.SCHEDULING_SERVICE_URL}/internal/scheduler/executions?${query.toString()}`, {
          headers: {
            Accept: "application/json",
            "x-internal-api-key": env.SCHEDULING_SERVICE_INTERNAL_API_KEY,
            "x-actor-type": "SERVICE",
            "x-actor-id": "data-platform-observability-service",
            "x-actor-role": "PLATFORM_ADMIN",
          },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      throw new DependencyError(`Scheduling Service request failed: ${(err as Error).message}`, "SCHEDULING", true);
    }

    if (!response.ok) {
      throw new DependencyError(`Scheduling Service returned ${response.status}.`, "SCHEDULING", response.status >= 500);
    }

    const body = (await response.json()) as { items: ScheduledExecutionWire[] };
    return body.items.map((item) => ({
      scheduledRunId: item.execution_id,
      subscriptionId: item.subscription_id,
      organizationId: item.organization_id,
      tenantId: item.tenant_id,
      dataProductId: item.data_product_id,
      resolvedProductVersion: item.resolved_product_version,
      deliveryMethod: item.delivery_method,
      status: item.status,
      scheduledFor: item.scheduled_for ? new Date(item.scheduled_for) : null,
      publicationId: item.publication_id,
      failureCategory: item.failure_category,
      failureCode: item.failure_code,
    }));
  }
}
