import type { SelectOption } from "@/components/ui";
import { DatasetAccessMethod } from "@/models";

export const DATASET_STATUS_OPTIONS: SelectOption[] = [
  { label: "Active", value: "ACTIVE" },
  { label: "Deprecated", value: "DEPRECATED" },
  { label: "Coming Soon", value: "COMING_SOON" },
];

export const ACCESS_METHOD_OPTIONS: DatasetAccessMethod[] = [
  DatasetAccessMethod.API,
  DatasetAccessMethod.DOWNLOAD,
  DatasetAccessMethod.SFTP,
  DatasetAccessMethod.DATA_SHARE,
];
