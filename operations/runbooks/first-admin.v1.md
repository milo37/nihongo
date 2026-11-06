# First production admin v1

Status: commands ready. Running in PRODUCTION needs every item under
"Required before any PRODUCTION run" first. The first-admin command is defined
for PRODUCTION only and refuses `DEPLOYMENT_ENVIRONMENT=STAGING`, like the
account erasure command. The capability command is the one exception (#649):
STAGING uses the production database contract (database `nihongo`,
`nihongo_production_*` logins), so on STAGING it runs too and writes the row
with `environment=PRODUCTION`; its dry run also reports `PRODUCTION`.

Two one-shot operator commands run on the server, never over HTTP:

| Command                                                                                    | Purpose                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `db:register-capability:compiled` (`apps/api/src/db/registerDatabaseCapabilityCommand.ts`) | Records which database, server address, port and environment the API serves (`DatabaseCapability` row 1). Without a current row the API's readiness fails (`require_runtime_ready`), so the whole API stays not ready, and admin commands refuse too. `deploy.sh` runs it on every deploy (`register-capability.sh`). |
| `auth:provision-admin:compiled` (`apps/api/src/auth/provisionAdminCommand.ts`)             | Makes the first `ADMIN` from an existing Google-linked `USER`, found by email.                                                                                                                                                                                                                                        |

Both connect with `MIGRATION_DATABASE_URL` as the environment's migration
login with the `nihongo_migration` startup role. Both are dry runs unless their
confirm variable is set, and both print exactly one JSON line.

## Required before any PRODUCTION run

- Roles and logins: the production database has `nihongo_owner`,
  `nihongo_migration`, `nihongo_app` and the login
  `nihongo_production_migration_login` (member of `nihongo_migration` only).
  `infra/aws/scripts/provision-db.sh` creates them.
- Migration: `20261107090000_first_admin_production` is applied (the normal
  `prisma migrate deploy` step of a release). It lets
  `bootstrap_first_google_admin` accept `nihongo_production_migration_login`
  on the database `nihongo`. Before it, the provision step fails in
  PRODUCTION, while its dry run still works.
- Target proof (`assertSafeMigrationDatabase`, the same check as migrations):
  `MIGRATION_DATABASE_URL`, `DATABASE_URL` and `PRODUCTION_DATABASE_URL` name
  the same host, port, database `nihongo` and schema. `MIGRATION_DATABASE_URL`
  uses `nihongo_production_migration_login`, one `sslmode` of `require`,
  `verify-ca` or `verify-full`, and `options=-c role=nihongo_migration`.
- Environment: `NODE_ENV=production` and `DEPLOYMENT_ENVIRONMENT=PRODUCTION`.
- The capability row exists: `deploy.sh` writes it on the first deploy to an
  empty database, before the API starts (`register-capability.sh`,
  `production-database.v1.md` step 5). The first admin comes after that
  deploy.
- The first admin has signed in once with Google, so a `USER` with exactly one
  Google account exists for the email.

## Inputs

| Variable                                                   | Command    | Meaning                                                                                                                 |
| ---------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_CAPABILITY_CONFIRM=REGISTER_DATABASE_CAPABILITY` | capability | Write the row. Without it, report only.                                                                                 |
| `ADMIN_PROVISION_EMAIL`                                    | provision  | The target account's email. Case does not matter.                                                                       |
| `ADMIN_PROVISION_CONFIRM=PROVISION_FIRST_GOOGLE_ADMIN`     | provision  | Change the role. Without it, report only.                                                                               |
| `ADMIN_PROVISION_EXPECTED_GENERATION`                      | provision  | Required with the confirm. Copy `authorityGeneration` from the dry run, so a target that changed in between is refused. |

## Procedure (SSM Run Command)

Run each step with the `AWS-RunShellScript` document on the production host.
Both commands run in the compose service `capability` (profile `operator`):
the release's API image on the internal `db` network, with
`/etc/harumaru/public.env` and `/run/harumaru/migrate.env` (the migration URL,
plus the runtime and production URLs without passwords). Database URLs never
appear in the command line, and no env file is `source`d.

```bash
aws ssm send-command \
  --document-name AWS-RunShellScript \
  --targets Key=tag:Name,Values=harumaru-production \
  --comment "first admin: capability check" \
  --parameters 'commands=[
    "set -euo pipefail",
    "cd /opt/harumaru",
    "/opt/harumaru/bin/render-env.sh",
    "docker compose --profile operator run --rm --no-deps -T capability"
  ]'
```

1. Capability check (above, a dry run). Expect
   `{"event":"database_capability_dry_run","environment":"PRODUCTION","registered":"PRODUCTION"}`:
   the deploy wrote it. `"registered":null` means the deploy did not finish;
   run `/opt/harumaru/bin/register-capability.sh` or redeploy, not a manual
   write.
2. (No step: the capability write is part of the deploy.)
3. Provision dry run: replace the last command with
   `"export ADMIN_PROVISION_EMAIL=<email>"` and
   `"docker compose --profile operator run --rm --no-deps -T -e ADMIN_PROVISION_EMAIL --entrypoint node capability api/dist/auth/provisionAdminCommand.js"`.
   Expect
   `"eligible":true` and note `targetUserId` and `authorityGeneration`.
   `"eligible":false` comes with a `reason`:
   - `TARGET_NOT_FOUND`: no account has this email.
   - `ADMIN_ALREADY_EXISTS`: an active ADMIN exists, so first-admin setup is
     closed. No command adds later admins yet.
   - `TARGET_NOT_ACTIVE_USER`: the account is not an active `USER`.
   - `GOOGLE_LINK_REQUIRED`: the account does not have exactly one Google link.
4. Provision: same as step 3, plus
   `ADMIN_PROVISION_CONFIRM=PROVISION_FIRST_GOOGLE_ADMIN` and
   `ADMIN_PROVISION_EXPECTED_GENERATION=<authorityGeneration from step 3>`.
   Expect `first_google_admin_provisioned` with
   `authorityGeneration` one higher.
5. The new admin signs out and signs in again with Google, then opens `/admin`.

Read each result with `aws ssm get-command-invocation`. Exit code 0 is success
or a dry run, and 1 is a refusal or failure. Failures print only
`first_google_admin_provision_failed` or `database_capability_register_failed`,
without database details.

## Audit record

The command's JSON line is the audit record. SSM keeps it with the command
invocation, which records the operator's IAM identity and time. The line holds
the environment, `targetUserId`, `emailSha256` (SHA-256 of the lower-cased
email), `authorityGeneration` and `occurredAt`. It never contains the email,
the Google subject or a database URL. Keep the SSM invocation output, for
example by sending it to CloudWatch Logs, for as long as admin audit records
are kept.

## Rollback

- Wrong admin: there is no supported rollback today. The `User` trigger
  (`validate_user_change`) refuses every role change except this one-time
  `USER` to `ADMIN` bootstrap, for every database role including the owner.
  Demoting an admin needs a new, separately approved database function. This
  is why the provision step requires the dry run's `authorityGeneration` and
  refuses whenever an active ADMIN already exists: check `targetUserId` and
  `emailSha256` from step 3 before step 4.
- Wrong or stale capability (`register-capability.sh` refused the deploy):
  find out why first. Postgres has a fixed address (`172.30.1.10`) and port,
  so a stale row means the compose file, the database or the port changed. When
  the new values are intended, replace the row with the capability command
  above plus `"export DATABASE_CAPABILITY_CONFIRM=REGISTER_DATABASE_CAPABILITY"`
  and `-e DATABASE_CAPABILITY_CONFIRM`: it writes the current database,
  address, port and environment in place. Then redeploy.
- Neither command changes the schema, so there is nothing to migrate back.
