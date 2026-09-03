"use client";

import { signOut } from "next-auth/react";

export function SignOutLink() {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="text-xs font-medium text-slate-500 hover:text-slate-900"
    >
      Sign out
    </button>
  );
}
