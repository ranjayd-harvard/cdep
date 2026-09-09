import type {
  ApiAccessService,
  DataProductService,
  DatasetService,
  EntitlementService,
  LakehouseAdminService,
  OrganizationInvitationService,
  OrganizationMembershipService,
  OrganizationService,
  PipelineJobAdminService,
  PlatformSettingsService,
  PublicationAdminService,
  TenantService,
} from "@/services/interfaces";
import type { ClientServiceRegistry } from "@/services/client";
import { env } from "@/config/env";
import {
  MongoApiAccessService,
  MongoDataProductService,
  MongoDatasetService,
  MongoDownloadService,
  MongoEntitlementService,
  MongoExchangeService,
  MongoNotificationService,
  MongoOrganizationInvitationService,
  MongoOrganizationMembershipService,
  MongoOrganizationService,
  MongoPlatformSettingsService,
  MongoTenantService,
  MongoUploadService,
} from "@/services/mongo";
import {
  ExchangeApiDownloadService,
  ExchangeApiExchangeService,
  ExchangeApiUploadService,
} from "@/services/exchange-api";
import { LakehouseAdminApiService, UnavailableLakehouseAdminService } from "@/services/lakehouse-admin";
import { PublicationAdminApiService, UnavailablePublicationAdminService } from "@/services/publication-admin";
import { PipelineJobAdminApiService, UnavailablePipelineJobAdminService } from "@/services/pipeline-job-admin";

export interface ServiceRegistry extends ClientServiceRegistry {
  organizations: OrganizationService;
  tenants: TenantService;
  organizationMemberships: OrganizationMembershipService;
  organizationInvitations: OrganizationInvitationService;
  dataProducts: DataProductService;
  datasets: DatasetService;
  entitlements: EntitlementService;
  platformSettings: PlatformSettingsService;
  apiAccess: ApiAccessService;
  lakehouseAdmin: LakehouseAdminService;
  publicationAdmin: PublicationAdminService;
  pipelineJobAdmin: PipelineJobAdminService;
}

/**
 * The full service registry — Server Components and route handlers only.
 * Every field is now wired to a Mongo-backed implementation
 * unconditionally, the same way `src/lib/user-directory.ts` bypasses the
 * mock/HTTP toggle for identity. `organizations`/`tenants`/
 * `organizationMemberships`/`organizationInvitations`/`dataProducts`/
 * `datasets`/`entitlements`/`apiAccess` were real from day one (the
 * Organization -> Tenant -> Entitlement -> DataProduct -> Dataset chain
 * is the tenant isolation boundary, not swappable UI fixture data).
 * `exchanges`/`downloads`/`uploads`/`notifications` joined them once real
 * file storage and persistence existed to back them.
 *
 * This does NOT mean `NEXT_PUBLIC_USE_MOCK_SERVICES` is irrelevant now —
 * it still governs `clientServices` (`src/services/client.ts`), the
 * separate registry every "use client" component uses. Mongo can't ship
 * to a browser bundle, so the interactive, client-triggered parts of
 * Uploads/Downloads/Notifications (submitting a file, minting a download
 * link, marking a notification read) go through `clientServices` ->
 * mock or HTTP -> the `/api/uploads`, `/api/downloads/*`,
 * `/api/notifications/*` route handlers, which import *this* registry.
 * Until `NEXT_PUBLIC_USE_MOCK_SERVICES=false`, Server Component reads
 * (e.g. `/exchanges`, the Downloads list) are already real, but those
 * client-triggered actions still run against in-memory mocks — an
 * intentional, documented half-real state until the flag flips.
 *
 * Never import this module from a "use client" component — the Mongo
 * implementations depend on Node built-ins the browser bundle can't
 * resolve. A "use client" file should import `clientServices` from
 * `@/services/client` instead.
 *
 * `exchanges`/`downloads`/`uploads` have a second real backend as of the
 * data-exchange-service integration: when `EXCHANGE_SERVICE_URL` is set,
 * `ExchangeApi*Service` (`@/services/exchange-api`) replaces the Mongo
 * ones for those three fields — real Postgres-backed exchange rows,
 * real MinIO-backed file storage, signed upload/download URLs, and
 * server-side validation, instead of GridFS + an in-memory echo. This is
 * an opt-in, non-breaking switch: leaving `EXCHANGE_SERVICE_URL` unset
 * keeps every existing dev setup working exactly as before. See
 * `docs/exchange-service-integration.md` for the full picture, including
 * why `datasets`/`entitlements`/`dataProducts` deliberately stay
 * Mongo-backed (this service is not the catalog of record).
 */
function createServices(): ServiceRegistry {
  return {
    organizations: new MongoOrganizationService(),
    tenants: new MongoTenantService(),
    organizationMemberships: new MongoOrganizationMembershipService(),
    organizationInvitations: new MongoOrganizationInvitationService(),
    dataProducts: new MongoDataProductService(),
    datasets: new MongoDatasetService(),
    entitlements: new MongoEntitlementService(),
    platformSettings: new MongoPlatformSettingsService(),
    apiAccess: new MongoApiAccessService(),
    exchanges: env.exchangeServiceEnabled ? new ExchangeApiExchangeService() : new MongoExchangeService(),
    downloads: env.exchangeServiceEnabled ? new ExchangeApiDownloadService() : new MongoDownloadService(),
    uploads: env.exchangeServiceEnabled ? new ExchangeApiUploadService() : new MongoUploadService(),
    notifications: new MongoNotificationService(),
    lakehouseAdmin:
      env.exchangeServiceEnabled && env.lakehouseServiceEnabled
        ? new LakehouseAdminApiService()
        : new UnavailableLakehouseAdminService(),
    publicationAdmin: env.publicationServiceEnabled
      ? new PublicationAdminApiService()
      : new UnavailablePublicationAdminService(),
    pipelineJobAdmin: env.exchangeServiceEnabled
      ? new PipelineJobAdminApiService()
      : new UnavailablePipelineJobAdminService(),
  };
}

export const services: ServiceRegistry = createServices();

export type {
  ApiAccessService,
  DataProductService,
  DatasetService,
  DownloadService,
  EntitlementService,
  ExchangeService,
  LakehouseAdminService,
  NotificationService,
  OrganizationInvitationService,
  OrganizationMembershipService,
  OrganizationService,
  PipelineJobAdminService,
  PlatformSettingsService,
  PublicationAdminService,
  TenantService,
  UploadService,
} from "@/services/interfaces";
export { clientServices, type ClientServiceRegistry } from "@/services/client";
