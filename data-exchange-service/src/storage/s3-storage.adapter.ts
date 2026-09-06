import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env.js";
import type { ObjectStorage } from "./storage.interface.js";
import type {
  CreateDownloadUrlInput,
  CreateUploadUrlInput,
  GetObjectOutput,
  HeadObjectOutput,
  PutObjectInput,
  SignedUrlResult,
} from "./storage.types.js";

function buildClient(endpoint: string): S3Client {
  const config: S3ClientConfig = {
    region: env.OBJECT_STORAGE_REGION,
    endpoint,
    forcePathStyle: true, // required for MinIO / most non-AWS S3-compatible stores
    credentials: {
      accessKeyId: env.OBJECT_STORAGE_ACCESS_KEY,
      secretAccessKey: env.OBJECT_STORAGE_SECRET_KEY,
    },
  };
  return new S3Client(config);
}

async function streamToBuffer(stream: unknown): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export class S3ObjectStorage implements ObjectStorage {
  // Used for server-side operations (put/get/head/delete) reached over the
  // internal network path (e.g. "minio:9000" inside docker-compose).
  private readonly client: S3Client;

  // Used only to *sign* URLs handed to external clients (browsers). Must be
  // built against an endpoint the external client can actually reach (e.g.
  // "localhost:9000" from the host machine) — see OBJECT_STORAGE_PUBLIC_ENDPOINT.
  private readonly presigningClient: S3Client;

  constructor() {
    this.client = buildClient(env.OBJECT_STORAGE_ENDPOINT);
    this.presigningClient = buildClient(env.OBJECT_STORAGE_PUBLIC_ENDPOINT ?? env.OBJECT_STORAGE_ENDPOINT);
  }

  async putObject({ bucket, key, body, contentType }: PutObjectInput): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async getObject(bucket: string, key: string): Promise<GetObjectOutput> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = await streamToBuffer(result.Body);
    return {
      body,
      contentType: result.ContentType,
      contentLength: result.ContentLength ?? body.length,
    };
  }

  async headObject(bucket: string, key: string): Promise<HeadObjectOutput> {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return {
        exists: true,
        contentLength: result.ContentLength,
        contentType: result.ContentType,
        etag: result.ETag,
        lastModified: result.LastModified,
      };
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === "NotFound" || name === "NoSuchKey") {
        return { exists: false };
      }
      throw err;
    }
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  async createUploadUrl({ bucket, key, contentType, expiresInSeconds }: CreateUploadUrlInput): Promise<SignedUrlResult> {
    const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType });
    const url = await getSignedUrl(this.presigningClient, command, { expiresIn: expiresInSeconds });
    return { url, method: "PUT", expiresInSeconds };
  }

  async createDownloadUrl({ bucket, key, expiresInSeconds, downloadFilename }: CreateDownloadUrlInput): Promise<SignedUrlResult> {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentDisposition: downloadFilename ? `attachment; filename="${downloadFilename}"` : undefined,
    });
    const url = await getSignedUrl(this.presigningClient, command, { expiresIn: expiresInSeconds });
    return { url, method: "GET", expiresInSeconds };
  }
}
