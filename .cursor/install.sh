#!/usr/bin/env bash
# Idempotent repository bootstrap for the Cloud Agent environment.
# Installs dependencies, prepares a local PostgreSQL, seeds a development
# .env.local, and applies migrations to the development and test databases.
set -euo pipefail

# Always operate from the repository root regardless of the invocation cwd.
cd "$(dirname "$0")/.."

DEV_DB="financas_gomes"
TEST_DB="financas_gomes_test"

echo "==> Installing Node dependencies (npm ci)"
npm ci

echo "==> Ensuring local development .env.local"
if [ ! -f .env.local ]; then
  cp .env.example .env.local
  # A local-only Better Auth secret (never a real credential).
  secret="$(openssl rand -hex 32)"
  sed -i "s#^BETTER_AUTH_SECRET=.*#BETTER_AUTH_SECRET=${secret}#" .env.local
  # Enable the built-in local test-auth provider so the app is usable end to
  # end without configuring real Google OAuth credentials.
  sed -i 's#^E2E_TEST_AUTH_ENABLED=.*#E2E_TEST_AUTH_ENABLED=true#' .env.local
  # A single local PostgreSQL cluster on 5432 serves both databases here.
  sed -i 's#^POSTGRES_TEST_PORT=.*#POSTGRES_TEST_PORT=5432#' .env.local
  sed -i "s#^E2E_DATABASE_URL=.*#E2E_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/${TEST_DB}#" .env.local
fi

echo "==> Starting PostgreSQL"
sudo pg_ctlcluster 16 main start 2>/dev/null || true
for _ in $(seq 1 30); do
  if pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
pg_isready -h localhost -p 5432

echo "==> Ensuring database role and databases"
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "ALTER USER postgres WITH PASSWORD 'postgres';"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DEV_DB}'" | grep -q 1 \
  || sudo -u postgres createdb "${DEV_DB}"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${TEST_DB}'" | grep -q 1 \
  || sudo -u postgres createdb "${TEST_DB}"

echo "==> Applying migrations to the development database (${DEV_DB})"
npm run db:migrate:local

echo "==> Applying migrations to the test database (${TEST_DB})"
# The migration CLI loads .env.local with override, so target the test
# database through MIGRATION_DATABASE_URL set there, then restore the file.
cp .env.local .env.local.bak
sed -i "s#^MIGRATION_DATABASE_URL=.*#MIGRATION_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/${TEST_DB}#" .env.local
npm run db:migrate:deploy
mv .env.local.bak .env.local

echo "==> Install complete"
