import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type BadgeColor = "green" | "yellow" | "red" | "blue" | "gray";

const COLOR_CLASSES: Record<BadgeColor, string> = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  yellow: "bg-amber-50 text-amber-800 ring-amber-600/20",
  red: "bg-red-50 text-red-700 ring-red-600/20",
  blue: "bg-blue-50 text-blue-700 ring-blue-600/20",
  gray: "bg-slate-100 text-slate-700 ring-slate-500/20",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  color?: BadgeColor;
}

export function Badge({ className, color = "gray", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        COLOR_CLASSES[color],
        className,
      )}
      {...props}
    />
  );
}
