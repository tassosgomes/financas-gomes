import { Pool as NeonPool } from "@neondatabase/serverless";
import {
  drizzle as drizzleNeon,
  type NeonDatabase,
} from "drizzle-orm/neon-serverless";
import {
  drizzle as drizzleNode,
  type NodePgDatabase,
} from "drizzle-orm/node-postgres";
import { Pool as NodePool } from "pg";

import {
  DATABASE_POOL_MAX,
  getDatabaseUrl,
  isNeonDatabaseUrl,
} from "./config";
import schema from "./schema";

export type Database =
  | NodePgDatabase<typeof schema>
  | NeonDatabase<typeof schema>;

let database: Database | undefined;
let nodePool: NodePool | undefined;
let neonPool: NeonPool | undefined;
let databaseUrl: string | undefined;

/**
 * Returns the application database lazily. No connection is opened while the
 * Next.js build is loading modules, and this function is never called by the
 * application boot path automatically.
 */
export function getDb(): Database {
  const connectionString = getDatabaseUrl();

  if (database && databaseUrl !== connectionString) {
    throw new Error(
      "DATABASE_URL mudou enquanto a aplicação estava em execução; reinicie o processo.",
    );
  }

  if (database) {
    return database;
  }

  databaseUrl = connectionString;

  if (isNeonDatabaseUrl(connectionString)) {
    neonPool = new NeonPool({
      connectionString,
      max: DATABASE_POOL_MAX,
    });
    database = drizzleNeon(neonPool, { schema });
  } else {
    nodePool = new NodePool({
      connectionString,
      max: DATABASE_POOL_MAX,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    });
    database = drizzleNode(nodePool, { schema });
  }

  return database;
}

/** Close pools in integration tests and process shutdown hooks. */
export async function closeDb(): Promise<void> {
  const pools = [nodePool, neonPool].filter(
    (pool): pool is NodePool | NeonPool => pool !== undefined,
  );

  await Promise.all(pools.map((pool) => pool.end()));

  database = undefined;
  databaseUrl = undefined;
  nodePool = undefined;
  neonPool = undefined;
}
