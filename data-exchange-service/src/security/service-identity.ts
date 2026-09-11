import { SignJWT, jwtVerify } from "jose";

// Cloud-neutral ServiceIdentityProvider (spec §14/§46). Local implementation:
// a short-lived HS256 JWT signed with the same per-relationship secret that
// used to be sent as a raw, indefinitely-reusable header value (e.g.
// SUBSCRIPTION_SERVICE_INTERNAL_API_KEY) — the secret itself doesn't change,
// but it's now used to *sign* a token scoped to one caller/callee pair and
// role, expiring in ~60s, instead of being compared bit-for-bit against every
// request forever. This closes the "self-asserted x-actor-role" gap: the
// role is inside the signed payload, not a plaintext header the caller can
// set to anything. A future Phase 12 provider (workload identity, mTLS,
// AWS IAM/GCP service identities) implements the same mint/verify shape.
export interface ServiceIdentityClaims {
  sub: string;
  aud: string;
  role: string;
}

export async function mintServiceToken(
  secret: string,
  claims: ServiceIdentityClaims,
  ttlSeconds = 60,
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT({ role: claims.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setAudience(claims.aud)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(key);
}

export interface VerifiedServiceIdentity {
  sub: string;
  role: string;
}

export async function verifyServiceToken(secret: string, token: string, audience: string): Promise<VerifiedServiceIdentity> {
  const key = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, key, { audience, algorithms: ["HS256"] });
  if (typeof payload.sub !== "string" || typeof payload.role !== "string") {
    throw new Error("Service token is missing required claims.");
  }
  return { sub: payload.sub, role: payload.role };
}
