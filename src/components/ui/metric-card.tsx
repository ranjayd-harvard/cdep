import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "./card";
import { cn } from "@/lib/utils";

export interface MetricCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  tone?: "default" | "positive" | "warning" | "negative";
}

const TONE_CLASSES: Record<NonNullable<MetricCardProps["tone"]>, string> = {
  default: "text-slate-900",
  positive: "text-emerald-600",
  warning: "text-amber-600",
  negative: "text-red-600",
};

export function MetricCard({ label, value, icon: Icon, tone = "default" }: MetricCardProps) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-500">{label}</p>
          <p className={cn("mt-1 text-2xl font-semibold", TONE_CLASSES[tone])}>{value}</p>
        </div>
        {Icon ? (
          <div className="rounded-md bg-slate-50 p-2.5">
            <Icon className="h-5 w-5 text-slate-500" aria-hidden="true" />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
