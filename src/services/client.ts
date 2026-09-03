import { env } from "@/config/env";
import type { DownloadService, ExchangeService, NotificationService, UploadService } from "@/services/interfaces";
import { MockDownloadService, MockExchangeService, MockNotificationService, MockUploadService } from "@/services/mocks";
import { HttpDownloadService, HttpExchangeService, HttpNotificationService, HttpUploadService } from "@/services/http";

export interface ClientServiceRegistry {
  exchanges: ExchangeService;
  uploads: UploadService;
  downloads: DownloadService;
  notifications: NotificationService;
}

/**
 * The subset of `ServiceRegistry` safe to import from a "use client"
 * component. Deliberately excludes Organization/Tenant/DataProduct/Dataset/
 * Entitlement: their Mongo-backed implementations (`src/services/mongo`)
 * pull in the `mongodb` driver, which depends on Node built-ins (`tls`,
 * `timers/promises`) that don't exist in a browser bundle. A component
 * that needs tenant or catalog data must fetch it in a Server Component
 * and pass it down as props — never import `@/services` (the full
 * registry) from a "use client" file.
 */
export function createClientServices(): ClientServiceRegistry {
  if (env.useMockServices) {
    return {
      exchanges: new MockExchangeService(),
      uploads: new MockUploadService(),
      downloads: new MockDownloadService(),
      notifications: new MockNotificationService(),
    };
  }

  return {
    exchanges: new HttpExchangeService(),
    uploads: new HttpUploadService(),
    downloads: new HttpDownloadService(),
    notifications: new HttpNotificationService(),
  };
}

export const clientServices: ClientServiceRegistry = createClientServices();
