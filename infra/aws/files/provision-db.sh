#!/bin/bash
# provision-db.sh: create or repair the production role graph on DB nihongo, then
# attest it exactly. deploy.sh runs it on every deploy, before migrate.sh; a drifted
# graph stops the deploy. Same graph as infra/postgres/init/02-provision-local-database.sh
# with nihongo_production_* wrappers. Passwords come from /run/harumaru/provision.env
# (SSM) and reach psql on stdin only, never on a command line.
set -euo pipefail
cd /opt/harumaru

fail() {
  echo "provision-db refused: $1" >&2
  exit 1
}

names=(PROD_MIGRATION_LOGIN_PASSWORD PROD_APP_LOGIN_PASSWORD PROD_GUEST_CLEANUP_LOGIN_PASSWORD)

# SSM values are data: read KEY=VALUE lines literally, never `source` them, so a
# value such as $(...) or `...` is not run by the shell. Only the listed keys load.
load_env() {
  local file="$1" line key value
  shift
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    [[ "$line" == *=* && " $* " == *" $key "* ]] || fail "unexpected line in $file"
    printf -v "$key" '%s' "$value"
    export "${key?}"
  done < "$file"
}

load_env /run/harumaru/provision.env "${names[@]}"

seen=()
for name in "${names[@]}"; do
  value="${!name:-}"
  [[ ${#value} -ge 24 ]] || fail "$name must contain at least 24 characters."
  case "$value" in
    replace_me* | change_me* | *[!A-Za-z0-9._~-]*)
      fail "$name must be a non-placeholder URL-safe secret." ;;
  esac
  for prior in ${seen[@]+"${seen[@]}"}; do
    [[ "$value" != "$prior" ]] || fail 'wrapper passwords must all be distinct.'
  done
  seen+=("$value")
done

# The connection URLs the API and the migration use must name the same wrappers
# and passwords, or the first connection after this script would fail.
python3 - <<'CHECK_PY' || fail 'DATABASE_URL / MIGRATION_DATABASE_URL do not match the wrapper logins.'
import os, sys
from urllib.parse import unquote, urlsplit

def read_env(path):
    with open(path) as handle:
        return dict(line.rstrip("\n").partition("=")[::2] for line in handle if "=" in line)

# Each URL from the file whose container uses it (migrate.env holds the runtime
# URL without its password, for the migration guard only).
expected = [
    ("/run/harumaru/api.env", "DATABASE_URL", "nihongo_production_app_login", "PROD_APP_LOGIN_PASSWORD"),
    ("/run/harumaru/migrate.env", "MIGRATION_DATABASE_URL", "nihongo_production_migration_login", "PROD_MIGRATION_LOGIN_PASSWORD"),
]
for path, key, login, secret in expected:
    url = urlsplit(read_env(path).get(key, ""))
    if unquote(url.username or "") != login or unquote(url.password or "") != os.environ[secret]:
        sys.exit(1)
    if url.path != "/nihongo":
        sys.exit(1)
CHECK_PY

psql_admin() {
  docker compose exec -T -e PGOPTIONS='-c client_min_messages=warning' postgres \
    psql --set=ON_ERROR_STOP=1 --quiet \
    --username postgres --dbname "$1"
}

{
  printf "\\set migration_password '%s'\n" "$PROD_MIGRATION_LOGIN_PASSWORD"
  printf "\\set app_password '%s'\n" "$PROD_APP_LOGIN_PASSWORD"
  printf "\\set guest_cleanup_password '%s'\n" "$PROD_GUEST_CLEANUP_LOGIN_PASSWORD"
  cat <<'ROLES_SQL'
BEGIN;
-- Keep the PASSWORD statements below out of the server log if anything fails.
SET LOCAL log_min_error_statement = panic;

SELECT format(
  'CREATE ROLE %I NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
  group_name)
FROM unnest(ARRAY[
  'nihongo_owner', 'nihongo_migration', 'nihongo_app', 'nihongo_guest_cleanup_worker'
]) AS group_name
WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = group_name)
\gexec

SELECT format(
  'CREATE ROLE %I LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
  wrapper_name)
FROM unnest(ARRAY[
  'nihongo_production_migration_login', 'nihongo_production_app_login',
  'nihongo_production_guest_cleanup_worker_login'
]) AS wrapper_name
WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = wrapper_name)
\gexec

-- Re-applied every run: a rotated SSM password takes effect on the next deploy.
ALTER ROLE "nihongo_production_migration_login" PASSWORD :'migration_password';
ALTER ROLE "nihongo_production_app_login" PASSWORD :'app_password';
ALTER ROLE "nihongo_production_guest_cleanup_worker_login" PASSWORD :'guest_cleanup_password';

GRANT "nihongo_owner" TO "nihongo_migration"
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
GRANT "nihongo_migration" TO "nihongo_production_migration_login"
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
GRANT "nihongo_app" TO "nihongo_production_app_login"
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
GRANT "nihongo_guest_cleanup_worker" TO "nihongo_production_guest_cleanup_worker_login"
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;

DO $role_attestation$
DECLARE
  group_names TEXT[] := ARRAY[
    'nihongo_owner', 'nihongo_migration', 'nihongo_app',
    'nihongo_guest_cleanup_worker'
  ];
  wrapper_names TEXT[] := ARRAY[
    'nihongo_production_migration_login', 'nihongo_production_app_login',
    'nihongo_production_guest_cleanup_worker_login'
  ];
  exact_group_count INTEGER;
  exact_wrapper_count INTEGER;
  expected_membership_count INTEGER;
  unexpected_membership_count INTEGER;
BEGIN
  SELECT count(*)::INTEGER INTO exact_group_count
  FROM pg_catalog.pg_roles AS role_row
  WHERE role_row.rolname = ANY (group_names)
    AND NOT role_row.rolcanlogin AND NOT role_row.rolinherit
    AND NOT role_row.rolsuper AND NOT role_row.rolcreatedb
    AND NOT role_row.rolcreaterole AND NOT role_row.rolreplication
    AND NOT role_row.rolbypassrls AND role_row.rolconfig IS NULL;

  SELECT count(*)::INTEGER INTO exact_wrapper_count
  FROM pg_catalog.pg_roles AS role_row
  WHERE role_row.rolname = ANY (wrapper_names)
    AND role_row.rolcanlogin AND NOT role_row.rolinherit
    AND NOT role_row.rolsuper AND NOT role_row.rolcreatedb
    AND NOT role_row.rolcreaterole AND NOT role_row.rolreplication
    AND NOT role_row.rolbypassrls AND role_row.rolconfig IS NULL;

  CREATE TEMPORARY TABLE expected_membership (
    member_name TEXT, granted_name TEXT
  ) ON COMMIT DROP;
  INSERT INTO expected_membership VALUES
    ('nihongo_migration', 'nihongo_owner'),
    ('nihongo_production_migration_login', 'nihongo_migration'),
    ('nihongo_production_app_login', 'nihongo_app'),
    ('nihongo_production_guest_cleanup_worker_login', 'nihongo_guest_cleanup_worker');

  SELECT count(*)::INTEGER INTO expected_membership_count
  FROM expected_membership AS expected
  WHERE EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS member_role ON member_role.oid = membership.member
    JOIN pg_catalog.pg_roles AS granted_role ON granted_role.oid = membership.roleid
    WHERE member_role.rolname = expected.member_name
      AND granted_role.rolname = expected.granted_name
      AND NOT membership.admin_option
      AND NOT membership.inherit_option
      AND membership.set_option
  );

  SELECT count(*)::INTEGER INTO unexpected_membership_count
  FROM pg_catalog.pg_auth_members AS membership
  JOIN pg_catalog.pg_roles AS member_role ON member_role.oid = membership.member
  JOIN pg_catalog.pg_roles AS granted_role ON granted_role.oid = membership.roleid
  -- Wrappers are leaves: no role may be granted a wrapper (QA #626 note 2).
  WHERE (
    member_role.rolname = ANY (group_names || wrapper_names)
    OR granted_role.rolname = ANY (group_names || wrapper_names)
  )
    AND NOT EXISTS (
      SELECT 1
      FROM expected_membership AS allowed
      WHERE allowed.member_name = member_role.rolname
        AND allowed.granted_name = granted_role.rolname
        AND NOT membership.admin_option
        AND NOT membership.inherit_option
        AND membership.set_option
    );

  IF exact_group_count <> 4
    OR exact_wrapper_count <> 3
    OR expected_membership_count <> 4
    OR unexpected_membership_count <> 0 THEN
    RAISE EXCEPTION 'Production role graph attestation failed.';
  END IF;
END;
$role_attestation$;

COMMIT;
ROLES_SQL
} | psql_admin postgres

# Before the baseline the migration role must own public; the baseline then hands
# it to nihongo_owner. Only a fresh schema is reassigned.
psql_admin nihongo <<'SCHEMA_SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
DO $schema_owner$
BEGIN
  IF (SELECT owner_role.rolname
      FROM pg_catalog.pg_namespace AS namespace
      JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = namespace.nspowner
      WHERE namespace.nspname = 'public') NOT IN ('nihongo_migration', 'nihongo_owner') THEN
    ALTER SCHEMA public OWNER TO "nihongo_migration";
  END IF;
END;
$schema_owner$;
SCHEMA_SQL

psql_admin postgres <<'DATABASE_SQL'
ALTER DATABASE "nihongo" OWNER TO "nihongo_migration";
REVOKE ALL PRIVILEGES ON DATABASE "nihongo" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON DATABASE "nihongo" FROM "postgres";
REVOKE ALL PRIVILEGES ON DATABASE "nihongo" FROM "nihongo_migration";
GRANT CREATE, TEMPORARY ON DATABASE "nihongo" TO "nihongo_migration";
GRANT CONNECT ON DATABASE "nihongo" TO
  "nihongo_production_migration_login", "nihongo_production_app_login",
  "nihongo_production_guest_cleanup_worker_login";
DATABASE_SQL

psql_admin nihongo <<'ATTEST_SQL'
DO $production_attestation$
DECLARE
  database_owner TEXT;
  schema_owner TEXT;
  unexpected_acl_count INTEGER;
  missing_acl_count INTEGER;
BEGIN
  SELECT owner_role.rolname INTO database_owner
  FROM pg_catalog.pg_database AS database_row
  JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = database_row.datdba
  WHERE database_row.datname = current_database();
  SELECT owner_role.rolname INTO schema_owner
  FROM pg_catalog.pg_namespace AS namespace
  JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = namespace.nspowner
  WHERE namespace.nspname = 'public';

  IF current_database() <> 'nihongo'
    OR database_owner <> 'nihongo_migration'
    OR schema_owner NOT IN ('nihongo_migration', 'nihongo_owner')
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_extension AS extension
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = extension.extnamespace
      WHERE extension.extname = 'pgcrypto' AND namespace.nspname = 'public'
    ) THEN
    RAISE EXCEPTION 'Production owner/schema/pgcrypto attestation failed.';
  END IF;

  SELECT count(*)::INTEGER INTO unexpected_acl_count
  FROM pg_catalog.pg_database AS database_row
  CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
    database_row.datacl,
    pg_catalog.acldefault('d', database_row.datdba)
  )) AS acl_entry
  LEFT JOIN pg_catalog.pg_roles AS grantee_role
    ON grantee_role.oid = acl_entry.grantee
  WHERE database_row.datname = current_database()
    AND NOT (
      grantee_role.rolname = 'nihongo_migration'
        AND acl_entry.privilege_type IN ('CREATE', 'TEMPORARY')
        AND NOT acl_entry.is_grantable
      OR grantee_role.rolname IN (
        'nihongo_production_migration_login',
        'nihongo_production_app_login',
        'nihongo_production_guest_cleanup_worker_login'
      ) AND acl_entry.privilege_type = 'CONNECT'
        AND NOT acl_entry.is_grantable
    );

  SELECT count(*)::INTEGER INTO missing_acl_count
  FROM (VALUES
    ('nihongo_production_migration_login', 'CONNECT'),
    ('nihongo_migration', 'CREATE'),
    ('nihongo_migration', 'TEMPORARY'),
    ('nihongo_production_app_login', 'CONNECT'),
    ('nihongo_production_guest_cleanup_worker_login', 'CONNECT')
  ) AS expected(grantee_name, privilege_type)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_database AS database_row
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
      database_row.datacl,
      pg_catalog.acldefault('d', database_row.datdba)
    )) AS acl_entry
    JOIN pg_catalog.pg_roles AS grantee_role
      ON grantee_role.oid = acl_entry.grantee
    WHERE database_row.datname = current_database()
      AND grantee_role.rolname = expected.grantee_name
      AND acl_entry.privilege_type = expected.privilege_type
      AND NOT acl_entry.is_grantable
  );

  IF unexpected_acl_count <> 0 OR missing_acl_count <> 0 THEN
    RAISE EXCEPTION 'Production database ACL attestation failed.';
  END IF;
END;
$production_attestation$;
ATTEST_SQL

echo 'production role graph and database ACL attested'
