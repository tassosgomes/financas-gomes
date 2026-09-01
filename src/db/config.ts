const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);

function validateDatabaseUrl(value: string, source: string): string {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${source} deve ser uma URL PostgreSQL válida.`);
  }

  if (!POSTGRES_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`${source} deve usar o protocolo PostgreSQL.`);
  }

  return value;
}

/** URL used by the application runtime. */
export function getDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();

  if (!value) {
    throw new Error(
      "DATABASE_URL é obrigatória para executar uma operação de banco.",
    );
  }

  return validateDatabaseUrl(value, "DATABASE_URL");
}

/**
 * A separate target is useful for a controlled deploy migration. When it is
 * absent, the same DATABASE_URL used by the application is the target.
 */
export function getMigrationDatabaseUrl(): string {
  const explicitMigrationUrl = process.env.MIGRATION_DATABASE_URL?.trim();
  const value = explicitMigrationUrl || process.env.DATABASE_URL?.trim();

  if (!value) {
    throw new Error(
      "Defina MIGRATION_DATABASE_URL ou DATABASE_URL para executar migrations.",
    );
  }

  return validateDatabaseUrl(
    value,
    explicitMigrationUrl ? "MIGRATION_DATABASE_URL" : "DATABASE_URL",
  );
}

/** Neon pooled/direct hosts use the serverless driver in the app runtime. */
export function isNeonDatabaseUrl(value: string): boolean {
  const hostname = new URL(value).hostname.toLowerCase();

  return (
    hostname.endsWith(".neon.tech") ||
    hostname.endsWith(".neon.build") ||
    hostname.includes(".neon.tech.")
  );
}

export const DATABASE_POOL_MAX = 5;
