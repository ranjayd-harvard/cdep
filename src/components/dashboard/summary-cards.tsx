import { Database, RefreshCw, CheckCircle2, XCircle } from "lucide-react";
import { MetricCard } from "@/components/ui";

export interface SummaryCardsProps {
  availableDataProducts: number;
  activeExchanges: number;
  completedThisMonth: number;
  failedExchanges: number;
}

export function SummaryCards({
  availableDataProducts,
  activeExchanges,
  completedThisMonth,
  failedExchanges,
}: SummaryCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <MetricCard label="Available Data Products" value={availableDataProducts} icon={Database} />
      <MetricCard label="Active Exchanges" value={activeExchanges} icon={RefreshCw} tone="warning" />
      <MetricCard
        label="Completed This Month"
        value={completedThisMonth}
        icon={CheckCircle2}
        tone="positive"
      />
      <MetricCard label="Failed Exchanges" value={failedExchanges} icon={XCircle} tone="negative" />
    </div>
  );
}
