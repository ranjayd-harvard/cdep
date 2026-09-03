import { NotificationType, type Notification } from "@/models";

export const MOCK_NOTIFICATIONS: Notification[] = [
  { id: "notif-0001", type: NotificationType.EXCHANGE_FAILED, title: "Exchange failed", message: "Inbound exchange exch-0004 for Event Performance failed validation with 3 errors.", createdAt: "2026-08-28T06:03:10Z", read: false },
  { id: "notif-0002", type: NotificationType.EXCHANGE_COMPLETED, title: "Exchange completed", message: "Outbound exchange exch-0002 for Customer 360 completed successfully.", createdAt: "2026-08-29T06:22:00Z", read: false },
  { id: "notif-0003", type: NotificationType.NEW_DATASET_AVAILABLE, title: "New data product available", message: "Inventory Availability is now available for API access.", createdAt: "2026-08-25T10:00:00Z", read: true },
  { id: "notif-0004", type: NotificationType.DATASET_VERSION_CHANGED, title: "Dataset version changed", message: "Customer 360 was updated to version 3.2.0 with a new loyalty_tier field.", createdAt: "2026-07-14T09:00:00Z", read: true },
  { id: "notif-0005", type: NotificationType.MAINTENANCE, title: "Scheduled maintenance", message: "The Data Exchange Portal will undergo maintenance on 2026-09-05 from 02:00-04:00 UTC.", createdAt: "2026-08-27T15:00:00Z", read: false },
  { id: "notif-0006", type: NotificationType.EXCHANGE_FAILED, title: "Exchange failed", message: "Outbound exchange exch-0016 for Settlement Summary failed with 2 errors.", createdAt: "2026-08-17T12:03:00Z", read: true },
  { id: "notif-0007", type: NotificationType.EXCHANGE_COMPLETED, title: "Exchange completed", message: "Inbound exchange exch-0017 for Inventory Availability completed successfully.", createdAt: "2026-08-29T09:06:20Z", read: true },
  { id: "notif-0008", type: NotificationType.DATASET_VERSION_CHANGED, title: "Dataset version changed", message: "Event Performance was updated to version 2.4.1 with a gross_revenue rounding fix.", createdAt: "2026-08-05T08:00:00Z", read: true },
];
