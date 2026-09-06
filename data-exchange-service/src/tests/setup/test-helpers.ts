import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";

export interface DevProfile {
  sub: string;
  organization_id: string;
  active_tenant_id: string;
  role: string;
}

export const TENANT_A: DevProfile = {
  sub: "usr-8a74b91",
  organization_id: "org-vobis-org-722aea",
  active_tenant_id: "tenant-default-47d849",
  role: "CUSTOMER_ADMIN",
};

export const TENANT_B: DevProfile = {
  sub: "usr-3f0d221",
  organization_id: "org-globex-org-9c1f2d",
  active_tenant_id: "tenant-default-b19e21",
  role: "CUSTOMER_ADMIN",
};

export function authHeader(profile: DevProfile): { authorization: string } {
  const token = Buffer.from(JSON.stringify(profile)).toString("base64url");
  return { authorization: `Bearer ${token}` };
}

export async function createTestApp(): Promise<FastifyInstance> {
  const app = await buildApp();
  await app.ready();
  return app;
}
