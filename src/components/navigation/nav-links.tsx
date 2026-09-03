"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PRIMARY_NAV, type NavItem } from "@/config/navigation";
import { cn } from "@/lib/utils";

export interface NavLinksProps {
  onNavigate?: () => void;
  navItems?: NavItem[];
}

export function NavLinks({ onNavigate, navItems = PRIMARY_NAV }: NavLinksProps) {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className="flex flex-1 flex-col gap-1 px-3">
      {navItems.map((item) => {
        // A parent-ish item (e.g. "/admin" next to "/admin/organizations")
        // only matches its own path exactly, so it doesn't light up for
        // every one of its siblings' subpaths too.
        const hasNestedSibling = navItems.some(
          (other) => other !== item && other.href.startsWith(`${item.href}/`),
        );
        const isActive = hasNestedSibling
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900",
              isActive
                ? "bg-slate-900 text-white"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
