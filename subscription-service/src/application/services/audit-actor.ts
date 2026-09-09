// The minimal actor shape audit events need — satisfied structurally by
// both ActorContext (internal calls) and a TenantContext-derived actor
// (customer calls: {actorType: "USER", actorId: tenantContext.userId}).
// correlationId rides along here (rather than as a separate parameter on
// every service function) so route handlers have one place to attach
// request.correlationId (spec §40/§49: "correlation IDs preserved").
export interface AuditActor {
  actorType: "CI" | "SERVICE" | "USER" | "SYSTEM";
  actorId: string;
  correlationId?: string | null;
}
