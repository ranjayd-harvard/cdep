import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../common/errors/app-error.js";
import { env } from "../config/env.js";
import { ROLES, type Role } from "../config/constants.js";
import type { RequestContext } from "./request-context.js";

interface DevTokenPayload {
  sub: string;
  organization_id: string;
  active_tenant_id: string;
  role: string;
}

// The fixed development identity described in AGENTS.md section 51/50,
// used whenever a request in AUTH_MODE=development carries no Authorization
// header at all, so local/manual testing works without hand-crafting a
// token every time.
const DEFAULT_DEV_PROFILE: DevTokenPayload = {
  sub: "usr-8a74b91",
  organization_id: "org-vobis-org-722aea",
  active_tenant_id: "tenant-default-47d849",
  role: "CUSTOMER_ADMIN",
};

function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

function toRequestContext(payload: DevTokenPayload): RequestContext {
  if (!payload.sub || !payload.organization_id || !payload.active_tenant_id || !payload.role) {
    throw new AppError("UNAUTHENTICATED", "Token is missing required claims.");
  }
  if (!isRole(payload.role)) {
    throw new AppError("UNAUTHENTICATED", `Token carries an unrecognized role: ${payload.role}`);
  }
  return {
    userId: payload.sub,
    organizationId: payload.organization_id,
    activeTenantId: payload.active_tenant_id,
    role: payload.role,
  };
}

// Decodes (but does NOT cryptographically verify) a base64url JSON payload.
// This stands in for JWT verification in development only. It is never
// reachable when NODE_ENV=production, because env.ts refuses to boot with
// AUTH_MODE=development in production.
function decodeDevToken(token: string): DevTokenPayload {
  try {
    const jwtLikeParts = token.split(".");
    // Accept either a bare base64url JSON payload, or a header.payload.signature
    // shaped mock JWT (signature ignored) so dev tooling can hand out
    // something that *looks* like a real JWT.
    const rawPayload = jwtLikeParts.length === 3 ? jwtLikeParts[1] : jwtLikeParts[0];
    if (!rawPayload) throw new Error("empty token");
    const json = Buffer.from(rawPayload, "base64url").toString("utf8");
    return JSON.parse(json) as DevTokenPayload;
  } catch {
    throw new AppError("UNAUTHENTICATED", "Malformed development token.");
  }
}

function verifyProductionJwt(_token: string): RequestContext {
  // AGENTS.md section 4/51 explicitly scopes out implementing an identity
  // provider. Wiring real verification means: fetch the tenant's OIDC
  // issuer JWKS, verify signature + exp + aud/iss, then map claims to
  // RequestContext exactly as toRequestContext() does above. Left
  // unimplemented on purpose for this phase.
  throw new AppError("UNAUTHENTICATED", "OIDC verification is not configured for this deployment.");
}

export function authenticate(request: FastifyRequest, _reply: FastifyReply): void {
  const header = request.headers.authorization;

  if (env.AUTH_MODE === "development") {
    if (!header) {
      request.requestContext = toRequestContext(DEFAULT_DEV_PROFILE);
      return;
    }
    const token = header.replace(/^Bearer\s+/i, "");
    request.requestContext = toRequestContext(decodeDevToken(token));
    return;
  }

  if (!header) {
    throw new AppError("UNAUTHENTICATED", "Missing Authorization header.");
  }
  const token = header.replace(/^Bearer\s+/i, "");
  request.requestContext = verifyProductionJwt(token);
}

export function requireAuth() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    authenticate(request, reply);
  };
}
