import { DependencyError } from "../../common/errors/dependency-error.js";
import { env, publicationServiceEnabled } from "../../config/env.js";
import type { PublicationClient, PublicationRunRecord } from "../../ports/publication-client.port.js";

interface PublicationRunWire {
  publication_id: string;
  organization_id: string;
  tenant_id: string;
  data_product_id: string;
  product_version: string;
  source_pipeline_run_id: string | null;
  status: string;
  outbound_exchange_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  input_record_count: number | null;
  output_record_count: number | null;
  error_code: string | null;
  error_message: string | null;
}

export class PublicationHttpClient implements PublicationClient {
  async listRecent(limit: number): Promise<PublicationRunRecord[]> {
    if (!publicationServiceEnabled) return [];

    let response: Response;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), env.PUBLICATION_SERVICE_TIMEOUT_SECONDS * 1000);
      try {
        response = await fetch(`${env.PUBLICATION_SERVICE_URL}/internal/v1/publications?limit=${limit}`, {
          headers: { Accept: "application/json", "x-internal-api-key": env.PUBLICATION_SERVICE_INTERNAL_API_KEY },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      throw new DependencyError(`Publication Service request failed: ${(err as Error).message}`, "PUBLICATION", true);
    }

    if (!response.ok) {
      throw new DependencyError(`Publication Service returned ${response.status}.`, "PUBLICATION", response.status >= 500);
    }

    const items = (await response.json()) as PublicationRunWire[];
    return items.map((item) => ({
      publicationId: item.publication_id,
      organizationId: item.organization_id,
      tenantId: item.tenant_id,
      dataProductId: item.data_product_id,
      productVersion: item.product_version,
      sourcePipelineRunId: item.source_pipeline_run_id,
      status: item.status,
      outboundExchangeId: item.outbound_exchange_id,
      startedAt: item.started_at ? new Date(item.started_at) : null,
      completedAt: item.completed_at ? new Date(item.completed_at) : null,
      inputRecordCount: item.input_record_count,
      outputRecordCount: item.output_record_count,
      errorCode: item.error_code,
      errorMessage: item.error_message,
    }));
  }
}
