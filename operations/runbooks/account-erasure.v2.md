# Account erasure v2

Status: runs on PRODUCTION and STAGING hosts since #696 (BE) and #670 (AWS
schedule). The AWS host runs it hourly through
`infra/aws/files/erase-deletion-pending.sh` once `erasure_schedule_enabled` is
true.
Replaces `account-erasure-worker.v1.md`: since #504 P7 the separate
`nihongo_erasure_worker` role and its logins no longer exist.

The one-shot `auth:erase-deletion-pending:compiled`
(`apps/api/src/auth/ssoAccountErasureCommand.ts`) connects with `DATABASE_URL`
as `nihongo_app` and runs two phases:

1. Provider revoke: lease pending provider cleanups, record a durable dispatch
   marker before each provider call, and record completion afterwards. An
   unknown remote outcome keeps the marker, so lease expiry cannot authorize a
   duplicate call.
2. App erasure: delete app data in one API transaction only after every
   provider cleanup for the request is complete.

Direct erasure (`eraseUserForTest`) is TEST-only. Every other environment must
use the provider-first queue.

## What a PRODUCTION run relies on

- Role: the production application login (member of `nihongo_app` only), with
  CONNECT on the production database only (`provision-db.sh`).
- Capability: a `DatabaseCapability` row registered as `PRODUCTION` for the
  exact database, address and port (`register-capability.sh` in `deploy.sh`).
  STAGING hosts register `PRODUCTION` too, so the host script always passes
  `ACCOUNT_ERASURE_ENVIRONMENT=PRODUCTION`.
- Target proof: `DATABASE_URL` and `PRODUCTION_DATABASE_URL` name the same
  host, port, database and schema.
- Provider tokens: SSO sign-in stores no provider token, so the default
  adapter records each provider cleanup as `NOT_HELD` (nothing to revoke) and
  the request completes. The grant shown in the user's Google account settings
  stays theirs to remove. Storing tokens later would need a real revoke adapter.

Exit code 0 means no unfinished provider, app or batch work. Any failed,
unavailable or truncated work exits 1.
