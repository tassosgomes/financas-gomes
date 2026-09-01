import { config as loadDotenv } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Keep the CLI useful from a clean checkout while still allowing each
// environment to provide its own DATABASE_URL. The migration runner performs
// its own strict runtime validation before opening a connection.
loadDotenv({ path: ".env" });
loadDotenv({ path: ".env.local", override: true });

const localDatabaseUrl =
  "postgresql://postgres:postgres@localhost:5432/financas_gomes";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? localDatabaseUrl,
  },
  migrations: {
    schema: "drizzle",
    table: "__drizzle_migrations",
    prefix: "timestamp",
  },
});
