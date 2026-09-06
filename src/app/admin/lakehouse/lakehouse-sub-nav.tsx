import Link from "next/link";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/admin/lakehouse", label: "Bronze Ingestion" },
  { href: "/admin/lakehouse/pipelines", label: "Pipelines (Silver/Gold)" },
  { href: "/admin/lakehouse/data-products", label: "Data Products (Gold)" },
] as const;

/**
 * Shared sub-navigation across the three /admin/lakehouse* pages — Phase 2
 * Bronze ingestion and Phase 3 pipelines/data-products live under one
 * ADMIN_NAV entry (`Lakehouse Ingestion`), so this is what lets a superuser
 * move between them without going back through the sidebar.
 */
export function LakehouseSubNav({ active }: { active: (typeof LINKS)[number]["href"] }) {
  return (
    <nav className="flex flex-wrap gap-4 border-b border-slate-200 pb-3 text-sm">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={cn(
            "font-medium text-slate-500 hover:text-slate-900",
            link.href === active && "text-slate-900 underline underline-offset-4",
          )}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
