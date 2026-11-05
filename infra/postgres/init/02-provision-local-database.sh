#!/usr/bin/env bash

set -Eeuo pipefail

# The official postgres image runs this file only on first-volume initialization.
# The default service sets the gate to 0 so its cluster remains available to the
# integration runner, which owns temporary wrappers.

if [[ "${PHASE7_LOCAL_PROVISIONING:-0}" != '1' ]]; then
  echo 'Local role provisioning disabled for this PostgreSQL volume.'
  exit 0
fi

provision_fail() {
  echo "Local role provisioning refused: $1" >&2
  return 1
}

if [[ "${POSTGRES_DB:-}" != 'nihongo_dev' ]]; then
  provision_fail 'POSTGRES_DB must be the canonical nihongo_dev database.'
fi

case "${POSTGRES_USER:-}" in
  nihongo_owner | nihongo_migration | nihongo_app | \
    nihongo_guest_cleanup_worker | \
    nihongo_test_migration_login | nihongo_test_app_login | \
    nihongo_test_guest_cleanup_worker_login | \
    nihongo_development_migration_login | nihongo_development_app_login | \
    nihongo_development_guest_cleanup_worker_login)
    provision_fail 'POSTGRES_USER overlaps the protected role graph.'
    ;;
esac

secret_names=(
  POSTGRES_PASSWORD
  PHASE7_TEST_MIGRATION_PASSWORD
  PHASE7_TEST_APP_PASSWORD
  PHASE7_TEST_GUEST_CLEANUP_WORKER_PASSWORD
  PHASE7_DEVELOPMENT_MIGRATION_PASSWORD
  PHASE7_DEVELOPMENT_APP_PASSWORD
  PHASE7_DEVELOPMENT_GUEST_CLEANUP_WORKER_PASSWORD
)
secret_values=()

for secret_name in "${secret_names[@]}"; do
  secret_value="${!secret_name:-}"
  if [[ ${#secret_value} -lt 24 ]]; then
    provision_fail "${secret_name} must contain at least 24 characters."
  fi
  case "$secret_value" in
    replace_me* | change_me* | *[!A-Za-z0-9._~-]*)
      provision_fail \
        "${secret_name} must be a non-placeholder URL-safe local secret."
      ;;
  esac
  for prior_secret in "${secret_values[@]}"; do
    if [[ "$secret_value" == "$prior_secret" ]]; then
      provision_fail 'bootstrap and wrapper secrets must all be distinct.'
    fi
  done
  secret_values+=("$secret_value")
done

psql --set=ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname postgres \
  --set=test_migration_password="$PHASE7_TEST_MIGRATION_PASSWORD" \
  --set=test_app_password="$PHASE7_TEST_APP_PASSWORD" \
  --set=test_guest_cleanup_worker_password="$PHASE7_TEST_GUEST_CLEANUP_WORKER_PASSWORD" \
  --set=development_migration_password="$PHASE7_DEVELOPMENT_MIGRATION_PASSWORD" \
  --set=development_app_password="$PHASE7_DEVELOPMENT_APP_PASSWORD" \
  --set=development_guest_cleanup_worker_password="$PHASE7_DEVELOPMENT_GUEST_CLEANUP_WORKER_PASSWORD" <<'ROLES_SQL'
BEGIN;

CREATE ROLE "nihongo_owner"
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;
CREATE ROLE "nihongo_migration"
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;
CREATE ROLE "nihongo_app"
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;
CREATE ROLE "nihongo_guest_cleanup_worker"
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;

GRANT "nihongo_owner" TO "nihongo_migration"
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;

CREATE ROLE "nihongo_test_migration_login"
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS PASSWORD :'test_migration_password';
CREATE ROLE "nihongo_test_app_login"
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS PASSWORD :'test_app_password';
CREATE ROLE "nihongo_test_guest_cleanup_worker_login"
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS PASSWORD :'test_guest_cleanup_worker_password';

CREATE ROLE "nihongo_development_migration_login"
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS PASSWORD :'development_migration_password';
CREATE ROLE "nihongo_development_app_login"
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS PASSWORD :'development_app_password';
CREATE ROLE "nihongo_development_guest_cleanup_worker_login"
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS PASSWORD :'development_guest_cleanup_worker_password';

GRANT "nihongo_migration" TO "nihongo_test_migration_login"
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
GRANT "nihongo_app" TO "nihongo_test_app_login"
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
GRANT "nihongo_guest_cleanup_worker" TO "nihongo_test_guest_cleanup_worker_login"
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
GRANT "nihongo_migration" TO "nihongo_development_migration_login"
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
GRANT "nihongo_app" TO "nihongo_development_app_login"
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
GRANT "nihongo_guest_cleanup_worker" TO "nihongo_development_guest_cleanup_worker_login"
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;

DO $role_attestation$
DECLARE
  group_names TEXT[] := ARRAY[
    'nihongo_owner', 'nihongo_migration', 'nihongo_app',
    'nihongo_guest_cleanup_worker'
  ];
  wrapper_names TEXT[] := ARRAY[
    'nihongo_test_migration_login', 'nihongo_test_app_login',
    'nihongo_test_guest_cleanup_worker_login',
    'nihongo_development_migration_login', 'nihongo_development_app_login',
    'nihongo_development_guest_cleanup_worker_login'
  ];
  exact_group_count INTEGER;
  exact_wrapper_count INTEGER;
  expected_membership_count INTEGER;
  unexpected_membership_count INTEGER;
BEGIN
  SELECT count(*)::INTEGER INTO exact_group_count
  FROM pg_catalog.pg_roles AS role_row
  WHERE role_row.rolname = ANY (group_names)
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
  WHERE role_row.rolname = ANY (wrapper_names)
    AND role_row.rolcanlogin
    AND NOT role_row.rolinherit
    AND NOT role_row.rolsuper
    AND NOT role_row.rolcreatedb
    AND NOT role_row.rolcreaterole
    AND NOT role_row.rolreplication
    AND NOT role_row.rolbypassrls
    AND role_row.rolconfig IS NULL;

  CREATE TEMPORARY TABLE expected_membership (
    member_name TEXT, granted_name TEXT
  ) ON COMMIT DROP;
  INSERT INTO expected_membership VALUES
    ('nihongo_migration', 'nihongo_owner'),
    ('nihongo_test_migration_login', 'nihongo_migration'),
    ('nihongo_test_app_login', 'nihongo_app'),
    ('nihongo_test_guest_cleanup_worker_login', 'nihongo_guest_cleanup_worker'),
    ('nihongo_development_migration_login', 'nihongo_migration'),
    ('nihongo_development_app_login', 'nihongo_app'),
    ('nihongo_development_guest_cleanup_worker_login', 'nihongo_guest_cleanup_worker');

  SELECT count(*)::INTEGER INTO expected_membership_count
  FROM expected_membership AS expected
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
    member_role.rolname = ANY (group_names || wrapper_names)
    OR granted_role.rolname = ANY (group_names)
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
    OR exact_wrapper_count <> 6
    OR expected_membership_count <> 7
    OR unexpected_membership_count <> 0 THEN
    RAISE EXCEPTION 'Local role graph attestation failed.';
  END IF;
END;
$role_attestation$;

COMMIT;
ROLES_SQL

for database_name in nihongo_dev nihongo_test; do
  case "$database_name" in
    nihongo_dev)
      migration_login='nihongo_development_migration_login'
      app_login='nihongo_development_app_login'
      guest_cleanup_login='nihongo_development_guest_cleanup_worker_login'
      ;;
    nihongo_test)
      migration_login='nihongo_test_migration_login'
      app_login='nihongo_test_app_login'
      guest_cleanup_login='nihongo_test_guest_cleanup_worker_login'
      ;;
  esac

  psql --set=ON_ERROR_STOP=1 \
    --username "$POSTGRES_USER" \
    --dbname "$database_name" <<'SCHEMA_SQL'
CREATE EXTENSION pgcrypto WITH SCHEMA public;
ALTER SCHEMA public OWNER TO "nihongo_migration";
SCHEMA_SQL

  psql --set=ON_ERROR_STOP=1 \
    --username "$POSTGRES_USER" \
    --dbname postgres \
    --set=bootstrap_user="$POSTGRES_USER" \
    --set=target_database="$database_name" \
    --set=migration_login="$migration_login" \
    --set=app_login="$app_login" \
    --set=guest_cleanup_login="$guest_cleanup_login" <<'DATABASE_SQL'
ALTER DATABASE :"target_database" OWNER TO "nihongo_migration";
REVOKE ALL PRIVILEGES ON DATABASE :"target_database" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON DATABASE :"target_database"
  FROM :"bootstrap_user";
REVOKE ALL PRIVILEGES ON DATABASE :"target_database"
  FROM "nihongo_migration";
GRANT CREATE, TEMPORARY ON DATABASE :"target_database"
  TO "nihongo_migration";
GRANT CONNECT ON DATABASE :"target_database"
  TO :"migration_login", :"app_login", :"guest_cleanup_login";
DATABASE_SQL

  psql --set=ON_ERROR_STOP=1 \
    --username "$POSTGRES_USER" \
    --dbname "$database_name" <<'ATTEST_SQL'
DO $local_attestation$
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
    OR database_owner <> 'nihongo_migration'
    OR schema_owner <> 'nihongo_migration'
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_extension AS extension
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = extension.extnamespace
      WHERE extension.extname = 'pgcrypto' AND namespace.nspname = 'public'
    ) THEN
    RAISE EXCEPTION 'Local owner/schema/pgcrypto attestation failed.';
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
        wrapper_prefix || '_migration_login',
        wrapper_prefix || '_app_login',
        wrapper_prefix || '_guest_cleanup_worker_login'
      ) AND acl_entry.privilege_type = 'CONNECT'
        AND NOT acl_entry.is_grantable
    );

  SELECT count(*)::INTEGER INTO missing_acl_count
  FROM (VALUES
    (wrapper_prefix || '_migration_login', 'CONNECT'),
    ('nihongo_migration', 'CREATE'),
    ('nihongo_migration', 'TEMPORARY'),
    (wrapper_prefix || '_app_login', 'CONNECT'),
    (wrapper_prefix || '_guest_cleanup_worker_login', 'CONNECT')
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
    RAISE EXCEPTION 'Local database ACL attestation failed.';
  END IF;
END;
$local_attestation$;
ATTEST_SQL
done

touch "$PGDATA/.phase7-local-provisioned"
echo 'Local TEST/DEVELOPMENT role and database provisioning attested.'
