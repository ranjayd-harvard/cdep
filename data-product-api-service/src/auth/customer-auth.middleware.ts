import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../common/errors/app-error.js";
import { env } from "../config/env.js";
import { ROLES, type Role } from "../config/constants.js";
import type { SecurityContext } from "./request-context.js";

interface DevTokenPayload {
  sub: string;
  organization_id: string;
  active_tenant_id: string;
  role: string;
}

// The same fixed dev identity subscription-service/scheduling-service use,
// so a token minted by the portal's mintDevToken() (or subscription-
// service's own customerToken() test helper) authenticates identically
// here — no separate bridge to invent.
const DEFAULT_DEV_PROFILE: DevTokenPayload = {
  sub: "usr-8a74b91",
  organization_id: "org-vobis-org-722aea",
  active_tenant_id: "tenant-default-47d849",
  role: "CUSTOMER_ADMIN",
};

function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

function toSecurityContext(payload: DevTokenPayload): SecurityContext {
  if (!payload.sub || !payload.organization_id || !payload.active_tenant_id || !payload.role) {
    throw new AppError("AUTHENTICATION_REQUIRED", "Token is missing required claims.");
  }
  if (!isRole(payload.role)) {
    throw new AppError("INVALID_TOKEN", `Token carries an unrecognized role: ${payload.role}`);
  }
  if (payload.organization_id.length > 64 || payload.active_tenant_id.length > 64) {
    throw new AppError("INVALID_TOKEN", "Token's organization_id/active_tenant_id exceed the maximum length.");
  }
  return {
    subjectId: payload.sub,
    organizationId: payload.organization_id,
    activeTenantId: payload.active_tenant_id,
    roles: [payload.role],
    authenticationMethod: "DEV_TOKEN",
  };
}

// Decodes (but does NOT cryptographically verify) a base64url JSON payload
// — a stand-in for JWT verification in development only. Never reachable
// when NODE_ENV=production (env.ts refuses to boot AUTH_MODE=development
// there).
function decodeDevToken(token: string): DevTokenPayload {
  try {
    const jwtLikeParts = token.split(".");
    const rawPayload = jwtLikeParts.length === 3 ? jwtLikeParts[1] : jwtLikeParts[0];
    if (!rawPayload) throw new Error("empty token");
    const json = Buffer.from(rawPayload, "base64url").toString("utf8");
    return JSON.parse(json) as DevTokenPayload;
  } catch {
    throw new AppError("INVALID_TOKEN", "Malformed development token.");
  }
}

function verifyProductionJwt(_token: string): SecurityContext {
  // Real verification: fetch the tenant's OIDC issuer JWKS, verify
  // signature + exp + aud/iss + required claims, map claims to
  // SecurityContext exactly as toSecurityContext() does above. Left
  // unimplemented on purpose, matching every other service in this
  // monorepo — this phase only needs the trusted-claims contract to hold.
  throw new AppError("SERVICE_UNAVAILABLE", "OIDC verification is not configured for this deployment.");
}

export function authenticate(request: FastifyRequest, _reply: FastifyReply): void {
  const header = request.headers.authorization;

  if (env.AUTH_MODE === "development") {
    if (!header) {
      request.securityContext = toSecurityContext(DEFAULT_DEV_PROFILE);
      return;
    }
    const token = header.replace(/^Bearer\s+/i, "");
    request.securityContext = toSecurityContext(decodeDevToken(token));
    return;
  }

  if (!header) {
    throw new AppError("AUTHENTICATION_REQUIRED", "Missing Authorization header.");
  }
  const token = header.replace(/^Bearer\s+/i, "");
  request.securityContext = verifyProductionJwt(token);
}

export function requireAuth() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    authenticate(request, reply);
  };
}

export function getSecurityContext(request: FastifyRequest): SecurityContext {
  if (!request.securityContext) {
    throw new AppError("AUTHENTICATION_REQUIRED", "Request was not authenticated.");
  }
  return request.securityContext;
}
