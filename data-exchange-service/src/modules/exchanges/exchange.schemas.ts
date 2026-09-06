import { z } from "zod";
import { EXCHANGE_DIRECTIONS, EXCHANGE_STATUSES } from "../../config/constants.js";

export const listExchangesQuerySchema = z.object({
  direction: z.enum(EXCHANGE_DIRECTIONS).optional(),
  status: z.enum(EXCHANGE_STATUSES).optional(),
  dataProductId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type ListExchangesQuery = z.infer<typeof listExchangesQuerySchema>;

// Cross-tenant (superadmin portal) equivalent of listExchangesQuerySchema
// above -- no status/dataProductId/date-range/cursor, this only ever backs
// a "recent exchanges" admin view.
export const listExchangesInternalQuerySchema = z.object({
  direction: z.enum(EXCHANGE_DIRECTIONS).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export type ListExchangesInternalQuery = z.infer<typeof listExchangesInternalQuerySchema>;

export const exchangeIdParamSchema = z.object({
  exchangeId: z.string().min(1),
});
