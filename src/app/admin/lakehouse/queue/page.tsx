import { Layers } from "lucide-react";
import { requireSuperuserContext } from "@/lib/admin";
import { services } from "@/services";
import { PageHeader, Card, CardContent, EmptyState } from "@/components/ui";
import { LakehouseSubNav } from "../lakehouse-sub-nav";
import { QueueTable } from "./queue-table";

export default async function AdminLakehouseQueuePage({
  searchParams,
}: {
  searchParams: Promise<{
    ranJobId?: string;
    ranStatus?: string;
    ranErrorCode?: string;
    ranErrorMessage?: string;
  }>;
}) {
  await requireSuperuserContext();

  const { ranJobId, ranStatus, ranErrorCode, ranErrorMessage } = await searchParams;
  const { available, items } = await services.pipelineJobAdmin.listPipelineJobs({ limit: 200 });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Pipeline Queue"
        description="The Ingest -> Bronze -> Silver -> Gold -> Publish job queue (exchange.pipeline_jobs) — enqueued automatically on upload when DEMO_FIXTURE_PUBLISH_ENABLED=false, and picked up by data-exchange-service's own worker on its poll interval. Use Run / Re-enqueue below instead of waiting for the next tick or triggering each stage by hand."
      />

      <LakehouseSubNav active="/admin/lakehouse/queue" />

      {ranJobId ? (
        <Card className={ranErrorCode ? "border-red-200 bg-red-50" : "border-green-200 bg-green-50"}>
          <CardContent className="flex items-center justify-between gap-4 py-3 text-sm">
            <span>
              Job <span className="font-mono">{ranJobId}</span>:{" "}
              <span className="font-semibold">{ranStatus}</span>
              {ranErrorMessage ? ` — ${ranErrorMessage}` : null}
            </span>
          </CardContent>
        </Card>
      ) : null}

      {!available ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Layers}
              title="Exchange service integration not configured"
              description="Set EXCHANGE_SERVICE_URL to enable this page."
            />
          </CardContent>
        </Card>
      ) : (
        <QueueTable items={items} />
      )}
    </div>
  );
}
