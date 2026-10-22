#!/usr/bin/env bash

set -Eeuo pipefail

# The official postgres image runs this file only on first-volume initialization.
# The default service sets the gate to 0 so its cluster remains available to the
# Phase 7 integration runner, which owns temporary wrappers.

if [[ "${PHASE7_LOCAL_PROVISIONING:-0}" != '1' ]]; then
  echo 'Phase 7 local provisioning disabled for this PostgreSQL volume.'
  exit 0
fi

phase7_fail() {
  echo "Phase 7 local provisioning refused: $1" >&2
  return 1
}

if [[ "${POSTGRES_DB:-}" != 'nihongo_dev' ]]; then
  phase7_fail 'POSTGRES_DB must be the canonical nihongo_dev database.'
fi

case "${POSTGRES_USER:-}" in
  nihongo_phase7_owner | nihongo_phase7_migration | nihongo_app | \
    nihongo_auth_gateway | nihongo_erasure_worker | \
    nihongo_test_phase7_migration_login | nihongo_test_app_login | \
    nihongo_test_auth_gateway_login | nihongo_test_erasure_worker_login | \
    nihongo_test_legacy_app_login | \
    nihongo_development_phase7_migration_login | \
    nihongo_development_app_login | \
    nihongo_development_auth_gateway_login | \
    nihongo_development_erasure_worker_login | \
    nihongo_development_legacy_app_login)
    phase7_fail 'POSTGRES_USER overlaps the protected Phase 7 role graph.'
    ;;
esac

phase7_secret_names=(
  POSTGRES_PASSWORD
  PHASE7_TEST_MIGRATION_PASSWORD
  PHASE7_TEST_APP_PASSWORD
  PHASE7_TEST_AUTH_GATEWAY_PASSWORD
  PHASE7_TEST_ERASURE_WORKER_PASSWORD
  PHASE7_TEST_LEGACY_APP_PASSWORD
  PHASE7_DEVELOPMENT_MIGRATION_PASSWORD
  PHASE7_DEVELOPMENT_APP_PASSWORD
  PHASE7_DEVELOPMENT_AUTH_GATEWAY_PASSWORD
  PHASE7_DEVELOPMENT_ERASURE_WORKER_PASSWORD
  PHASE7_DEVELOPMENT_LEGACY_APP_PASSWORD
)
phase7_secret_values=()

for phase7_secret_name in "${phase7_secret_names[@]}"; do
  phase7_secret_value="${!phase7_secret_name:-}"
  if [[ ${#phase7_secret_value} -lt 24 ]]; then
    phase7_fail "${phase7_secret_name} must contain at least 24 characters."
  fi
  case "$phase7_secret_value" in
    replace_me* | change_me* | *[!A-Za-z0-9._~-]*)
      phase7_fail \
        "${phase7_secret_name} must be a non-placeholder URL-safe local secret."
      ;;
  esac
  for phase7_prior_secret in "${phase7_secret_values[@]}"; do
    if [[ "$phase7_secret_value" == "$phase7_prior_secret" ]]; then
      phase7_fail 'bootstrap and wrapper secrets must all be distinct.'
    fi
  done
  phase7_secret_values+=("$phase7_secret_value")
done

psql --set=ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname postgres \
  --set=test_migration_password="$PHASE7_TEST_MIGRATION_PASSWORD" \
  --set=test_app_password="$PHASE7_TEST_APP_PASSWORD" \
  --set=test_auth_gateway_password="$PHASE7_TEST_AUTH_GATEWAY_PASSWORD" \
  --set=test_erasure_worker_password="$PHASE7_TEST_ERASURE_WORKER_PASSWORD" \
  --set=test_legacy_app_password="$PHASE7_TEST_LEGACY_APP_PASSWORD" \
  --set=development_migration_password="$PHASE7_DEVELOPMENT_MIGRATION_PASSWORD" \
  --set=development_app_password="$PHASE7_DEVELOPMENT_APP_PASSWORD" \
  --set=development_auth_gateway_password="$PHASE7_DEVELOPMENT_AUTH_GATEWAY_PASSWORD" \
  --set=development_erasure_worker_password="$PHASE7_DEVELOPMENT_ERASURE_WORKER_PASSWORD" \
  --set=development_legacy_app_password="$PHASE7_DEVELOPMENT_LEGACY_APP_PASSWORD" <<'PHASE7_ROLES_SQL'
BEGIN;

CREATE ROLE "nihongo_phase7_owner"
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;
CREATE ROLE "nihongo_phase7_migration"
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;
CREATE ROLE "nihongo_app"
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;
CREATE ROLE "nihongo_auth_gateway"
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;
CREATE ROLE "nihongo_erasure_worker"
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;

GRANT "nihongo_phase7_owner" TO "nihongo_phase7_migration"
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;

CREATE ROLE "nihongo_test_phase7_migration_login"
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS PASSWORD :'test_migration_password';
CREATE ROLE "nihongo_test_app_login"
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS PASSWORD :'test_app_password';
CREATE ROLE "nihongo_test_auth_gateway_login"
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS PASSWORD :'test_auth_gateway_password';
CREATE ROLE "nihongo_test_erasure_worker_login"
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS PASSWORD :'test_erasure_worker_password';
CREATE ROLE "nihongo_test_legacy_app_login"
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS PASSWORD :'test_legacy_app_password';

CREATE ROLE "nihongo_development_phase7_migration_login"
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS PASSWORD :'development_migration_password';
CREATE ROLE "nihongo_development_app_login"
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS PASSWORD :'development_app_password';
CREATE ROLE "nihongo_development_auth_gateway_login"
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS PASSWORD :'development_auth_gateway_password';
CREATE ROLE "nihongo_development_erasure_worker_login"
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS PASSWORD :'development_erasure_worker_password';
CREATE ROLE "nihongo_development_legacy_app_login"
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS PASSWORD :'development_legacy_app_password';

GRANT "nihongo_phase7_migration" TO "nihongo_test_phase7_migration_login"
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
GRANT "nihongo_app" TO "nihongo_test_app_login"
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
GRANT "nihongo_auth_gateway" TO "nihongo_test_auth_gateway_login"
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
GRANT "nihongo_erasure_worker" TO "nihongo_test_erasure_worker_login"
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
GRANT "nihongo_phase7_migration" TO "nihongo_development_phase7_migration_login"
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
GRANT "nihongo_app" TO "nihongo_development_app_login"
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
GRANT "nihongo_auth_gateway" TO "nihongo_development_auth_gateway_login"
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
GRANT "nihongo_erasure_worker" TO "nihongo_development_erasure_worker_login"
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;

DO $phase7_role_attestation$
DECLARE
  exact_group_count INTEGER;
  exact_wrapper_count INTEGER;
  expected_membership_count INTEGER;
  unexpected_membership_count INTEGER;
BEGIN
  SELECT count(*)::INTEGER INTO exact_group_count
  FROM pg_catalog.pg_roles AS role_row
  WHERE role_row.rolname IN (
    'nihongo_phase7_owner', 'nihongo_phase7_migration', 'nihongo_app',
    'nihongo_auth_gateway', 'nihongo_erasure_worker'
  )
    AND NOT role_row.rolcanlogin
    AND NOT role_row.rolinherit
    AND NOT role_row.rolsuper
    AND NOT role_row.rolcreatedb
    AND NOT role_row.rolcreaterole
    AND NOT role_row.rolreplication
    AND NOT role_row.rolbypassrls
    AND role_row.rolconfig IS NULL;

  SELECT count(*)::INTEGER INTO exact_wrapper_count
  FROM pg_catalog.pg_roles AS role_row
  WHERE role_row.rolname IN (
    'nihongo_test_phase7_migration_login', 'nihongo_test_app_login',
    'nihongo_test_auth_gateway_login', 'nihongo_test_erasure_worker_login',
    'nihongo_test_legacy_app_login',
    'nihongo_development_phase7_migration_login',
    'nihongo_development_app_login',
    'nihongo_development_auth_gateway_login',
    'nihongo_development_erasure_worker_login',
    'nihongo_development_legacy_app_login'
  )
    AND role_row.rolcanlogin
    AND NOT role_row.rolinherit
    AND NOT role_row.rolsuper
    AND NOT role_row.rolcreatedb
    AND NOT role_row.rolcreaterole
    AND NOT role_row.rolreplication
    AND NOT role_row.rolbypassrls
    AND role_row.rolconfig IS NULL;

  SELECT count(*)::INTEGER INTO expected_membership_count
  FROM (VALUES
    ('nihongo_phase7_migration', 'nihongo_phase7_owner'),
    ('nihongo_test_phase7_migration_login', 'nihongo_phase7_migration'),
    ('nihongo_test_app_login', 'nihongo_app'),
    ('nihongo_test_auth_gateway_login', 'nihongo_auth_gateway'),
    ('nihongo_test_erasure_worker_login', 'nihongo_erasure_worker'),
    ('nihongo_development_phase7_migration_login', 'nihongo_phase7_migration'),
    ('nihongo_development_app_login', 'nihongo_app'),
    ('nihongo_development_auth_gateway_login', 'nihongo_auth_gateway'),
    ('nihongo_development_erasure_worker_login', 'nihongo_erasure_worker')
  ) AS expected(member_name, granted_name)
  WHERE EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS member_role
      ON member_role.oid = membership.member
    JOIN pg_catalog.pg_roles AS granted_role
      ON granted_role.oid = membership.roleid
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
  WHERE (
    member_role.rolname IN (
      'nihongo_phase7_owner', 'nihongo_phase7_migration', 'nihongo_app',
      'nihongo_auth_gateway', 'nihongo_erasure_worker',
      'nihongo_test_phase7_migration_login', 'nihongo_test_app_login',
      'nihongo_test_auth_gateway_login', 'nihongo_test_erasure_worker_login',
      'nihongo_test_legacy_app_login',
      'nihongo_development_phase7_migration_login',
      'nihongo_development_app_login',
      'nihongo_development_auth_gateway_login',
      'nihongo_development_erasure_worker_login',
      'nihongo_development_legacy_app_login'
    )
    OR granted_role.rolname IN (
      'nihongo_phase7_owner', 'nihongo_phase7_migration', 'nihongo_app',
      'nihongo_auth_gateway', 'nihongo_erasure_worker'
    )
  )
    AND NOT EXISTS (
      SELECT 1
      FROM (VALUES
        ('nihongo_phase7_migration', 'nihongo_phase7_owner'),
        ('nihongo_test_phase7_migration_login', 'nihongo_phase7_migration'),
        ('nihongo_test_app_login', 'nihongo_app'),
        ('nihongo_test_auth_gateway_login', 'nihongo_auth_gateway'),
        ('nihongo_test_erasure_worker_login', 'nihongo_erasure_worker'),
        ('nihongo_development_phase7_migration_login', 'nihongo_phase7_migration'),
        ('nihongo_development_app_login', 'nihongo_app'),
        ('nihongo_development_auth_gateway_login', 'nihongo_auth_gateway'),
        ('nihongo_development_erasure_worker_login', 'nihongo_erasure_worker')
      ) AS allowed(member_name, granted_name)
      WHERE allowed.member_name = member_role.rolname
        AND allowed.granted_name = granted_role.rolname
        AND NOT membership.admin_option
        AND NOT membership.inherit_option
        AND membership.set_option
    );

  IF exact_group_count <> 5
    OR exact_wrapper_count <> 10
    OR expected_membership_count <> 9
    OR unexpected_membership_count <> 0 THEN
    RAISE EXCEPTION 'Phase 7 local role graph attestation failed.';
  END IF;
END;
$phase7_role_attestation$;

COMMIT;
PHASE7_ROLES_SQL

for phase7_database_name in nihongo_dev nihongo_test; do
  case "$phase7_database_name" in
    nihongo_dev)
      phase7_migration_login='nihongo_development_phase7_migration_login'
      phase7_app_login='nihongo_development_app_login'
      phase7_auth_gateway_login='nihongo_development_auth_gateway_login'
      phase7_erasure_worker_login='nihongo_development_erasure_worker_login'
      phase7_legacy_app_login='nihongo_development_legacy_app_login'
      ;;
    nihongo_test)
      phase7_migration_login='nihongo_test_phase7_migration_login'
      phase7_app_login='nihongo_test_app_login'
      phase7_auth_gateway_login='nihongo_test_auth_gateway_login'
      phase7_erasure_worker_login='nihongo_test_erasure_worker_login'
      phase7_legacy_app_login='nihongo_test_legacy_app_login'
      ;;
  esac

  psql --set=ON_ERROR_STOP=1 \
    --username "$POSTGRES_USER" \
    --dbname "$phase7_database_name" <<'PHASE7_SCHEMA_SQL'
CREATE EXTENSION pgcrypto WITH SCHEMA public;
ALTER SCHEMA public OWNER TO "nihongo_phase7_migration";
PHASE7_SCHEMA_SQL

  psql --set=ON_ERROR_STOP=1 \
    --username "$POSTGRES_USER" \
    --dbname postgres \
    --set=bootstrap_user="$POSTGRES_USER" \
    --set=target_database="$phase7_database_name" \
    --set=migration_login="$phase7_migration_login" \
    --set=app_login="$phase7_app_login" \
    --set=auth_gateway_login="$phase7_auth_gateway_login" \
    --set=erasure_worker_login="$phase7_erasure_worker_login" \
    --set=legacy_app_login="$phase7_legacy_app_login" <<'PHASE7_DATABASE_SQL'
ALTER DATABASE :"target_database" OWNER TO "nihongo_phase7_migration";
REVOKE ALL PRIVILEGES ON DATABASE :"target_database" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON DATABASE :"target_database"
  FROM :"bootstrap_user";
REVOKE ALL PRIVILEGES ON DATABASE :"target_database"
  FROM "nihongo_phase7_migration";
GRANT CREATE, TEMPORARY ON DATABASE :"target_database"
  TO "nihongo_phase7_migration";
GRANT CONNECT ON DATABASE :"target_database"
  TO :"migration_login", :"app_login", :"auth_gateway_login",
    :"erasure_worker_login", :"legacy_app_login";
PHASE7_DATABASE_SQL

  psql --set=ON_ERROR_STOP=1 \
    --username "$POSTGRES_USER" \
    --dbname "$phase7_database_name" <<'PHASE7_ATTEST_SQL'
DO $phase7_local_attestation$
DECLARE
  wrapper_prefix TEXT := CASE
    WHEN current_database() = 'nihongo_test' THEN 'nihongo_test'
    WHEN current_database() = 'nihongo_dev' THEN 'nihongo_development'
    ELSE NULL
  END;
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

  IF wrapper_prefix IS NULL
    OR database_owner <> 'nihongo_phase7_migration'
    OR schema_owner <> 'nihongo_phase7_migration'
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_extension AS extension
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = extension.extnamespace
      WHERE extension.extname = 'pgcrypto' AND namespace.nspname = 'public'
    ) THEN
    RAISE EXCEPTION 'Phase 7 local owner/schema/pgcrypto attestation failed.';
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
      grantee_role.rolname = 'nihongo_phase7_migration'
        AND acl_entry.privilege_type IN ('CREATE', 'TEMPORARY')
        AND NOT acl_entry.is_grantable
      OR grantee_role.rolname IN (
        wrapper_prefix || '_phase7_migration_login',
        wrapper_prefix || '_app_login',
        wrapper_prefix || '_auth_gateway_login',
        wrapper_prefix || '_erasure_worker_login',
        wrapper_prefix || '_legacy_app_login'
      ) AND acl_entry.privilege_type = 'CONNECT'
        AND NOT acl_entry.is_grantable
    );

  SELECT count(*)::INTEGER INTO missing_acl_count
  FROM (VALUES
    (wrapper_prefix || '_phase7_migration_login', 'CONNECT'),
    ('nihongo_phase7_migration', 'CREATE'),
    ('nihongo_phase7_migration', 'TEMPORARY'),
    (wrapper_prefix || '_app_login', 'CONNECT'),
    (wrapper_prefix || '_auth_gateway_login', 'CONNECT'),
    (wrapper_prefix || '_erasure_worker_login', 'CONNECT'),
    (wrapper_prefix || '_legacy_app_login', 'CONNECT')
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
    RAISE EXCEPTION 'Phase 7 local database ACL attestation failed.';
  END IF;
END;
$phase7_local_attestation$;
PHASE7_ATTEST_SQL
done

touch "$PGDATA/.phase7-local-provisioned"
echo 'Phase 7 local TEST/DEVELOPMENT role and database provisioning attested.'
