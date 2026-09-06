import { z } from "zod";

export const createPublicationSchema = z.object({
  organizationId: z.string().min(1),
  tenantId: z.string().min(1),
  dataProductId: z.string().min(1),
  schemaVersion: z.string().min(1).optional(),
  sourceObject: z.string().min(1).optional(),
  filename: z.string().min(1),
});

export type CreatePublicationBody = z.infer<typeof createPublicationSchema>;
