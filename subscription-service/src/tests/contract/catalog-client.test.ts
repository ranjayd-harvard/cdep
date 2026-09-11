import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CatalogUnavailableError,
  getCatalogProduct,
  resolveVersionPolicy,
  validateDeliveryCapability,
} from "../../infrastructure/catalog-client/catalog-client.js";
import { AppError } from "../../common/errors/app-error.js";

// Runs against a real, already-running data-product-catalog-service (spec
// §54) — no Catalog internals are re-implemented here. Requires
// CATALOG_SERVICE_URL to point at a live instance seeded with the
// "event-performance" product (spec §59's Vobis scenario: 1.0.0 DEPRECATED,
// 1.1.0 ACTIVE, 2.0.0 DRAFT).
const KNOWN_PRODUCT = "event-performance";

beforeAll(async () => {
  const response = await fetch(`${process.env.CATALOG_SERVICE_URL}/v1/data-products/${KNOWN_PRODUCT}`).catch(() => null);
  if (!response || !response.ok) {
    throw new Error(
      `data-product-catalog-service is not reachable/seeded at ${process.env.CATALOG_SERVICE_URL} — start it (data-product-catalog-service: docker compose up, or npm run dev) before running contract tests.`,
    );
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("catalog client contract (live data-product-catalog-service)", () => {
  it("accepts a registered ACTIVE product", async () => {
    const product = await getCatalogProduct(KNOWN_PRODUCT);
    expect(product.status).toBe("ACTIVE");
    expect(product.dataProductId).toBe(KNOWN_PRODUCT);
  });

  it("rejects an unknown product with PRODUCT_NOT_FOUND", async () => {
    await expect(getCatalogProduct("does-not-exist-product")).rejects.toMatchObject({ code: "PRODUCT_NOT_FOUND" });
  });

  it("resolves EXACT to the requested version even if not ACTIVE (DELIVER intent)", async () => {
    const resolved = await resolveVersionPolicy(KNOWN_PRODUCT, { type: "EXACT", value: "1.0.0" }, "DELIVER");
    expect(resolved.version).toBe("1.0.0");
  });

  it("resolves COMPATIBLE_MINOR to the highest ACTIVE version within that major, never crossing majors", async () => {
    const resolved = await resolveVersionPolicy(KNOWN_PRODUCT, { type: "COMPATIBLE_MINOR", value: "1" }, "SUBSCRIBE");
    expect(resolved.version).toBe("1.1.0"); // not 2.0.0 (different major, DRAFT anyway)
  });

  it("resolves LATEST_ACTIVE to the highest ACTIVE version across all majors", async () => {
    const resolved = await resolveVersionPolicy(KNOWN_PRODUCT, { type: "LATEST_ACTIVE", value: null }, "SUBSCRIBE");
    expect(resolved.version).toBe("1.1.0"); // 2.0.0 is DRAFT, not eligible
  });

  it("fails VERSION_POLICY_NOT_RESOLVABLE for a major with no ACTIVE version", async () => {
    await expect(resolveVersionPolicy(KNOWN_PRODUCT, { type: "COMPATIBLE_MINOR", value: "2" }, "SUBSCRIBE")).rejects.toMatchObject({
      code: "VERSION_POLICY_NOT_RESOLVABLE",
    });
  });

  it("accepts a supported delivery method + format", async () => {
    await expect(validateDeliveryCapability(KNOWN_PRODUCT, "1.1.0", "FILE", "PARQUET")).resolves.toBeUndefined();
  });

  it("rejects an unsupported delivery method", async () => {
    await expect(validateDeliveryCapability(KNOWN_PRODUCT, "1.1.0", "SFTP", null)).rejects.toMatchObject({
      code: "DELIVERY_METHOD_NOT_SUPPORTED",
    });
  });

  it("rejects an unsupported file format", async () => {
    await expect(validateDeliveryCapability(KNOWN_PRODUCT, "1.1.0", "FILE", "AVRO")).rejects.toMatchObject({
      code: "FILE_FORMAT_NOT_SUPPORTED",
    });
  });

  it("handles Catalog unavailability safely, never silently allowing", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("simulated network failure"));
    const error = await getCatalogProduct(KNOWN_PRODUCT).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CatalogUnavailableError);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("CATALOG_UNAVAILABLE");
  });
});
