# Production database roles and migrations v1

Status: implemented on the host side (`infra/aws`), not yet runnable. The
application still accepts only TEST and DEVELOPMENT migration logins in three
places (see "Blocked"), so `migrate.sh` refuses and the deploy stops before the
new API starts. Nothing here has run against a real account.

## Role contract

Database `nihongo` on the host compose `postgres` service. Same graph as the
local `infra/postgres/init/02-provision-local-database.sh`, production names:

| Group (NOLOGIN, NOINHERIT)     | Login wrapper (LOGIN, NOINHERIT, SET only)      |
| ------------------------------ | ----------------------------------------------- |
| `nihongo_owner`                | none (`nihongo_migration` may SET it)           |
| `nihongo_migration`            | `nihongo_production_migration_login`            |
| `nihongo_app`                  | `nihongo_production_app_login`                  |
| `nihongo_guest_cleanup_worker` | `nihongo_production_guest_cleanup_worker_login` |

The database is owned by `nihongo_migration`, which also has CREATE and
TEMPORARY. Only the three wrappers have CONNECT. PUBLIC and the bootstrap
superuser have no database privileges. `public` belongs to `nihongo_migration`
until the baseline migration hands it to `nihongo_owner`.

## Secrets (SSM SecureString, `/harumaru/<env>/`)

- `PROD_MIGRATION_LOGIN_PASSWORD`, `PROD_APP_LOGIN_PASSWORD`,
  `PROD_GUEST_CLEANUP_LOGIN_PASSWORD`: distinct, at least 24 characters,
  `A-Za-z0-9._~-` only.
- `DATABASE_URL` must use `nihongo_production_app_login` and its password;
  `MIGRATION_DATABASE_URL` must use `nihongo_production_migration_login`, its
  password and `options=-c role=nihongo_migration`. Both name database
  `nihongo`, `schema=public`, `sslmode=require`. `provision-db.sh` refuses a
  mismatch before it changes anything.

## Deploy order (`infra/aws/files/deploy.sh`)

1. `render-env.sh` writes `api.env`, `migrate.env` (migration, runtime and
   production URLs for the migration guard) and `provision.env` (the three
   wrapper passwords) to tmpfs.
2. Pull `ECR:<SHA>` and `ECR:<SHA>-migrate`, start `postgres`.
3. `provision-db.sh`: as the bootstrap superuser inside the container, create
   missing roles, re-apply the wrapper passwords (rotation takes effect here),
   grants and database ACLs, then attest the exact graph. Any drift stops the
   deploy. Passwords reach psql on stdin and the statement is kept out of the
   server log on error.
4. `migrate.sh`: `backup.sh pre-migrate <SHA>` uploads a `pg_dump` to
   `s3://<backup bucket>/postgres/pre-migrate/` (same 30-day lifecycle; it does
   not count as the daily backup), then
   `docker compose --profile migrate run --rm migrate` runs
   `prisma migrate deploy` once on the internal `db` network, read-only, with
   no capabilities.
5. Only then the new API starts. If step 3 or 4 fails, `.env` is pointed back
   at the running release and the old API keeps serving.

## Rollback

- Migrations are forward-only; the previous API image must accept the new
  schema (already a deploy rule). To undo a schema change, add a reverse
  migration (backend) and deploy it.
- Data loss or a broken migration: restore the `pre-migrate` dump into a new
  database, verify, then switch. Follow `recovery.v1.md` stop gates.
- Roles: before any user data exists, `DROP OWNED BY` and `DROP ROLE` reverse
  provisioning. Afterwards never drop roles; rotate the SSM password and
  redeploy, or `ALTER ROLE ... NOLOGIN` to lock a wrapper.
- Images are immutable in ECR; the last 10 releases of both tags are kept.

## Blocked (backend, JLP-717)

- B1 `apps/api/src/db/databaseTargetGuard.ts` `assertSafeMigrationDatabase`
  requires `NODE_ENV=test|development` and the TEST/DEVELOPMENT login.
- B2 `apps/api/src/db/runtimeRoleAttestation.ts` derives the expected login
  only for `_test` and `_dev` databases, so `/health/ready` fails on `nihongo`.
- B3 the applied baseline migration's preflight
  (`20261105090000_baseline`, and `bootstrap_first_google_admin`) accepts only
  `_test`/`_dev` databases with their wrappers and raises 42501 on `nihongo`.
  Applied migrations cannot be edited; the backend owner decides the fix.

After those land: rehearse with local compose using the production names, then
the first STAGING deploy.
