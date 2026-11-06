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
- Host scripts read these values as `KEY=VALUE` data with an allow-list of
  keys and never `source` them, so `$(...)` or backticks in a value are not
  run (`infra/aws/scripts/host-scripts-check.sh` in CI).
- `DATABASE_URL` must use `nihongo_production_app_login` and its password;
  `MIGRATION_DATABASE_URL` must use `nihongo_production_migration_login`, its
  password and `options=-c role=nihongo_migration`. Both name database
  `nihongo`, `schema=public`, `sslmode=require`. `provision-db.sh` refuses a
  mismatch before it changes anything.

## Deploy order (`infra/aws/files/deploy.sh`)

1. `render-env.sh` writes `api.env`, `migrate.env` and `provision.env` (the
   three wrapper passwords) to tmpfs. `migrate.env` holds the migration URL
   with its password plus the runtime and production URLs **without**
   passwords: the migration guard compares only host, port, database, schema
   and login. If the backend guard ever needs more, it must stay
   password-free.
2. Pull `ECR:<SHA>` and `ECR:<SHA>-migrate`, start `postgres`.
3. `provision-db.sh`: as the bootstrap superuser inside the container, create
   missing roles, re-apply the wrapper passwords (rotation takes effect here),
   grants and database ACLs, then attest the exact graph (including that no role
   is a member of a wrapper login). Any drift stops the
   deploy. Passwords reach psql on stdin and the statement is kept out of the
   server log on error.
4. `migrate.sh`: `backup.sh pre-migrate <SHA>` uploads a `pg_dump` to
   `s3://<backup bucket>/postgres/pre-migrate/` (same 30-day lifecycle; it does
   not count as the daily backup), then
   `docker compose --profile migrate run --rm migrate` runs
   `prisma migrate deploy` once on the internal `db` network, read-only, with
   no capabilities.
5. `register-capability.sh`: the API's readiness
   (`require_runtime_ready` -> `require_database_capability`) refuses a
   database without `DatabaseCapability` row 1, so the whole API stays not
   ready (503) without it. The script runs `registerDatabaseCapabilityCommand`
   from the release's API image as the migration login (compose service
   `capability`, profile `operator`, `migrate.env`):
   - no row (empty database): dry run, then write it;
   - a row for this environment: leave it;
   - then, either way, call `require_database_capability` over TCP to
     `postgres`, the address the API uses. A row for another environment, or
     one whose database, address or port no longer match, stops the deploy.
     Replacing it is an operator step (first-admin runbook, "Wrong or stale
     capability").
6. Tag import (pending: the backend command is not written yet).
7. Only then the new API starts. If step 3, 4 or 5 fails, `.env` is pointed
   back at the running release and the old API keeps serving.
8. First admin: after the first deploy, `first-admin.v1.md`.

The row records the server address the API connects to. Compose gives the
`db` network a fixed subnet (`172.30.1.0/24`) and postgres a fixed address
(`172.30.1.10`); without them Docker assigns addresses in start order, and a
recreated postgres could come back on another one (checked locally: with a
container started first it came back on `.3`), which would make the row stale.

The API and the `capability` service mount the postgres certificate and set
`NODE_EXTRA_CA_CERTS`: node-postgres treats `sslmode=require` as
`verify-full`, so without it they reject the self-signed certificate
(`DEPTH_ZERO_SELF_SIGNED_CERT`). Prisma migrate (step 4) is not affected. New
certificates carry `subjectAltName=DNS:postgres`.

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

## Local rehearsal (JLP-730, 2026-11-07)

`deploy.sh` and its steps ran unchanged against an empty local postgres with
the production names (stub `aws`; local logs and volumes instead of awslogs and
EBS): 3 migrations applied, capability registered, `/health/ready` 200 with the
release id. A second run left everything in place. Also checked: postgres
recreated while another container held an address kept `172.30.1.10` and the
API stayed ready; deleting the row made readiness 503 and the script wrote it
again; a wrong port or another environment in the row stopped the script.

## Open

- STAGING: `registerDatabaseCapabilityCommand` refuses
  `DEPLOYMENT_ENVIRONMENT=STAGING` today, so a STAGING deploy stops at step 5.
  The backend change (#647, JLP-734) lets this one command register a
  PRODUCTION row on STAGING; rehearse STAGING after it lands.
