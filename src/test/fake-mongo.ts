/**
 * A minimal in-memory stand-in for a MongoDB `Db`, used to unit test the
 * Mongo-backed repositories/services without a real database connection.
 * Supports just enough of the driver's filter/update/cursor shape (`$in`,
 * `$or`, `RegExp` equality, plain equality, `.sort()`, `.limit()`, `$set`,
 * `insertOne`/`updateOne`/`updateMany`/`deleteOne`/`deleteMany`/
 * `findOneAndDelete`, `createIndex` as a no-op) for those tests' queries.
 */
export function createFakeDb(collections: Record<string, Array<Record<string, unknown>>>) {
  function matches(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
    return Object.entries(filter).every(([key, condition]) => {
      if (key === "$or") {
        const branches = condition as Array<Record<string, unknown>>;
        return branches.some((branch) => matches(doc, branch));
      }
      if (condition !== null && typeof condition === "object" && "$in" in condition) {
        const values = (condition as { $in: unknown[] }).$in;
        return values.includes(doc[key]);
      }
      if (condition instanceof RegExp) {
        return typeof doc[key] === "string" && condition.test(doc[key] as string);
      }
      return doc[key] === condition;
    });
  }

  function makeCursor(getDocs: () => Record<string, unknown>[]) {
    let resolve = getDocs;
    const cursor = {
      sort(spec: Record<string, 1 | -1>) {
        const [[field, direction]] = Object.entries(spec);
        const prev = resolve;
        resolve = () =>
          [...prev()].sort((a, b) => {
            const av = a[field] as string | number | Date;
            const bv = b[field] as string | number | Date;
            if (av === bv) return 0;
            return (av > bv ? 1 : -1) * direction;
          });
        return cursor;
      },
      limit(n: number) {
        const prev = resolve;
        resolve = () => prev().slice(0, n);
        return cursor;
      },
      toArray: async () => resolve(),
    };
    return cursor;
  }

  return {
    collection(name: string) {
      if (!collections[name]) {
        collections[name] = [];
      }
      const docs = collections[name];

      return {
        find(filter: Record<string, unknown> = {}) {
          return makeCursor(() => docs.filter((doc) => matches(doc, filter)));
        },
        findOne: async (filter: Record<string, unknown> = {}) =>
          docs.find((doc) => matches(doc, filter)) ?? null,
        insertOne: async (doc: Record<string, unknown>) => {
          docs.push({ ...doc });
          return { insertedId: doc._id };
        },
        updateOne: async (
          filter: Record<string, unknown>,
          update: { $set?: Record<string, unknown>; $setOnInsert?: Record<string, unknown> },
          options: { upsert?: boolean } = {},
        ) => {
          const existing = docs.find((doc) => matches(doc, filter));
          if (existing) {
            Object.assign(existing, update.$set ?? {});
            return { matchedCount: 1, modifiedCount: 1, upsertedId: null };
          }
          if (options.upsert) {
            const created = { ...filter, ...(update.$setOnInsert ?? {}), ...(update.$set ?? {}) };
            docs.push(created);
            return { matchedCount: 0, modifiedCount: 0, upsertedId: created._id ?? null };
          }
          return { matchedCount: 0, modifiedCount: 0, upsertedId: null };
        },
        updateMany: async (
          filter: Record<string, unknown>,
          update: { $set?: Record<string, unknown> },
        ) => {
          const matching = docs.filter((doc) => matches(doc, filter));
          for (const doc of matching) {
            Object.assign(doc, update.$set ?? {});
          }
          return { matchedCount: matching.length, modifiedCount: matching.length };
        },
        findOneAndDelete: async (filter: Record<string, unknown> = {}) => {
          const index = docs.findIndex((doc) => matches(doc, filter));
          if (index === -1) {
            return null;
          }
          const [removed] = docs.splice(index, 1);
          return removed ?? null;
        },
        deleteOne: async (filter: Record<string, unknown> = {}) => {
          const index = docs.findIndex((doc) => matches(doc, filter));
          if (index === -1) {
            return { deletedCount: 0 };
          }
          docs.splice(index, 1);
          return { deletedCount: 1 };
        },
        deleteMany: async (filter: Record<string, unknown> = {}) => {
          const matching = docs.filter((doc) => matches(doc, filter));
          for (const doc of matching) {
            docs.splice(docs.indexOf(doc), 1);
          }
          return { deletedCount: matching.length };
        },
        createIndex: async () => "index-created",
      };
    },
  };
}
