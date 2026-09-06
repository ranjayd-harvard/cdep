"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSuperuserContext } from "@/lib/admin";
import { services } from "@/services";

/**
 * Admin Console only: runs data-lakehouse's Bronze ingestion for a single
 * exchange (the same logic `python -m lakehouse.ingestion.ingestion_runner
 * --exchange-id <id>` runs), then redirects back to the page with a flash
 * message so a pre-row-creation failure (e.g. the exchange isn't VALIDATED
 * yet) is visible even though no ingestion row exists to reflect it.
 */
export async function triggerIngestionAction(exchangeId: string): Promise<void> {
  await requireSuperuserContext();
  const result = await services.lakehouseAdmin.triggerIngestion(exchangeId);
  revalidatePath("/admin/lakehouse");

  const params = new URLSearchParams({ ranExchangeId: exchangeId, ranStatus: result.status });
  if (result.errorCode) params.set("ranErrorCode", result.errorCode);
  if (result.errorMessage) params.set("ranErrorMessage", result.errorMessage);
  redirect(`/admin/lakehouse?${params.toString()}`);
}

/**
 * Phase 3: runs Bronze->Silver for a completed ingestion, then redirects to
 * the Pipelines page (not back to /admin/lakehouse) so the result is shown
 * in the context of the pipeline-run history, whether triggered from the
 * ingestion table's own row or from the Pipelines page's manual form.
 */
export async function triggerBronzeToSilverAction(formData: FormData): Promise<void> {
  await requireSuperuserContext();
  const ingestionId = String(formData.get("ingestionId") ?? "").trim();
  const reprocess = formData.get("reprocess") === "on";
  if (!ingestionId) redirect("/admin/lakehouse/pipelines");

  const result = await services.lakehouseAdmin.triggerBronzeToSilver(ingestionId, reprocess);
  revalidatePath("/admin/lakehouse/pipelines");

  const outcome = result.outcomes[0];
  const params = new URLSearchParams({ ranKind: "bronze-to-silver" });
  if (outcome) {
    params.set("ranPipelineRunId", outcome.pipelineRunId);
    params.set("ranStatus", outcome.status);
  }
  if (result.errorCode) params.set("ranErrorCode", result.errorCode);
  if (result.errorMessage ?? outcome?.errorMessage) {
    params.set("ranErrorMessage", result.errorMessage ?? outcome?.errorMessage ?? "");
  }
  redirect(`/admin/lakehouse/pipelines?${params.toString()}`);
}

export async function triggerSilverToGoldAction(formData: FormData): Promise<void> {
  await requireSuperuserContext();
  const silverRunId = String(formData.get("silverRunId") ?? "").trim();
  const productId = String(formData.get("productId") ?? "").trim() || undefined;
  const reprocess = formData.get("reprocess") === "on";
  if (!silverRunId) redirect("/admin/lakehouse/pipelines");

  const result = await services.lakehouseAdmin.triggerSilverToGold(silverRunId, productId, reprocess);
  revalidatePath("/admin/lakehouse/pipelines");

  const params = new URLSearchParams({ ranKind: "silver-to-gold" });
  const outcome = result.outcomes[0];
  if (outcome) {
    params.set("ranPipelineRunId", outcome.pipelineRunId);
    params.set("ranStatus", outcome.status);
  }
  if (result.outcomes.length > 1) params.set("ranCount", String(result.outcomes.length));
  if (result.errorCode) params.set("ranErrorCode", result.errorCode);
  if (result.errorMessage ?? outcome?.errorMessage) {
    params.set("ranErrorMessage", result.errorMessage ?? outcome?.errorMessage ?? "");
  }
  redirect(`/admin/lakehouse/pipelines?${params.toString()}`);
}

/**
 * Phase 4: publishes a completed Gold pipeline run to an OUTBOUND exchange
 * via data-publication-service. Deliberately accepts only a Gold
 * pipeline_run_id (+ format/republish) -- organization_id/tenant_id can
 * never be supplied here, only ever resolved server-side from the trusted
 * GoldReady context that pipeline_run_id points to.
 */
export async function triggerPublishGoldProductAction(formData: FormData): Promise<void> {
  await requireSuperuserContext();
  const pipelineRunId = String(formData.get("pipelineRunId") ?? "").trim();
  const format = String(formData.get("format") ?? "").trim() || undefined;
  const republish = formData.get("republish") === "on";
  if (!pipelineRunId) redirect("/admin/lakehouse/pipelines");

  const result = await services.publicationAdmin.triggerPublish(pipelineRunId, format, republish);
  revalidatePath("/admin/lakehouse/pipelines");

  const params = new URLSearchParams({ ranKind: "publish" });
  if (result.publicationId) params.set("ranPublicationId", result.publicationId);
  if (result.status) params.set("ranStatus", result.status);
  if (result.errorCode) params.set("ranErrorCode", result.errorCode);
  if (result.errorMessage) params.set("ranErrorMessage", result.errorMessage);
  redirect(`/admin/lakehouse/pipelines?${params.toString()}`);
}
