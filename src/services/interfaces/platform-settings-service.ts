import type { PlatformSettings } from "@/models";

export interface PlatformSettingsService {
  getSettings(): Promise<PlatformSettings>;
  updateSettings(patch: Partial<PlatformSettings>): Promise<void>;
}
