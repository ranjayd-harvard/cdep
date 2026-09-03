export interface PlatformSettings {
  allowSelfServeSignup: boolean;
  supportEmail: string;
}

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  allowSelfServeSignup: true,
  supportEmail: "",
};
