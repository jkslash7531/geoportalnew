#!/usr/bin/env bash
# Create the external data volumes once. Safe to re-run (idempotent).
# After this, `docker compose up --build` works and
# `docker compose down -v` will NEVER delete your uploaded layers or database.
set -euo pipefail

VOLUMES=(
  kmc_gis_server_pg_data
  kmc_gis_server_upload_data
  kmc_gis_server_tileserver_data
)

for v in "${VOLUMES[@]}"; do
  if docker volume inspect "$v" >/dev/null 2>&1; then
    echo "exists: $v"
  else
    docker volume create "$v" >/dev/null
    echo "created: $v"
  fi
done

echo "done."
