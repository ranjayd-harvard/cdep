import { GridFSBucket, ObjectId } from "mongodb";
import { Readable } from "node:stream";
import { getDb } from "@/lib/mongodb";

/**
 * Raw file bytes (uploads, and the generated files made available for
 * download) live in GridFS rather than local disk — the `portal`
 * container has no persistent volume (see `docker-compose.yml`; only
 * `mongo` does), so anything written to disk would vanish on the next
 * rebuild/redeploy. GridFS rides along in the same already-persisted
 * Mongo volume, with no new dependency (`GridFSBucket` ships in the
 * `mongodb` driver already installed).
 *
 * Unlike `TenantScopedCollection`, GridFS has no structural tenant
 * isolation of its own — `openDownloadStream` will happily stream any id
 * you hand it. Every caller MUST resolve a storage id through a
 * tenant-scoped directory lookup first (`exchange-directory.ts`,
 * `download-directory.ts`) and never accept one directly from a client
 * request.
 */
async function getBucket(): Promise<GridFSBucket> {
  const db = await getDb();
  return new GridFSBucket(db, { bucketName: "files" });
}

export async function storeFile(filename: string, contentType: string, data: Buffer): Promise<string> {
  const bucket = await getBucket();
  const id = new ObjectId();

  await new Promise<void>((resolve, reject) => {
    const uploadStream = bucket.openUploadStreamWithId(id, filename, { metadata: { contentType } });
    Readable.from(data)
      .pipe(uploadStream)
      .on("finish", () => resolve())
      .on("error", reject);
  });

  return id.toHexString();
}

export async function openDownloadStream(storageFileId: string): Promise<Readable> {
  const bucket = await getBucket();
  return bucket.openDownloadStream(new ObjectId(storageFileId));
}
