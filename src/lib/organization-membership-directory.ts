import { randomBytes } from "node:crypto";
import { getDb } from "@/lib/mongodb";
import { MembershipRequestStatus, type OrganizationMembershipRequest } from "@/models";

interface MembershipRequestDocument {
  _id: string;
  organizationId: string;
  userId: string;
  userName: string;
  userEmail: string;
  status: MembershipRequestStatus;
  requestedAt: Date;
  resolvedAt: Date | null;
  resolvedBy: string | null;
}

function toRequest(doc: MembershipRequestDocument): OrganizationMembershipRequest {
  return {
    id: doc._id,
    organizationId: doc.organizationId,
    userId: doc.userId,
    userName: doc.userName,
    userEmail: doc.userEmail,
    status: doc.status,
    requestedAt: doc.requestedAt,
    resolvedAt: doc.resolvedAt,
    resolvedBy: doc.resolvedBy,
  };
}

/**
 * Thrown when a user who already has a PENDING request tries to create
 * another one. A user may have at most one PENDING request at a time —
 * they must wait for it to be resolved (approved or rejected) before
 * requesting to join a different organization.
 */
export class DuplicateMembershipRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateMembershipRequestError";
  }
}

export async function findPendingRequestForUser(userId: string): Promise<OrganizationMembershipRequest | null> {
  const db = await getDb();
  const doc = await db
    .collection<MembershipRequestDocument>("organizationMembershipRequests")
    .findOne({ userId, status: MembershipRequestStatus.PENDING });
  return doc ? toRequest(doc) : null;
}

export async function listPendingRequestsForOrganization(
  organizationId: string,
): Promise<OrganizationMembershipRequest[]> {
  const db = await getDb();
  const docs = await db
    .collection<MembershipRequestDocument>("organizationMembershipRequests")
    .find({ organizationId, status: MembershipRequestStatus.PENDING })
    .sort({ requestedAt: 1 })
    .toArray();
  return docs.map(toRequest);
}

export async function createMembershipRequest(input: {
  organizationId: string;
  userId: string;
  userName: string;
  userEmail: string;
}): Promise<OrganizationMembershipRequest> {
  const existing = await findPendingRequestForUser(input.userId);
  if (existing) {
    throw new DuplicateMembershipRequestError(
      `User "${input.userId}" already has a pending membership request.`,
    );
  }

  const db = await getDb();
  const doc: MembershipRequestDocument = {
    _id: `mreq-${randomBytes(4).toString("hex")}`,
    organizationId: input.organizationId,
    userId: input.userId,
    userName: input.userName,
    userEmail: input.userEmail,
    status: MembershipRequestStatus.PENDING,
    requestedAt: new Date(),
    resolvedAt: null,
    resolvedBy: null,
  };
  await db.collection<MembershipRequestDocument>("organizationMembershipRequests").insertOne(doc);
  return toRequest(doc);
}

export async function findMembershipRequestById(requestId: string): Promise<OrganizationMembershipRequest | null> {
  const db = await getDb();
  const doc = await db
    .collection<MembershipRequestDocument>("organizationMembershipRequests")
    .findOne({ _id: requestId });
  return doc ? toRequest(doc) : null;
}

export async function approveMembershipRequest(requestId: string, resolvedBy: string): Promise<void> {
  const db = await getDb();
  await db.collection<MembershipRequestDocument>("organizationMembershipRequests").updateOne(
    { _id: requestId },
    { $set: { status: MembershipRequestStatus.APPROVED, resolvedAt: new Date(), resolvedBy } },
  );
}

export async function rejectMembershipRequest(requestId: string, resolvedBy: string): Promise<void> {
  const db = await getDb();
  await db.collection<MembershipRequestDocument>("organizationMembershipRequests").updateOne(
    { _id: requestId },
    { $set: { status: MembershipRequestStatus.REJECTED, resolvedAt: new Date(), resolvedBy } },
  );
}
