import { UserRole } from "@/models";

const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.SUPERUSER]: "Superuser",
  [UserRole.CUSTOMER_ADMIN]: "Customer Admin",
  [UserRole.CUSTOMER_USER]: "Customer User",
  [UserRole.CUSTOMER_READONLY]: "Read Only",
};

export function formatRole(role: UserRole): string {
  return ROLE_LABELS[role];
}
