import type {
  CreateDownloadUrlInput,
  CreateUploadUrlInput,
  GetObjectOutput,
  HeadObjectOutput,
  PutObjectInput,
  SignedUrlResult,
} from "./storage.types.js";

// Storage-agnostic contract. Service-layer code depends only on this
// interface, never on the MinIO/S3 SDK directly — so a future Google Cloud
// Storage or Azure Blob adapter can be swapped in without touching
// modules/*. See AGENTS.md section 10.
export interface ObjectStorage {
  putObject(input: PutObjectInput): Promise<void>;
  getObject(bucket: string, key: string): Promise<GetObjectOutput>;
  headObject(bucket: string, key: string): Promise<HeadObjectOutput>;
  deleteObject(bucket: string, key: string): Promise<void>;

  createUploadUrl(input: CreateUploadUrlInput): Promise<SignedUrlResult>;
  createDownloadUrl(input: CreateDownloadUrlInput): Promise<SignedUrlResult>;
}
