import { getDb } from "@/lib/mongodb";
import { DEFAULT_PLATFORM_SETTINGS, type PlatformSettings } from "@/models";

const SETTINGS_DOC_ID = "platform";

interface PlatformSettingsDocument extends PlatformSettings {
  _id: string;
}

/**
 * The platform-wide settings singleton, managed from the Admin Console
 * (`src/app/admin/settings`). Returns the defaults when the document
 * doesn't exist yet, so no seed/migration step is required.
 */
export async function getPlatformSettings(): Promise<PlatformSettings> {
  const db = await getDb();
  const doc = await db.collection<PlatformSettingsDocument>("platformSettings").findOne({ _id: SETTINGS_DOC_ID });
  if (!doc) {
    return DEFAULT_PLATFORM_SETTINGS;
  }
  return { allowSelfServeSignup: doc.allowSelfServeSignup, supportEmail: doc.supportEmail };
}

export async function updatePlatformSettings(patch: Partial<PlatformSettings>): Promise<void> {
  const db = await getDb();

  // A field can't appear in both $set and $setOnInsert on the same
  // upsert (Mongo rejects that as a write conflict), so the "fill in the
  // rest with defaults" half only includes keys `patch` doesn't already
  // cover.
  const setOnInsert: Record<string, unknown> = { _id: SETTINGS_DOC_ID };
  for (const [key, value] of Object.entries(DEFAULT_PLATFORM_SETTINGS)) {
    if (!(key in patch)) {
      setOnInsert[key] = value;
    }
  }

  await db
    .collection<PlatformSettingsDocument>("platformSettings")
    .updateOne({ _id: SETTINGS_DOC_ID }, { $set: patch, $setOnInsert: setOnInsert }, { upsert: true });
}
