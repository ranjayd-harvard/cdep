export const NotificationType = {
  EXCHANGE_COMPLETED: "EXCHANGE_COMPLETED",
  EXCHANGE_FAILED: "EXCHANGE_FAILED",
  NEW_DATASET_AVAILABLE: "NEW_DATASET_AVAILABLE",
  DATASET_VERSION_CHANGED: "DATASET_VERSION_CHANGED",
  MAINTENANCE: "MAINTENANCE",
} as const;

export type NotificationType =
  (typeof NotificationType)[keyof typeof NotificationType];

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
}
