import { CreateBucketCommand, HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "../src/config/env.js";
import { logger } from "../src/common/logger/logger.js";

const client = new S3Client({
  region: env.OBJECT_STORAGE_REGION,
  endpoint: env.OBJECT_STORAGE_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: env.OBJECT_STORAGE_ACCESS_KEY,
    secretAccessKey: env.OBJECT_STORAGE_SECRET_KEY,
  },
});

async function ensureBucket(bucket: string): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    logger.info({ bucket }, "Bucket already exists");
    return;
  } catch {
    // fall through to create
  }
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  logger.info({ bucket }, "Bucket created");
}

async function main() {
  // Separate buckets for inbound/outbound — never a single shared bucket
  // (AGENTS.md section 11).
  await ensureBucket(env.INBOUND_BUCKET);
  await ensureBucket(env.OUTBOUND_BUCKET);
}

main().catch((err) => {
  logger.error({ err }, "Bucket initialization failed");
  process.exit(1);
});
