#!/bin/sh
# Runs only when the official Postgres image initializes an empty data directory.
set -eu

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  --set=mend_password="$MEND_DB_PASSWORD" \
  --set=sealant_password="$SEALANT_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE mend LOGIN PASSWORD %L', :'mend_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'mend') \gexec
ALTER ROLE mend LOGIN PASSWORD :'mend_password';

SELECT format('CREATE ROLE sealant LOGIN PASSWORD %L', :'sealant_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sealant') \gexec
ALTER ROLE sealant LOGIN PASSWORD :'sealant_password';

SELECT 'CREATE DATABASE mend OWNER mend'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'mend') \gexec
SELECT 'CREATE DATABASE sealant_control_plane OWNER sealant'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'sealant_control_plane') \gexec
SQL
