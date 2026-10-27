# Account erasure worker production capability contract v1

Status: contract only. Nothing here is provisioned, and production execution
stays refused until every item below exists and is separately approved.

The one-shot `auth:erase-deletion-pending:compiled` runs two phases with the
`nihongo_erasure_worker` role:

1. Provider revoke: `phase7_claim_sso_provider_cleanups` leases up to the batch
   size of requests (300 seconds, `FOR UPDATE SKIP LOCKED`) and returns only the
   request id, provider and provider subject. Only a leased claim reaches a
   provider. A revoke success records `COMPLETED`; a provider or network error
   records `FAILED`; a missing subject, token or credential records nothing and
   the request stays pending.
2. App erasure: `phase7_complete_sso_account_erasure` deletes app data only
   after every provider cleanup is `COMPLETED`.

Direct `phase7_erase_user` is TEST-only. Every other environment must use the
provider-first queue; the unchecked eraser is not executable by any runtime
role.

## Required before any PRODUCTION run

- Migrations: the current Phase7 migration preflight accepts only the TEST and
  DEVELOPMENT migration wrappers. A production migration principal and its
  approval are not defined.
- Roles: a production erasure-worker login that is a member of
  `nihongo_erasure_worker` only, with CONNECT on the production database only.
- Capability: `Phase7DatabaseCapability` registered as `PRODUCTION` for the
  exact database, address and port by the migration principal.
- Target proof: `ERASURE_WORKER_DATABASE_URL` and `PRODUCTION_DATABASE_URL`
  name the same host, port, database and schema.
- Provider tokens: SSO sign-in stores no provider tokens today. Google revoke
  needs a token and Apple revoke needs a refresh token plus the client secret,
  so a token vault keyed by provider and subject must be designed, encrypted
  and approved first.
- Adapter: the command refuses `PRODUCTION` before any database access unless a
  credentialed revoke adapter is injected. No such composition exists yet.

Exit code 0 means no unfinished provider, app or batch work. Any failed,
unavailable or truncated work exits 1.
