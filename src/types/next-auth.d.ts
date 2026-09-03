import type { UserRole } from "@/models";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      organizationId: string | null;
      tenantId: string | null;
      role: UserRole | null;
    } & DefaultSession["user"];
  }

  interface User {
    organizationId: string | null;
    tenantId: string | null;
    role: UserRole | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId: string;
    organizationId: string | null;
    tenantId: string | null;
    role: UserRole | null;
  }
}
