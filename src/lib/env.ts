import { z } from "zod";

const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url("deve ser uma URL válida").optional(),
);

export const serverEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  BETTER_AUTH_URL: z.string().url("deve ser uma URL válida"),
  DATABASE_URL: z.string().min(1, "é obrigatória"),
  BETTER_AUTH_SECRET: z.string().min(32, "deve ter pelo menos 32 caracteres"),
  GOOGLE_CLIENT_ID: z.string().min(1, "é obrigatório"),
  GOOGLE_CLIENT_SECRET: z.string().min(1, "é obrigatório"),
  SENTRY_DSN: optionalUrl,
  SENTRY_ENVIRONMENT: z.string().min(1).default("development"),
  SENTRY_RELEASE: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).optional(),
  ),
  // The probe is disabled by default and should only be enabled briefly with
  // a separately managed secret in an environment being validated.
  SENTRY_TEST_MODE: z.enum(["true", "false"]).default("false"),
  SENTRY_TEST_TOKEN: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).optional(),
  ),
  // The E2E provider is deliberately opt-in. `isE2ETestAuthEnabled` adds a
  // second runtime guard so these values can never activate it in Preview or
  // production, even if an environment accidentally carries the flag.
  E2E_TEST_AUTH_ENABLED: z.enum(["true", "false"]).default("false"),
  E2E_TEST_AUTH_EMAIL: z
    .string()
    .email("deve ser um e-mail válido")
    .default("e2e-auth@example.test"),
  E2E_TEST_AUTH_NAME: z.string().min(1).default("E2E Google User"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export const publicEnvSchema = z.object({
  NEXT_PUBLIC_APP_NAME: z.string().min(1).default("Finanças Gomes"),
  // Optional when the browser and API share an origin; when set it points to
  // the environment-specific Better Auth server base URL (never a secret).
  NEXT_PUBLIC_BETTER_AUTH_URL: optionalUrl,
  NEXT_PUBLIC_SENTRY_DSN: optionalUrl,
  NEXT_PUBLIC_SENTRY_ENVIRONMENT: z.string().min(1).default("development"),
  NEXT_PUBLIC_SENTRY_RELEASE: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).optional(),
  ),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

function formatConfigurationError(
  issues: z.ZodIssue[],
): Error {
  const details = issues.map((issue) => {
    const key = issue.path.length > 0 ? issue.path.join(".") : "ambiente";
    return `- ${key}: ${issue.message}`;
  });

  return new Error(
    [
      "Configuração de ambiente inválida.",
      "Defina as variáveis obrigatórias no arquivo .env.local:",
      ...details,
    ].join("\n"),
  );
}

/**
 * Parses server configuration without exposing raw environment values in errors.
 * Keep this function pure so startup checks and tests can use the same contract.
 */
export function parseServerEnv(
  rawEnv: Record<string, string | undefined>,
): ServerEnv {
  const result = serverEnvSchema.safeParse(rawEnv);
  if (!result.success) {
    throw formatConfigurationError(result.error.issues);
  }

  return result.data;
}

let cachedServerEnv: ServerEnv | undefined;

/** Lazily validates runtime configuration when a server integration needs it. */
export function getServerEnv(): ServerEnv {
  cachedServerEnv ??= parseServerEnv(process.env);
  return cachedServerEnv;
}

/**
 * Enables the deterministic Google provider only for a local/test Playwright
 * server. The Vercel deployment marker is checked as an additional defense
 * because Preview commonly runs with `NODE_ENV=production` as well.
 */
export function isE2ETestAuthEnabled(
  env: Pick<ServerEnv, "NODE_ENV" | "E2E_TEST_AUTH_ENABLED"> = getServerEnv(),
): boolean {
  const deploymentEnvironment = process.env.VERCEL_ENV;

  return (
    (env.NODE_ENV === "development" || env.NODE_ENV === "test") &&
    env.E2E_TEST_AUTH_ENABLED === "true" &&
    deploymentEnvironment !== "preview" &&
    deploymentEnvironment !== "production"
  );
}

export function parsePublicEnv(
  rawEnv: Record<string, string | undefined>,
): PublicEnv {
  const result = publicEnvSchema.safeParse(rawEnv);
  if (!result.success) {
    throw formatConfigurationError(result.error.issues);
  }

  return result.data;
}

export function getPublicEnv(): PublicEnv {
  return parsePublicEnv(process.env);
}
