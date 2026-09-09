import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../common/errors/app-error.js";
import { env } from "../config/env.js";
import { ROLES, type Role } from "../config/constants.js";
import type { TenantContext } from "./request-context.js";

interface DevTokenPayload {
  sub: string;
  organization_id: string;
  active_tenant_id: string;
  role: string;
}

// The same fixed dev identity subscription-service/data-exchange-service
// use, so a token minted by the portal's mintDevToken() for one service
// authenticates identically here.
const DEFAULT_DEV_PROFILE: DevTokenPayload = {
  sub: "usr-8a74b91",
  organization_id: "org-vobis-org-722aea",
  active_tenant_id: "tenant-default-47d849",
  role: "CUSTOMER_ADMIN",
};

function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

// organization_id/active_tenant_id are VARCHAR(64) slug-style ids
// platform-wide, never native UUIDs.
function toTenantContext(payload: DevTokenPayload): TenantContext {
  if (!payload.sub || !payload.organization_id || !payload.active_tenant_id || !payload.role) {
    throw new AppError("UNAUTHENTICATED", "Token is missing required claims.");
  }
  if (!isRole(payload.role)) {
    throw new AppError("UNAUTHENTICATED", `Token carries an unrecognized role: ${payload.role}`);
  }
  if (payload.organization_id.length > 64 || payload.active_tenant_id.length > 64) {
    throw new AppError("UNAUTHENTICATED", "Token's organization_id/active_tenant_id exceed the maximum length.");
  }
  return {
    userId: payload.sub,
    organizationId: payload.organization_id,
    activeTenantId: payload.active_tenant_id,
    role: payload.role,
  };
}

// Decodes (but does NOT cryptographically verify) a base64url JSON payload
// — a stand-in for JWT verification in development only. Never reachable
// when NODE_ENV=production (env.ts refuses to boot AUTH_MODE=development there).
function decodeDevToken(token: string): DevTokenPayload {
  try {
    const jwtLikeParts = token.split(".");
    const rawPayload = jwtLikeParts.length === 3 ? jwtLikeParts[1] : jwtLikeParts[0];
    if (!rawPayload) throw new Error("empty token");
    const json = Buffer.from(rawPayload, "base64url").toString("utf8");
    return JSON.parse(json) as DevTokenPayload;
  } catch {
    throw new AppError("UNAUTHENTICATED", "Malformed development token.");
  }
}

function verifyProductionJwt(_token: string): TenantContext {
  // Real verification: fetch the tenant's OIDC issuer JWKS, verify
  // signature + exp + aud/iss, map claims to TenantContext exactly as
  // toTenantContext() does above. Left unimplemented on purpose — this
  // phase only needs the trusted-claims contract to hold.
  throw new AppError("UNAUTHENTICATED", "OIDC verification is not configured for this deployment.");
}

export function authenticate(request: FastifyRequest, _reply: FastifyReply): void {
  const header = request.headers.authorization;

  if (env.AUTH_MODE === "development") {
    if (!header) {
      request.tenantContext = toTenantContext(DEFAULT_DEV_PROFILE);
      return;
    }
    const token = header.replace(/^Bearer\s+/i, "");
    request.tenantContext = toTenantContext(decodeDevToken(token));
    return;
  }

  if (!header) {
    throw new AppError("UNAUTHENTICATED", "Missing Authorization header.");
  }
  const token = header.replace(/^Bearer\s+/i, "");
  request.tenantContext = verifyProductionJwt(token);
}

export function requireAuth() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    authenticate(request, reply);
  };
}
