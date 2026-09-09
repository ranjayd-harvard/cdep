import crypto from "node:crypto";

// ETag / conditional GET (spec §8.12) — incorporates tenant, product,
// version, resource, query fingerprint, serving snapshot, field
// projection, and cursor/page, so any change to any of those changes the
// ETag. Authentication and entitlement checks still run before this is
// ever computed or compared (see the route handler) — a 304 is never
// returned to an unauthenticated or unentitled caller.
export function computeEtag(input: {
  organizationId: string;
  tenantId: string;
  productId: string;
  version: string;
  resource: string;
  queryFingerprint: string;
  servingSnapshot: string | null;
  fields: string[] | null;
  cursor: string | null;
}): string {
  const hash = crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return `"${hash}"`;
}
