"use client";

import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { ADMIN_NAV } from "@/config/navigation";
import { UserRole } from "@/models";
import { PortalShell } from "./portal-shell";

export interface AdminShellProps {
  user: { name: string; email: string };
  children: ReactNode;
}

const ADMIN_BRAND = { label: "Admin", href: "/admin", icon: ShieldCheck };

/**
 * The Admin Console's chrome — a superuser's counterpart to `PortalShell`.
 * A superuser has no organization to show in the topbar and no
 * `/settings` profile page, so those are simply omitted rather than
 * reusing customer-portal defaults.
 */
export function AdminShell({ user, children }: AdminShellProps) {
  return (
    <PortalShell
      user={{ ...user, role: UserRole.SUPERUSER }}
      navItems={ADMIN_NAV}
      brand={ADMIN_BRAND}
      profileHref=""
    >
      {children}
    </PortalShell>
  );
}
