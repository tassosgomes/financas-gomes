#!/usr/bin/env bash
# Per-boot startup: bring up the local PostgreSQL cluster and wait until it is
# ready. Migrations and dependency installation are handled by install.sh.
set -euo pipefail

sudo pg_ctlcluster 16 main start 2>/dev/null || true

for _ in $(seq 1 30); do
  if pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
    echo "PostgreSQL is ready on localhost:5432"
    exit 0
  fi
  sleep 1
done

echo "PostgreSQL did not become ready in time" >&2
exit 1
