import { config as loadDotenv } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Keep the CLI useful from a clean checkout while still allowing each
// environment to provide its own DATABASE_URL. The migration runner performs
// its own strict runtime validation before opening a connection.
// Keep local files as defaults; explicit shell/CI values select the target.
loadDotenv({ path: ".env" });
loadDotenv({ path: ".env.local" });

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
