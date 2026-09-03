import type { DataProduct } from "@/models";

export interface DataProductService {
  getDataProducts(tenantId: string): Promise<DataProduct[]>;
  getDataProduct(tenantId: string, dataProductId: string): Promise<DataProduct | null>;
}
