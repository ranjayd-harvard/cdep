import { ShieldAlert } from "lucide-react";

export interface UnauthorizedStateProps {
  title?: string;
  description?: string;
}

export function UnauthorizedState({
  title = "Access restricted",
  description = "You don't have permission to view this page.",
}: UnauthorizedStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-6 py-12 text-center"
    >
      <ShieldAlert className="h-8 w-8 text-amber-500" aria-hidden="true" />
      <p className="text-sm font-medium text-amber-900">{title}</p>
      <p className="max-w-sm text-sm text-amber-800">{description}</p>
    </div>
  );
}
