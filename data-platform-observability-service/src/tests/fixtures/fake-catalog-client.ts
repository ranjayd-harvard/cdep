import type {
  CatalogClient,
  CatalogMigrationSummary,
  CatalogVersionDetail,
  CatalogVersionSummary,
} from "../../ports/catalog-client.port.js";

// Stands in for data-product-catalog-service in tests — mirrors
// subscription-service's contract-test fixture-server pattern, but as a
// plain in-memory fake since CatalogClient is a simple read-only port.
export class FakeCatalogClient implements CatalogClient {
  private detail: CatalogVersionDetail | null = null;
  private versions: CatalogVersionSummary[] = [];
  private migrations: CatalogMigrationSummary[] = [];

  setVersionDetail(detail: CatalogVersionDetail | null): void {
    this.detail = detail;
  }

  setVersions(versions: CatalogVersionSummary[]): void {
    this.versions = versions;
  }

  setMigrations(migrations: CatalogMigrationSummary[]): void {
    this.migrations = migrations;
  }

  async getVersionDetail(): Promise<CatalogVersionDetail | null> {
    return this.detail;
  }

  async listVersions(): Promise<CatalogVersionSummary[]> {
    return this.versions;
  }

  async listMigrations(): Promise<CatalogMigrationSummary[]> {
    return this.migrations;
  }
}
