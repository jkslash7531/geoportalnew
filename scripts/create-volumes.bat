@echo off
REM Create the external data volumes once. Safe to re-run (idempotent).
REM After this, `docker compose up --build` works and
REM `docker compose down -v` will NEVER delete your uploaded layers or database.
setlocal

for %%V in (kmc_gis_server_pg_data kmc_gis_server_upload_data kmc_gis_server_tileserver_data) do (
  docker volume inspect %%V >nul 2>&1
  if errorlevel 1 (
    docker volume create %%V >nul
    echo created: %%V
  ) else (
    echo exists: %%V
  )
)

echo done.
