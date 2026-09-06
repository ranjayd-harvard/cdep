import type { ZodSchema } from "zod";
import { AppError } from "../errors/app-error.js";

export function parseOrThrow<T>(schema: ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const message = result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new AppError("VALIDATION_ERROR", message);
  }
  return result.data;
}
