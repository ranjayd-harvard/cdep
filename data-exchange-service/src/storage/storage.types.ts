export interface PutObjectInput {
  bucket: string;
  key: string;
  body: Buffer | string;
  contentType?: string;
}

export interface GetObjectOutput {
  body: Buffer;
  contentType?: string;
  contentLength: number;
}

export interface HeadObjectOutput {
  exists: boolean;
  contentLength?: number;
  contentType?: string;
  etag?: string;
  lastModified?: Date;
}

export interface CreateUploadUrlInput {
  bucket: string;
  key: string;
  contentType?: string;
  expiresInSeconds: number;
}

export interface CreateDownloadUrlInput {
  bucket: string;
  key: string;
  expiresInSeconds: number;
  downloadFilename?: string;
}

export interface SignedUrlResult {
  url: string;
  method: "PUT" | "GET";
  expiresInSeconds: number;
}
