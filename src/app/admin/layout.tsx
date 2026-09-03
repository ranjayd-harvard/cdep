import type { ReactNode } from "react";
import { requireSuperuserContext } from "@/lib/admin";
import { AdminShell } from "@/components/layout/admin-shell";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const admin = await requireSuperuserContext();

  return <AdminShell user={{ name: admin.name, email: admin.email }}>{children}</AdminShell>;
}
