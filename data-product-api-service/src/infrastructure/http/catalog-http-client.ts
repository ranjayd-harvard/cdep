import { DependencyError } from "../../common/errors/dependency-error.js";
import { env } from "../../config/env.js";
import type { ApiContract, CatalogClient } from "../../ports/catalog-client.port.js";

interface ApiContractWire {
  data_product_id: string;
  version: string;
  lifecycle_status: string;
  resource: string;
  published_fields: Array<{ name: string; type: string; nullable: boolean }>;
  filters: string[];
  sorts: string[];
  default_sort: string[];
  default_page_size: number;
  max_page_size: number;
  max_response_bytes: number | null;
  freshness_minutes: number | null;
}

// HTTP implementation of CatalogClient — talks only to
// data-product-catalog-service's /internal/v1/versions/api-contract (spec
// §8.2), never its database.
export class CatalogHttpClient implements CatalogClient {
  async getApiContract(dataProductId: string, version: string): Promise<ApiContract | null> {
    const url = `${env.CATALOG_SERVICE_URL}/internal/v1/versions/api-contract?data_product_id=${encodeURIComponent(dataProductId)}&version=${encodeURIComponent(version)}`;

    let response: Response;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        response = await fetch(url, {
          headers: {
            Accept: "application/json",
            "x-internal-api-key": env.CATALOG_SERVICE_INTERNAL_API_KEY,
            "x-actor-type": "SERVICE",
            "x-actor-id": "data-product-api-service",
            "x-actor-role": "CATALOG_READER",
          },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      throw new DependencyError(`Catalog Service request failed: ${(err as Error).message}`, "CATALOG");
    }

    if (response.status === 404 || response.status === 422) {
      return null;
    }
    if (response.status >= 400) {
      throw new DependencyError(`Catalog Service returned ${response.status} for api-contract.`, "CATALOG");
    }

    const wire = (await response.json()) as ApiContractWire;
    return {
      dataProductId: wire.data_product_id,
      version: wire.version,
      lifecycleStatus: wire.lifecycle_status,
      resource: wire.resource,
      publishedFields: wire.published_fields,
      filters: wire.filters,
      sorts: wire.sorts,
      defaultSort: wire.default_sort,
      defaultPageSize: wire.default_page_size,
      maxPageSize: wire.max_page_size,
      maxResponseBytes: wire.max_response_bytes,
      freshnessMinutes: wire.freshness_minutes,
    };
  }
}
