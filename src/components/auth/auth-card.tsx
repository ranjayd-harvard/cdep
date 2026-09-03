import type { ReactNode } from "react";
import { Database } from "lucide-react";
import { APP_CONFIG } from "@/config/app";

export function AuthCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-3 rounded-lg bg-slate-900 p-2.5">
            <Database className="h-6 w-6 text-white" aria-hidden="true" />
          </div>
          <h1 className="text-lg font-semibold text-slate-900">{APP_CONFIG.name}</h1>
          <p className="mt-1 text-sm text-slate-500">{APP_CONFIG.subtitle}</p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">{children}</div>
      </div>
    </div>
  );
}
