import { AppError } from "../../common/errors/app-error.js";
import { getDataProduct, getEntitlement } from "./data-product.repository.js";

export async function assertUploadEntitlement(tenantId: string, dataProductId: string): Promise<void> {
  const product = await getDataProduct(dataProductId);
  if (!product || product.status !== "ACTIVE") {
    throw new AppError("DATA_PRODUCT_NOT_FOUND", "The requested data product was not found.");
  }
  const entitlement = await getEntitlement(tenantId, dataProductId);
  if (!entitlement || entitlement.status !== "ACTIVE" || !entitlement.can_upload) {
    throw new AppError("ENTITLEMENT_DENIED", "This tenant is not entitled to upload this data product.");
  }
}

export async function assertDownloadEntitlement(tenantId: string, dataProductId: string): Promise<void> {
  const product = await getDataProduct(dataProductId);
  if (!product || product.status !== "ACTIVE") {
    throw new AppError("DATA_PRODUCT_NOT_FOUND", "The requested data product was not found.");
  }
  const entitlement = await getEntitlement(tenantId, dataProductId);
  if (!entitlement || entitlement.status !== "ACTIVE" || !entitlement.can_download) {
    throw new AppError("ENTITLEMENT_DENIED", "This tenant is not entitled to download this data product.");
  }
}

export { getDataProduct, listDataProducts } from "./data-product.repository.js";
