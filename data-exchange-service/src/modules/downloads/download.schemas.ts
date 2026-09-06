import { z } from "zod";

export const downloadUrlParamsSchema = z.object({
  exchangeId: z.string().min(1),
});
