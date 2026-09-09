import type pg from "pg";
import { pool } from "../../database/pool.js";

export interface DomainRow {
  domain_id: string;
  name: string;
  display_name: string;
  description: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export async function findDomain(domainId: string, client: pg.Pool | pg.PoolClient = pool): Promise<DomainRow | null> {
  const { rows } = await client.query<DomainRow>(`SELECT * FROM catalog.domains WHERE domain_id = $1`, [domainId]);
  return rows[0] ?? null;
}

export async function listDomains(): Promise<DomainRow[]> {
  const { rows } = await pool.query<DomainRow>(`SELECT * FROM catalog.domains ORDER BY name ASC`);
  return rows;
}

export async function createDomain(input: {
  domainId: string;
  name: string;
  displayName: string;
  description?: string;
  status?: string;
}): Promise<DomainRow> {
  const { rows } = await pool.query<DomainRow>(
    `INSERT INTO catalog.domains (domain_id, name, display_name, description, status)
     VALUES ($1, $2, $3, $4, COALESCE($5, 'ACTIVE'))
     RETURNING *`,
    [input.domainId, input.name, input.displayName, input.description ?? null, input.status ?? null],
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to create domain");
  return row;
}
