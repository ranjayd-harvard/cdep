import { CheckCircle2, XCircle, Circle, Loader2 } from "lucide-react";
import { ExchangeStatus, type Exchange } from "@/models";
import { cn } from "@/lib/utils";

type StageState = "complete" | "current" | "failed" | "pending";

const STAGES = ["Received", "Schema Validation", "Data Validation", "Processing", "Completed"] as const;

function resolveStageStates(exchange: Exchange): StageState[] {
  const failedAtValidation = exchange.status === ExchangeStatus.FAILED && exchange.errorCount > 0;

  switch (exchange.status) {
    case ExchangeStatus.RECEIVED:
      return ["current", "pending", "pending", "pending", "pending"];
    case ExchangeStatus.VALIDATING:
      return ["complete", "current", "current", "pending", "pending"];
    case ExchangeStatus.PROCESSING:
      return ["complete", "complete", "complete", "current", "pending"];
    case ExchangeStatus.COMPLETED:
      return ["complete", "complete", "complete", "complete", "complete"];
    case ExchangeStatus.FAILED:
      return failedAtValidation
        ? ["complete", "failed", "failed", "pending", "pending"]
        : ["complete", "complete", "complete", "failed", "pending"];
    default:
      return ["pending", "pending", "pending", "pending", "pending"];
  }
}

const ICONS: Record<StageState, typeof CheckCircle2> = {
  complete: CheckCircle2,
  current: Loader2,
  failed: XCircle,
  pending: Circle,
};

const COLORS: Record<StageState, string> = {
  complete: "text-emerald-600",
  current: "text-blue-600",
  failed: "text-red-600",
  pending: "text-slate-300",
};

export function ExchangeTimeline({ exchange }: { exchange: Exchange }) {
  const states = resolveStageStates(exchange);

  return (
    <ol className="flex flex-col gap-0 sm:flex-row sm:items-start sm:gap-0">
      {STAGES.map((stage, index) => {
        const state = states[index];
        const Icon = ICONS[state];
        const isLast = index === STAGES.length - 1;
        return (
          <li key={stage} className="flex flex-1 items-start gap-3 sm:flex-col sm:items-center sm:text-center">
            <div className="flex flex-col items-center sm:w-full">
              <Icon
                className={cn("h-6 w-6", COLORS[state], state === "current" && "animate-spin")}
                aria-hidden="true"
              />
              {!isLast ? (
                <div
                  className={cn(
                    "mt-1 h-8 w-px sm:mt-2 sm:h-px sm:w-full",
                    state === "complete" ? "bg-emerald-300" : "bg-slate-200",
                  )}
                />
              ) : null}
            </div>
            <p className={cn("text-xs font-medium sm:mt-2", COLORS[state])}>{stage}</p>
          </li>
        );
      })}
    </ol>
  );
}
