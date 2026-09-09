import type { DataProduct } from "@/models";

export interface DataProductInput {
  name: string;
  displayName: string;
  description: string;
  domain: string;
  owner: string;
  status: DataProduct["status"];
}

export interface DataProductService {
  getDataProducts(tenantId: string): Promise<DataProduct[]>;
  getDataProduct(tenantId: string, dataProductId: string): Promise<DataProduct | null>;

  /**
   * Admin Console only (`src/app/admin/data-products`): the full catalog,
   * unfiltered by any tenant's entitlements — same shape as
   * `listOrganizations` on `OrganizationService`.
   */
  listAllDataProducts(): Promise<DataProduct[]>;
  createDataProduct(input: DataProductInput): Promise<DataProduct>;
  updateDataProduct(dataProductId: string, input: DataProductInput): Promise<DataProduct | null>;
  deleteDataProduct(dataProductId: string): Promise<void>;
}
