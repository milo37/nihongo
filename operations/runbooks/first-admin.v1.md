# First production admin v1

Status: commands ready. Running in PRODUCTION needs every item under
"Required before any PRODUCTION run" first. The commands are defined for
PRODUCTION only and refuse `DEPLOYMENT_ENVIRONMENT=STAGING`, like the account
erasure command.

Two one-shot operator commands run on the server, never over HTTP:

| Command                                                                                    | Purpose                                                                                                                                               |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `db:register-capability:compiled` (`apps/api/src/db/registerDatabaseCapabilityCommand.ts`) | Records which environment this database serves (`DatabaseCapability` row 1). Admin re-authentication and admin commands refuse a database without it. |
| `auth:provision-admin:compiled` (`apps/api/src/auth/provisionAdminCommand.ts`)             | Makes the first `ADMIN` from an existing Google-linked `USER`, found by email.                                                                        |

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
The environment file below is an example: use the file the deploy scripts render
for the API (DevOps). Values come from the shell environment, so database URLs
never appear in the command line.

```bash
aws ssm send-command \
  --document-name AWS-RunShellScript \
  --targets Key=tag:Name,Values=harumaru-production \
  --comment "first admin: capability dry run" \
  --parameters 'commands=[
    "set -euo pipefail",
    "cd /opt/harumaru",
    "/opt/harumaru/bin/render-env.sh",
    "set -a; source /run/harumaru/api.env; set +a",
    "export NODE_ENV=production DEPLOYMENT_ENVIRONMENT=PRODUCTION",
    "docker compose run --rm --no-deps -T -e NODE_ENV -e DEPLOYMENT_ENVIRONMENT -e MIGRATION_DATABASE_URL -e DATABASE_URL -e PRODUCTION_DATABASE_URL api node api/dist/db/registerDatabaseCapabilityCommand.js"
  ]'
```

1. Capability dry run (above). Expect
   `{"event":"database_capability_dry_run","environment":"PRODUCTION","registered":null}`.
2. Capability write: same command with
   `export DATABASE_CAPABILITY_CONFIRM=REGISTER_DATABASE_CAPABILITY` and
   `-e DATABASE_CAPABILITY_CONFIRM`. Expect `database_capability_registered`.
3. Provision dry run: run `api/dist/auth/provisionAdminCommand.js` with
   `ADMIN_PROVISION_EMAIL` exported and passed with `-e`. Expect
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
- Wrong capability: run step 2 again with the right environment. The row is
  replaced in place.
- Neither command changes the schema, so there is nothing to migrate back.
