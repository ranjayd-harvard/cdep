"use client";

import { useState, type ReactNode } from "react";
import type { UserRole } from "@/models";
import type { NavItem } from "@/config/navigation";
import { Sidebar, type SidebarBrand } from "@/components/navigation/sidebar";
import { Topbar } from "./topbar";

export interface PortalShellProps {
  organizationName?: string;
  user: { name: string; email: string; role: UserRole };
  children: ReactNode;
  navItems?: NavItem[];
  brand?: SidebarBrand;
  profileHref?: string;
}

export function PortalShell({ organizationName, user, children, navItems, brand, profileHref }: PortalShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex h-dvh overflow-hidden bg-slate-50">
      <Sidebar
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
        navItems={navItems}
        brand={brand}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          organizationName={organizationName}
          user={user}
          onOpenMobileNav={() => setMobileNavOpen(true)}
          profileHref={profileHref}
        />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
