import type {
  ApiAccessService,
  DataProductService,
  DatasetService,
  EntitlementService,
  OrganizationInvitationService,
  OrganizationMembershipService,
  OrganizationService,
  PlatformSettingsService,
  TenantService,
} from "@/services/interfaces";
import type { ClientServiceRegistry } from "@/services/client";
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
    exchanges: new MongoExchangeService(),
    downloads: new MongoDownloadService(),
    uploads: new MongoUploadService(),
    notifications: new MongoNotificationService(),
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
  NotificationService,
  OrganizationInvitationService,
  OrganizationMembershipService,
  OrganizationService,
  PlatformSettingsService,
  TenantService,
  UploadService,
} from "@/services/interfaces";
export { clientServices, type ClientServiceRegistry } from "@/services/client";
