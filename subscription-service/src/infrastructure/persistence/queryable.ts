import type pg from "pg";

// Repository functions accept either the shared pool or a client borrowed
// from withTransaction() — the same call works standalone or as part of a
// larger transactional command (spec §41).
export type Queryable = pg.Pool | pg.PoolClient;
