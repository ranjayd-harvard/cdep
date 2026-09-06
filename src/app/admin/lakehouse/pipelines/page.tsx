import { Layers } from "lucide-react";
import { requireSuperuserContext } from "@/lib/admin";
import { services } from "@/services";
import { PageHeader, Card, CardHeader, CardTitle, CardContent, EmptyState, Input, Select, Button } from "@/components/ui";
import { LakehouseSubNav } from "../lakehouse-sub-nav";
import { triggerBronzeToSilverAction, triggerPublishGoldProductAction, triggerSilverToGoldAction } from "../actions";
import { PipelineRunsTable } from "./pipeline-runs-table";
import { PublicationRunsTable } from "./publication-runs-table";

export default async function AdminLakehousePipelinesPage({
  searchParams,
}: {
  searchParams: Promise<{
    ranKind?: string;
    ranPipelineRunId?: string;
    ranPublicationId?: string;
    ranStatus?: string;
    ranErrorCode?: string;
    ranErrorMessage?: string;
    ranCount?: string;
  }>;
}) {
  await requireSuperuserContext();

  const { ranKind, ranPipelineRunId, ranPublicationId, ranStatus, ranErrorCode, ranErrorMessage, ranCount } =
    await searchParams;
  const { available, items } = await services.lakehouseAdmin.listPipelineRuns({ limit: 100 });
  const { available: publicationAvailable, items: publicationItems } =
    await services.publicationAdmin.listPublications(100);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Lakehouse Pipelines"
        description="Phase 3: Bronze → Silver → Gold transformation pipeline runs."
      />

      <LakehouseSubNav active="/admin/lakehouse/pipelines" />

      {ranPipelineRunId || ranPublicationId || ranErrorMessage ? (
        <Card className={ranErrorCode ? "border-red-200 bg-red-50" : "border-green-200 bg-green-50"}>
          <CardContent className="flex flex-wrap items-center gap-2 py-3 text-sm">
            <span className="font-medium">
              {ranKind === "publish"
                ? "Publish Gold Product"
                : ranKind === "silver-to-gold"
                  ? "Silver → Gold"
                  : "Bronze → Silver"}
              {ranCount ? ` (${ranCount} products)` : ""}:
            </span>
            {ranPipelineRunId ? (
              <a
                href={`/admin/lakehouse/pipelines/${ranPipelineRunId}`}
                className="font-mono underline underline-offset-2"
              >
                {ranPipelineRunId}
              </a>
            ) : ranPublicationId ? (
              <span className="font-mono">{ranPublicationId}</span>
            ) : null}
            <span className="font-semibold">{ranStatus}</span>
            {ranErrorMessage ? <span>— {ranErrorMessage}</span> : null}
          </CardContent>
        </Card>
      ) : null}

      {!available ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Layers}
              title="Lakehouse integration not configured"
              description="Set LAKEHOUSE_SERVICE_URL to enable this page."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Run Bronze → Silver</CardTitle>
              </CardHeader>
              <CardContent>
                <form action={triggerBronzeToSilverAction} className="flex flex-col gap-3">
                  <Input
                    name="ingestionId"
                    placeholder="ingestion_id (e.g. ing-01a0705cd9307fd198bbd87f839e952d)"
                    required
                  />
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input type="checkbox" name="reprocess" className="rounded border-slate-300" />
                    Force reprocess (new run even if already processed)
                  </label>
                  <Button type="submit" size="sm">
                    Run Bronze → Silver
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Run Silver → Gold</CardTitle>
              </CardHeader>
              <CardContent>
                <form action={triggerSilverToGoldAction} className="flex flex-col gap-3">
                  <Input
                    name="silverRunId"
                    placeholder="Silver pipeline_run_id (e.g. run-...)"
                    required
                  />
                  <Input
                    name="productId"
                    placeholder="Gold product id (optional — defaults to all registered)"
                  />
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input type="checkbox" name="reprocess" className="rounded border-slate-300" />
                    Force reprocess (new run even if already processed)
                  </label>
                  <Button type="submit" size="sm">
                    Run Silver → Gold
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>

          <PipelineRunsTable items={items} />
        </>
      )}

      {!publicationAvailable ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Layers}
              title="Publication Service integration not configured"
              description="Set PUBLICATION_SERVICE_URL to enable publishing Gold Data Products."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Publish Gold Product</CardTitle>
            </CardHeader>
            <CardContent>
              <form action={triggerPublishGoldProductAction} className="flex flex-col gap-3">
                <Input
                  name="pipelineRunId"
                  placeholder="Gold pipeline_run_id (e.g. run-...)"
                  required
                />
                <Select
                  name="format"
                  defaultValue=""
                  options={[
                    { value: "", label: "Default format (contract's defaultFormat)" },
                    { value: "PARQUET", label: "PARQUET" },
                    { value: "CSV", label: "CSV" },
                  ]}
                />
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" name="republish" className="rounded border-slate-300" />
                  Force republish (new publication even if this snapshot was already published)
                </label>
                <Button type="submit" size="sm">
                  Publish to Outbound Exchange
                </Button>
              </form>
            </CardContent>
          </Card>

          <PublicationRunsTable items={publicationItems} />
        </>
      )}
    </div>
  );
}
