import type { Collection, Db, Document, Filter, OptionalUnlessRequiredId, UpdateFilter, WithId } from "mongodb";

/**
 * Thrown when code tries to read or write a document for a tenantId
 * other than the one a `TenantScopedCollection` was constructed for.
 * Reaching this means application code already has a bug — a route
 * handler or service forgot which tenant it was acting for — so this is
 * a security event to alert on, not a normal "not found"/403 response.
 */
export class TenantIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantIsolationError";
  }
}

export interface TenantOwnedDocument extends Document {
  tenantId: string;
}

/**
 * The single sanctioned way to read or write a tenant-owned MongoDB
 * collection. Every method folds in the tenantId this instance was
 * constructed for; a caller-supplied filter or document naming a
 * *different* tenantId is rejected outright rather than silently
 * overridden, so a forgotten or wrong tenant check can never widen
 * access — it can only fail loudly. There is deliberately no way to
 * construct one of these without already knowing which tenant you're
 * acting for (see `requireTenantContext` in `src/lib/tenant.ts`).
 */
export class TenantScopedCollection<T extends TenantOwnedDocument> {
  constructor(
    private readonly collection: Collection<T>,
    private readonly tenantId: string,
  ) {}

  find(filter: Filter<T> = {} as Filter<T>) {
    return this.collection.find(this.scoped(filter));
  }

  findOne(filter: Filter<T> = {} as Filter<T>): Promise<WithId<T> | null> {
    return this.collection.findOne(this.scoped(filter));
  }

  insertOne(doc: T) {
    this.assertOwned(doc.tenantId);
    return this.collection.insertOne(doc as OptionalUnlessRequiredId<T>);
  }

  updateOne(filter: Filter<T>, update: UpdateFilter<T>) {
    return this.collection.updateOne(this.scoped(filter), update);
  }

  updateMany(filter: Filter<T>, update: UpdateFilter<T>) {
    return this.collection.updateMany(this.scoped(filter), update);
  }

  deleteOne(filter: Filter<T>) {
    return this.collection.deleteOne(this.scoped(filter));
  }

  private scoped(filter: Filter<T>): Filter<T> {
    const requested = (filter as Record<string, unknown>).tenantId;
    if (requested !== undefined) {
      this.assertOwned(requested);
    }
    return { ...filter, tenantId: this.tenantId } as Filter<T>;
  }

  private assertOwned(tenantId: unknown): void {
    if (tenantId !== this.tenantId) {
      throw new TenantIsolationError(
        `Refusing to access tenantId "${String(tenantId)}" through a TenantScopedCollection scoped to "${this.tenantId}".`,
      );
    }
  }
}

export function getTenantScopedCollection<T extends TenantOwnedDocument>(
  db: Db,
  collectionName: string,
  tenantId: string,
): TenantScopedCollection<T> {
  return new TenantScopedCollection<T>(db.collection<T>(collectionName), tenantId);
}
