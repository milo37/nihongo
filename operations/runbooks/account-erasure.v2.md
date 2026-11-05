# Account erasure v2

Status: contract only. Nothing here is provisioned, and production execution
stays refused until every item below exists and is separately approved.
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

## Required before any PRODUCTION run

- Migrations: the baseline migration preflight accepts only the TEST and
  DEVELOPMENT migration wrappers. A production migration principal and its
  approval are not defined.
- Role: the production application login (member of `nihongo_app` only), with
  CONNECT on the production database only.
- Capability: a `DatabaseCapability` row registered as `PRODUCTION` for the
  exact database, address and port by the migration principal.
- Target proof: `DATABASE_URL` and `PRODUCTION_DATABASE_URL` name the same
  host, port, database and schema.
- Provider tokens: SSO sign-in stores no provider tokens today. Google revoke
  needs a token and Apple revoke needs a refresh token plus the client secret,
  so a token vault keyed by provider and subject must be designed, encrypted
  and approved first.
- Adapter: the command refuses `PRODUCTION` before any database access unless a
  credentialed revoke adapter is injected. No such composition exists yet.

Exit code 0 means no unfinished provider, app or batch work. Any failed,
unavailable or truncated work exits 1.
