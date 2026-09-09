import { DependencyError } from "../../common/errors/dependency-error.js";
import { env, publicationServiceEnabled } from "../../config/env.js";
import type { PublicationClient, PublicationTriggerOutcome, PublicationTriggerRequest } from "../../ports/publication-client.port.js";

interface PublicationOutcomeWire {
  publication_id: string;
  status: string;
  outbound_exchange_id: string | null;
  error_code: string | null;
  error_message: string | null;
}

interface ErrorEnvelope {
  detail?: { error_code?: string; message?: string };
}

// HTTP implementation of PublicationClient (AGENTS.md section 32-33, 52).
// POST /internal/v1/publications is synchronous — Publication Service
// blocks until the run reaches a terminal outcome (READY/FAILED) or
// short-circuits on `external_idempotency_key` (SKIPPED_DUPLICATE), so
// there is no separate "submitted vs completed" polling step to build here
// (AGENTS.md section 65's async-completion-tracking concern doesn't apply
// to this Publication Service's actual implementation).
export class PublicationHttpClient implements PublicationClient {
  async trigger(request: PublicationTriggerRequest): Promise<PublicationTriggerOutcome> {
    if (!publicationServiceEnabled) {
      throw new DependencyError("PUBLICATION_SERVICE_URL is not configured.", "PUBLICATION", false);
    }

    let response: Response;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), env.PUBLICATION_SERVICE_TIMEOUT_SECONDS * 1000);
      try {
        response = await fetch(`${env.PUBLICATION_SERVICE_URL}/internal/v1/publications`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "x-internal-api-key": env.PUBLICATION_SERVICE_INTERNAL_API_KEY,
          },
          body: JSON.stringify({
            organization_id: request.organizationId,
            tenant_id: request.tenantId,
            data_product_id: request.dataProductId,
            product_version: request.productVersion,
            format: request.format,
            external_idempotency_key: request.externalIdempotencyKey,
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      throw new DependencyError(`Publication Service request failed: ${(err as Error).message}`, "PUBLICATION", true);
    }

    const text = await response.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }

    if (response.status >= 500) {
      throw new DependencyError(`Publication Service returned ${response.status}.`, "PUBLICATION", true);
    }
    if (response.status === 404) {
      // GOLD_READY_NOT_FOUND — the Gold pipeline run this scope needs
      // hasn't completed yet. Treated as transient: it may well complete
      // shortly, and RetryCoordinator's max-attempts bound already caps
      // how long this can be retried before terminal failure / dead
      // lettering.
      const envelope = json as ErrorEnvelope | undefined;
      throw new DependencyError(
        envelope?.detail?.message ?? "Publication Service found no completed Gold pipeline run for this scope yet.",
        "PUBLICATION",
        true,
      );
    }
    if (!response.ok) {
      const envelope = json as ErrorEnvelope | undefined;
      throw new DependencyError(envelope?.detail?.message ?? `Publication Service returned ${response.status}.`, "PUBLICATION", false);
    }

    const outcome = json as PublicationOutcomeWire;
    return {
      publicationId: outcome.publication_id,
      status: outcome.status as PublicationTriggerOutcome["status"],
      outboundExchangeId: outcome.outbound_exchange_id,
      errorCode: outcome.error_code,
      errorMessage: outcome.error_message,
    };
  }
}
