import { Button, StatusBadge } from "@/components/ui";
import type { ExecutionDTO, ScheduleStatusDTO } from "@/lib/scheduling-service/client";
import { formatDateTime } from "@/lib/utils";
import { publishNow } from "./schedule-actions";

function formatReason(reason: ExecutionDTO["reason"]): string {
  switch (reason) {
    case "SCHEDULED":
      return "Scheduled";
    case "MANUAL":
      return "Manual (operator)";
    case "ON_DEMAND":
      return "On-demand";
    case "MISSED_RUN_RECOVERY":
      return "Missed-run recovery";
    case "RETRY":
      return "Retry";
  }
}

// Phase 7 — scheduling-service's view of this subscription: when the next
// automatic run is due, the outcome of the last attempt, and a short
// history. "Publish now" bypasses the schedule but runs through the exact
// same eligibility pipeline (see scheduling-service's ManualTriggerService)
// — never a shortcut straight to Publication Service.
export function SchedulePanel({
  subscriptionId,
  status,
  executions,
  canManage,
}: {
  subscriptionId: string;
  status: ScheduleStatusDTO;
  executions: ExecutionDTO[];
  canManage: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-slate-200 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-900">Scheduling</span>
        {canManage ? (
          <form action={publishNow.bind(null, subscriptionId)}>
            <Button type="submit" size="sm" variant="secondary">
              Publish now
            </Button>
          </form>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 gap-2 text-xs text-slate-600">
        <div>
          <dt className="text-slate-400">Next scheduled run</dt>
          <dd className="font-medium text-slate-800">
            {status.next_scheduled_run ? formatDateTime(status.next_scheduled_run) : "Not scheduled (manual only)"}
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">Last execution</dt>
          <dd className="font-medium text-slate-800">
            {status.last_execution ? <StatusBadge status={status.last_execution.status} /> : "—"}
          </dd>
        </div>
      </dl>

      {executions.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Recent executions</span>
          <ul className="flex flex-col gap-1">
            {executions.map((execution) => (
              <li key={execution.execution_id} className="flex items-center justify-between gap-2 rounded bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
                <span>
                  {formatDateTime(execution.scheduled_for)} — {formatReason(execution.reason)}
                  {execution.resolved_product_version ? ` — v${execution.resolved_product_version}` : ""}
                </span>
                <StatusBadge status={execution.status} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
