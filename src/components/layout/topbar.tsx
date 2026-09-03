"use client";

import { Menu } from "lucide-react";
import type { UserRole } from "@/models";
import { UserMenu } from "./user-menu";

export interface TopbarProps {
  organizationName?: string;
  user: { name: string; email: string; role: UserRole };
  onOpenMobileNav: () => void;
  profileHref?: string;
}

export function Topbar({ organizationName = "Platform Admin", user, onOpenMobileNav, profileHref }: TopbarProps) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenMobileNav}
          aria-label="Open navigation menu"
          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900 lg:hidden"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
        <div className="hidden text-sm text-slate-500 sm:block">
          <span className="font-medium text-slate-900">{organizationName}</span>
        </div>
      </div>
      <UserMenu name={user.name} email={user.email} role={user.role} profileHref={profileHref} />
    </header>
  );
}
