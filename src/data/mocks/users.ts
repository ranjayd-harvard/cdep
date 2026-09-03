import { UserRole, type PortalUser } from "@/models";
import { DEFAULT_ORGANIZATION_ID, SECONDARY_ORGANIZATION_ID } from "./organizations";
import { DEFAULT_TENANT_ID, SECONDARY_TENANT_ID } from "./tenants";

/**
 * DEV ONLY mock user directory backing the credentials-based sign-in.
 * All accounts share the password "portal-demo" (see README). This is
 * intentionally simple for Phase 1 and is designed to be replaced by a
 * real identity provider (Entra ID, Okta, Auth0, customer SSO) without
 * touching anything outside `src/auth.ts`.
 */
export const MOCK_USERS: PortalUser[] = [
  {
    id: "user-platform-admin",
    name: "Platform Admin",
    email: "admin@platform.example.com",
    organizationId: null,
    tenantId: null,
    role: UserRole.SUPERUSER,
    status: "active",
  },
  {
    id: "user-ranjay-kumar",
    name: "Ranjay Kumar",
    email: "ranjayd@gmail.com",
    organizationId: DEFAULT_ORGANIZATION_ID,
    tenantId: DEFAULT_TENANT_ID,
    role: UserRole.CUSTOMER_ADMIN,
    status: "active",
  },
  {
    id: "user-ranjay-flash",
    name: "Ranjay Flash",
    email: "ranjayflash@gmail.com",
    organizationId: DEFAULT_ORGANIZATION_ID,
    tenantId: DEFAULT_TENANT_ID,
    role: UserRole.CUSTOMER_ADMIN,
    status: "active",
  },
  {
    id: "user-morgan-lee",
    name: "Morgan Lee",
    email: "morgan.lee@acmelive.example.com",
    organizationId: DEFAULT_ORGANIZATION_ID,
    tenantId: DEFAULT_TENANT_ID,
    role: UserRole.CUSTOMER_USER,
    status: "active",
  },
  {
    id: "user-jordan-patel",
    name: "Jordan Patel",
    email: "jordan.patel@acmelive.example.com",
    organizationId: DEFAULT_ORGANIZATION_ID,
    tenantId: DEFAULT_TENANT_ID,
    role: UserRole.CUSTOMER_READONLY,
    status: "active",
  },
  {
    id: "user-sam-rivera",
    name: "Sam Rivera",
    email: "sam.rivera@globexevents.example.com",
    organizationId: SECONDARY_ORGANIZATION_ID,
    tenantId: SECONDARY_TENANT_ID,
    role: UserRole.CUSTOMER_ADMIN,
    status: "active",
  },
];

export const MOCK_LOGIN_PASSWORD = "portal-demo";
