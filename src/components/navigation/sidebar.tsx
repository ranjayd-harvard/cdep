"use client";

import Link from "next/link";
import { Database, X, type LucideIcon } from "lucide-react";
import { NavLinks } from "./nav-links";
import { APP_CONFIG } from "@/config/app";
import type { NavItem } from "@/config/navigation";

export interface SidebarBrand {
  label: string;
  href: string;
  icon: LucideIcon;
}

const DEFAULT_BRAND: SidebarBrand = { label: APP_CONFIG.name, href: "/dashboard", icon: Database };

export interface SidebarProps {
  mobileOpen: boolean;
  onCloseMobile: () => void;
  navItems?: NavItem[];
  brand?: SidebarBrand;
}

export function Sidebar({ mobileOpen, onCloseMobile, navItems, brand = DEFAULT_BRAND }: SidebarProps) {
  return (
    <>
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        <SidebarContent navItems={navItems} brand={brand} />
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-900/40"
            role="presentation"
            onClick={onCloseMobile}
          />
          <aside className="relative flex h-full w-64 flex-col bg-white shadow-xl">
            <div className="flex justify-end px-3 pt-3">
              <button
                type="button"
                onClick={onCloseMobile}
                aria-label="Close navigation menu"
                className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <SidebarContent onNavigate={onCloseMobile} navItems={navItems} brand={brand} />
          </aside>
        </div>
      ) : null}
    </>
  );
}

function SidebarContent({
  onNavigate,
  navItems,
  brand,
}: {
  onNavigate?: () => void;
  navItems?: NavItem[];
  brand: SidebarBrand;
}) {
  const BrandIcon = brand.icon;
  return (
    <>
      <Link href={brand.href} className="flex items-center gap-2 px-5 py-5">
        <BrandIcon className="h-6 w-6 text-slate-900" aria-hidden="true" />
        <span className="text-base font-semibold text-slate-900">{brand.label}</span>
      </Link>
      <NavLinks onNavigate={onNavigate} navItems={navItems} />
    </>
  );
}
