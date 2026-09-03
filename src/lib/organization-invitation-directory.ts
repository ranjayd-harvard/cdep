import { randomBytes } from "node:crypto";
import { getDb } from "@/lib/mongodb";
import { InvitationStatus, type OrganizationInvitation, type UserRole } from "@/models";

interface InvitationDocument {
  _id: string;
  organizationId: string;
  tenantId: string;
  email: string;
  role: UserRole;
  status: InvitationStatus;
  invitedBy: string;
  invitedAt: Date;
  resolvedAt: Date | null;
}

function toInvitation(doc: InvitationDocument): OrganizationInvitation {
  return {
    id: doc._id,
    organizationId: doc.organizationId,
    tenantId: doc.tenantId,
    email: doc.email,
    role: doc.role,
    status: doc.status,
    invitedBy: doc.invitedBy,
    invitedAt: doc.invitedAt,
    resolvedAt: doc.resolvedAt,
  };
}

/**
 * Thrown when an email already has a PENDING invitation — from this org
 * or another. A person can only belong to one organization, so two
 * competing pending invites would just be confusing; an admin who wants
 * to change the role/tenant on an existing invite revokes it first (see
 * `revokeInvitation`) and re-invites.
 */
export class DuplicateInvitationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateInvitationError";
  }
}

export async function findPendingInvitationByEmail(email: string): Promise<OrganizationInvitation | null> {
  const normalized = email.trim().toLowerCase();
  const db = await getDb();
  const doc = await db
    .collection<InvitationDocument>("organizationInvitations")
    .findOne({ email: normalized, status: InvitationStatus.PENDING });
  return doc ? toInvitation(doc) : null;
}

export async function listPendingInvitationsForOrganization(
  organizationId: string,
): Promise<OrganizationInvitation[]> {
  const db = await getDb();
  const docs = await db
    .collection<InvitationDocument>("organizationInvitations")
    .find({ organizationId, status: InvitationStatus.PENDING })
    .sort({ invitedAt: 1 })
    .toArray();
  return docs.map(toInvitation);
}

export async function findInvitationById(invitationId: string): Promise<OrganizationInvitation | null> {
  const db = await getDb();
  const doc = await db.collection<InvitationDocument>("organizationInvitations").findOne({ _id: invitationId });
  return doc ? toInvitation(doc) : null;
}

export async function createInvitation(input: {
  organizationId: string;
  tenantId: string;
  email: string;
  role: UserRole;
  invitedBy: string;
}): Promise<OrganizationInvitation> {
  const normalizedEmail = input.email.trim().toLowerCase();
  const existing = await findPendingInvitationByEmail(normalizedEmail);
  if (existing) {
    throw new DuplicateInvitationError(`"${normalizedEmail}" already has a pending invitation.`);
  }

  const db = await getDb();
  const doc: InvitationDocument = {
    _id: `invite-${randomBytes(4).toString("hex")}`,
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    email: normalizedEmail,
    role: input.role,
    status: InvitationStatus.PENDING,
    invitedBy: input.invitedBy,
    invitedAt: new Date(),
    resolvedAt: null,
  };
  await db.collection<InvitationDocument>("organizationInvitations").insertOne(doc);
  return toInvitation(doc);
}

export async function acceptInvitation(invitationId: string): Promise<void> {
  const db = await getDb();
  await db.collection<InvitationDocument>("organizationInvitations").updateOne(
    { _id: invitationId },
    { $set: { status: InvitationStatus.ACCEPTED, resolvedAt: new Date() } },
  );
}

export async function declineInvitation(invitationId: string): Promise<void> {
  const db = await getDb();
  await db.collection<InvitationDocument>("organizationInvitations").updateOne(
    { _id: invitationId },
    { $set: { status: InvitationStatus.DECLINED, resolvedAt: new Date() } },
  );
}

/**
 * Admin-only cancellation of a still-pending invitation (see
 * `src/app/(portal)/settings/invitation-actions.ts`) — e.g. invited the
 * wrong email, or wants to change the role/tenant before re-inviting.
 */
export async function revokeInvitation(invitationId: string): Promise<void> {
  const db = await getDb();
  await db.collection<InvitationDocument>("organizationInvitations").updateOne(
    { _id: invitationId },
    { $set: { status: InvitationStatus.REVOKED, resolvedAt: new Date() } },
  );
}
