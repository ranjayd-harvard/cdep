// Port for the Catalog integration boundary (spec §8.1/§8.2). Catalog
// remains the authoritative source of the published-field allowlist and
// the API query policy (filters/sorts/pagination/freshness) — this service
// never derives that from the serving-store schema.
export interface ApiContractField {
  name: string;
  type: string;
  nullable: boolean;
}

export interface ApiContract {
  dataProductId: string;
  version: string;
  lifecycleStatus: string;
  resource: string;
  publishedFields: ApiContractField[];
  filters: string[];
  sorts: string[];
  defaultSort: string[];
  defaultPageSize: number;
  maxPageSize: number;
  maxResponseBytes: number | null;
  freshnessMinutes: number | null;
}

export interface CatalogClient {
  getApiContract(dataProductId: string, version: string): Promise<ApiContract | null>;
}
