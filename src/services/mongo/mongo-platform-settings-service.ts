import type { PlatformSettings } from "@/models";
import type { PlatformSettingsService } from "@/services/interfaces";
import { getPlatformSettings, updatePlatformSettings } from "@/lib/platform-settings-directory";

export class MongoPlatformSettingsService implements PlatformSettingsService {
  getSettings(): Promise<PlatformSettings> {
    return getPlatformSettings();
  }

  updateSettings(patch: Partial<PlatformSettings>): Promise<void> {
    return updatePlatformSettings(patch);
  }
}
