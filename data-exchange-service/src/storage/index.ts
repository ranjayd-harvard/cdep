import { S3ObjectStorage } from "./s3-storage.adapter.js";
import type { ObjectStorage } from "./storage.interface.js";

export const objectStorage: ObjectStorage = new S3ObjectStorage();
export type { ObjectStorage } from "./storage.interface.js";
