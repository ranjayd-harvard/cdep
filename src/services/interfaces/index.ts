/**
 * Service interfaces for the future middle tier.
 *
 * Every method takes `tenantId` as its first argument (except the
 * Organization/Tenant/OrganizationMembership/OrganizationInvitation
 * services, which operate one level up, at the org boundary). That value
 * must always be derived from the authenticated session (see
 * `src/auth.ts` and `src/lib/tenant.ts`) — never from a route param,
 * query string, or form field. This is what keeps tenant isolation
 * enforceable once these interfaces are backed by real APIs instead of
 * mocks.
 */
export * from "./organization-service";
export * from "./tenant-service";
export * from "./platform-settings-service";
export * from "./organization-membership-service";
export * from "./organization-invitation-service";
export * from "./data-product-service";
export * from "./dataset-service";
export * from "./entitlement-service";
export * from "./exchange-service";
export * from "./upload-service";
export * from "./download-service";
export * from "./notification-service";
export * from "./api-access-service";
export * from "./lakehouse-admin-service";
export * from "./publication-admin-service";
export * from "./pipeline-job-admin-service";
export * from "./observability-admin-service";
export * from "./product-versioning-admin-service";
