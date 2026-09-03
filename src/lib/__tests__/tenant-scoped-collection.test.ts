import { describe, expect, it, vi } from "vitest";
import type { Collection } from "mongodb";
import { TenantIsolationError, TenantScopedCollection, type TenantOwnedDocument } from "@/lib/tenant-scoped-collection";

interface FixtureDoc extends TenantOwnedDocument {
  _id: string;
  label: string;
}

function fakeCollection() {
  return {
    find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    findOne: vi.fn().mockResolvedValue(null),
    insertOne: vi.fn().mockResolvedValue({ acknowledged: true }),
    updateOne: vi.fn().mockResolvedValue({ acknowledged: true }),
    deleteOne: vi.fn().mockResolvedValue({ acknowledged: true }),
  };
}

describe("TenantScopedCollection", () => {
  it("merges the constructor's tenantId into a find filter that omits it", () => {
    const collection = fakeCollection();
    const scoped = new TenantScopedCollection<FixtureDoc>(
      collection as unknown as Collection<FixtureDoc>,
      "tenant-a",
    );

    scoped.find({ label: "widgets" });

    expect(collection.find).toHaveBeenCalledWith({ label: "widgets", tenantId: "tenant-a" });
  });

  it("merges the constructor's tenantId into a findOne filter that omits it", async () => {
    const collection = fakeCollection();
    const scoped = new TenantScopedCollection<FixtureDoc>(
      collection as unknown as Collection<FixtureDoc>,
      "tenant-a",
    );

    await scoped.findOne({ label: "widgets" });

    expect(collection.findOne).toHaveBeenCalledWith({ label: "widgets", tenantId: "tenant-a" });
  });

  it("throws instead of silently overriding a filter naming a different tenantId", () => {
    const collection = fakeCollection();
    const scoped = new TenantScopedCollection<FixtureDoc>(
      collection as unknown as Collection<FixtureDoc>,
      "tenant-a",
    );

    expect(() => scoped.find({ tenantId: "tenant-b" })).toThrow(TenantIsolationError);
    expect(collection.find).not.toHaveBeenCalled();
  });

  it("throws instead of silently overriding a findOne filter naming a different tenantId", () => {
    const collection = fakeCollection();
    const scoped = new TenantScopedCollection<FixtureDoc>(
      collection as unknown as Collection<FixtureDoc>,
      "tenant-a",
    );

    expect(() => scoped.findOne({ tenantId: "tenant-b" })).toThrow(TenantIsolationError);
    expect(collection.findOne).not.toHaveBeenCalled();
  });

  it("refuses to insert a document owned by a different tenantId", () => {
    const collection = fakeCollection();
    const scoped = new TenantScopedCollection<FixtureDoc>(
      collection as unknown as Collection<FixtureDoc>,
      "tenant-a",
    );

    expect(() => scoped.insertOne({ _id: "1", tenantId: "tenant-b", label: "widgets" })).toThrow(
      TenantIsolationError,
    );
    expect(collection.insertOne).not.toHaveBeenCalled();
  });

  it("allows inserting a document owned by the scoped tenantId", () => {
    const collection = fakeCollection();
    const scoped = new TenantScopedCollection<FixtureDoc>(
      collection as unknown as Collection<FixtureDoc>,
      "tenant-a",
    );

    scoped.insertOne({ _id: "1", tenantId: "tenant-a", label: "widgets" });

    expect(collection.insertOne).toHaveBeenCalledWith({ _id: "1", tenantId: "tenant-a", label: "widgets" });
  });
});
