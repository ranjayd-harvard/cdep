import type pg from "pg";
import { pool } from "../../database/pool.js";

export interface OwnerRow {
  owner_id: string;
  owner_type: string;
  name: string;
  email: string | null;
  team: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export async function findOwner(ownerId: string, client: pg.Pool | pg.PoolClient = pool): Promise<OwnerRow | null> {
  const { rows } = await client.query<OwnerRow>(`SELECT * FROM catalog.owners WHERE owner_id = $1`, [ownerId]);
  return rows[0] ?? null;
}

export async function listOwners(): Promise<OwnerRow[]> {
  const { rows } = await pool.query<OwnerRow>(`SELECT * FROM catalog.owners ORDER BY name ASC`);
  return rows;
}

export async function createOwner(input: {
  ownerId: string;
  ownerType: string;
  name: string;
  email?: string;
  team?: string;
  status?: string;
}): Promise<OwnerRow> {
  const { rows } = await pool.query<OwnerRow>(
    `INSERT INTO catalog.owners (owner_id, owner_type, name, email, team, status)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'ACTIVE'))
     RETURNING *`,
    [input.ownerId, input.ownerType, input.name, input.email ?? null, input.team ?? null, input.status ?? null],
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to create owner");
  return row;
}
