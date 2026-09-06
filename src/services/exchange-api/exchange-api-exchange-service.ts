import { ExchangeDirection, ExchangeStatus, type Exchange, type ExchangeValidationError } from "@/models";
import type { ExchangeService } from "@/services/interfaces";
import type { TenantContext } from "@/lib/tenant";
import {
  ExchangeServiceError,
  getExchange as fetchExchangeDetail,
  getExchangeValidation,
  listExchanges,
  type ExchangeDetail,
} from "@/lib/exchange-service/client";
import { mapExchangeStatus } from "@/lib/exchange-service/status-mapping";

/**
 * data-exchange-service-backed `ExchangeService`. See
 * `docs/exchange-service-integration.md` for the full field-by-field
 * mapping this file implements and why (status collapsing, the
 * DataProduct/Dataset -> single data_products tier, the N+1 note below).
 */
export class ExchangeApiExchangeService implements ExchangeService {
  async getExchanges(context: TenantContext): Promise<Exchange[]> {
    const { items } = await listExchanges(context, { limit: 100 });

    // The list endpoint intentionally omits per-file detail (filename,
    // size) to stay cheap for large result sets — see that endpoint's
    // response shape in data-exchange-service's README. cdep's Exchange
    // list UI (`exchange-explorer.tsx`) renders `filename`, though, so
    // each summary is enriched with a detail call. Fine at demo/portal
    // scale (tens of exchanges per tenant); a batched "list with file
    // info" endpoint would remove this N+1 if exchange volume grows.
    const detailed = await Promise.all(
      items.map((item) => fetchExchangeDetail(context, item.exchangeId).catch(() => null)),
    );

    return detailed
      .filter((detail): detail is ExchangeDetail => detail !== null)
      .map((detail) => toExchange(context.tenantId, detail));
  }

  async getExchange(context: TenantContext, exchangeId: string): Promise<Exchange | null> {
    try {
      const detail = await fetchExchangeDetail(context, exchangeId);
      let validationErrors: ExchangeValidationError[] = [];

      if (detail.direction === "INBOUND" && mapExchangeStatus(detail.status) === ExchangeStatus.FAILED) {
        validationErrors = await getExchangeValidation(context, exchangeId)
          .then((v) => v.errors.map((e): ExchangeValidationError => ({ field: e.field, message: `Row ${e.row}: ${e.code}` })))
          .catch(() => []);
      }

      return toExchange(context.tenantId, detail, validationErrors);
    } catch (err) {
      // Cross-tenant / nonexistent exchanges come back as 404 from
      // data-exchange-service (see AGENTS.md there, section 47) — that's
      // exactly the `null` this interface expects, not an error to throw.
      if (err instanceof ExchangeServiceError && err.status === 404) return null;
      throw err;
    }
  }
}

function toExchange(tenantId: string, detail: ExchangeDetail, validationErrors: ExchangeValidationError[] = []): Exchange {
  const status = mapExchangeStatus(detail.status);
  return {
    id: detail.exchangeId,
    tenantId,
    datasetId: detail.dataProduct.id,
    direction: detail.direction === "OUTBOUND" ? ExchangeDirection.OUTBOUND : ExchangeDirection.INBOUND,
    status,
    filename: detail.file?.filename ?? "",
    fileSize: detail.file?.sizeBytes ?? 0,
    recordCount: detail.recordCount ?? 0,
    // cdep's Exchange has no "not yet received" concept; receivedAt falls
    // back to startedAt-equivalent data (there isn't one in the detail
    // response either) and finally "now" so the UI always has a sortable
    // date rather than an invalid one — see status-mapping.ts's doc
    // comment for the broader model-mismatch rationale.
    receivedAt: detail.receivedAt ?? detail.completedAt ?? new Date().toISOString(),
    completedAt: detail.completedAt,
    schemaVersion: detail.schemaVersion ?? "unknown",
    // data-exchange-service does not return correlationId on its exchange
    // detail response today; the exchangeId is a reasonable stand-in for
    // "some stable id to display" until that's added.
    correlationId: detail.exchangeId,
    errorCount: detail.errorCount ?? 0,
    validationErrors,
  };
}
