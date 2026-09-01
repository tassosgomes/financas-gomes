import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { resolve } from "node:path";

import { getMigrationDatabaseUrl } from "./config";
import schema from "./schema";

export const MIGRATIONS_FOLDER = resolve(process.cwd(), "drizzle");
export const MIGRATIONS_SCHEMA = "drizzle";
export const MIGRATIONS_TABLE = "__drizzle_migrations";

type MigrationRecord = {
  hash: string;
  created_at: string | number;
};

function createMigrationPool(): Pool {
  return new Pool({
    connectionString: getMigrationDatabaseUrl(),
    max: 1,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 5_000,
  });
}

function getMigrationMetadata() {
  return readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });
}

async function readAppliedMigrations(pool: Pool): Promise<MigrationRecord[]> {
  const tableResult = await pool.query<{ table_name: string | null }>(
    `SELECT to_regclass($1) AS table_name`,
    [`${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`],
  );

  if (!tableResult.rows[0]?.table_name) {
    return [];
  }

  const result = await pool.query<MigrationRecord>(
    `SELECT hash, created_at
       FROM "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"
      ORDER BY created_at ASC`,
  );

  return result.rows;
}

export interface MigrationStatus {
  applied: number;
  pending: number;
  drifted: number;
  pendingTags: string[];
}

/**
 * Reads the Drizzle journal without starting Next.js or applying anything.
 * The command reports a missing migration table as all migrations pending.
 */
export async function getMigrationStatus(): Promise<MigrationStatus> {
  const migrations = getMigrationMetadata();
  const pool = createMigrationPool();

  try {
    const appliedMigrations = await readAppliedMigrations(pool);
    const appliedHashes = new Set(appliedMigrations.map(({ hash }) => hash));
    const localHashes = new Set(migrations.map(({ hash }) => hash));
    const pending = migrations.filter(({ hash }) => !appliedHashes.has(hash));
    const drifted = appliedMigrations.filter(
      ({ hash }) => !localHashes.has(hash),
    );

    return {
      applied: appliedMigrations.length - drifted.length,
      pending: pending.length,
      drifted: drifted.length,
      pendingTags: pending.map((migration) =>
        String(migration.folderMillis),
      ),
    };
  } finally {
    await pool.end();
  }
}

/** Applies forward-only migrations and never runs as a side effect of app boot. */
export async function applyMigrations(): Promise<void> {
  const pool = createMigrationPool();

  try {
    const db = drizzle(pool, { schema });
    await migrate(db, {
      migrationsFolder: MIGRATIONS_FOLDER,
      migrationsSchema: MIGRATIONS_SCHEMA,
      migrationsTable: MIGRATIONS_TABLE,
    });
  } finally {
    await pool.end();
  }
}
