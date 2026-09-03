import {
  CheckCircle2,
  XCircle,
  Sparkles,
  GitBranch,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { NotificationType } from "@/models";
import type { BadgeColor } from "@/components/ui/badge";

export const NOTIFICATION_META: Record<
  NotificationType,
  { icon: LucideIcon; color: BadgeColor; label: string }
> = {
  [NotificationType.EXCHANGE_COMPLETED]: { icon: CheckCircle2, color: "green", label: "Exchange Completed" },
  [NotificationType.EXCHANGE_FAILED]: { icon: XCircle, color: "red", label: "Exchange Failed" },
  [NotificationType.NEW_DATASET_AVAILABLE]: { icon: Sparkles, color: "blue", label: "New Dataset Available" },
  [NotificationType.DATASET_VERSION_CHANGED]: { icon: GitBranch, color: "blue", label: "Dataset Version Changed" },
  [NotificationType.MAINTENANCE]: { icon: Wrench, color: "gray", label: "Maintenance" },
};
