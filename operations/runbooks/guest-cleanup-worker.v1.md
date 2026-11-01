# Guest cleanup worker v1

Status: source definition only. No database, image, schedule or production
permission has been provisioned or verified by this document.

## Role and migration order

1. On an owned ephemeral TEST cluster, the existing Phase7 runners create
   `nihongo_guest_cleanup_worker` as NOLOGIN, NOINHERIT, NOSUPERUSER,
   NOCREATEDB, NOCREATEROLE, NOREPLICATION and NOBYPASSRLS, plus separate TEST
   and DEVELOPMENT logins with only this membership (ADMIN FALSE, INHERIT
   FALSE, SET TRUE). No application or erasure membership is granted.
2. Keep the historical enum migration's five-login CONNECT boundary intact.
   Apply the canonical 37-migration prefix, canonical seed, then the remaining
   migrations through `20261030100000_guest_expired_draft_retention` (53).
   The new SQL file SHA-256 is
   `5708fd94835c6ce970049b1830d44dca2e10e9c089f54383aa67219218fb81f7`.
   Migration 53 grants schema USAGE and only the batch function EXECUTE to
   the worker; it grants no direct table writes. Applied migrations stay intact.
3. Grant the guest login CONNECT to its target only after the migration chain.
   The guest TEST shard and portable harness do this after migrations; the
   persistent local profile does this in `infra/postgres/init/local-database-activate.psql`.
   Persistent local provisioning uses separate
   `PHASE7_TEST_GUEST_CLEANUP_WORKER_PASSWORD` and
   `PHASE7_DEVELOPMENT_GUEST_CLEANUP_WORKER_PASSWORD` inputs, like the existing
   erasure wrappers. It is fresh-volume bootstrap, not an existing-volume upgrade.
4. Register the exact TEST capability and activate the issuer using the existing
   migration wrapper. Never use an owner or bootstrap URL as the worker URL.

Current ordered name/NUL/checksum/newline SHA-256:
`39d9c2053323d8a180e53af80e81dd26a00ef6c041040dc7ccea8e99932e9c08`.
Portable JSON name/checksum inventory SHA-256:
`40a3146515048b2d7ee280aea0e427fcfc90e307f25346e8c5e20c63959c5d3b`.
Historical prefix37 and runtime27 boundaries are unchanged.

## Required TEST execution

Use a disposable PostgreSQL cluster whose base database is
`nihongo_jlp534_test`. Supply the existing safe TEST environment and bootstrap
`PHASE7_API_INTEGRATION_DATABASE_URL` (or `DATABASE_URL`) through the authorized
environment, without printing credentials. The Phase10 runner creates and
removes a `jlp534_<random>_test` schema for the guest shard and supplies the
fixture, guest and application URLs with `GUEST_CLEANUP_TEST_ISOLATED=yes`.
The manifest runner rejects missing environment, zero tests and skipped tests.

```sh
pnpm --filter @nihongo/api exec tsx src/e2e/validateApiIntegrationManifest.ts
pnpm --filter @nihongo/api exec tsx src/e2e/runApiIntegration.ts --shard=current-guest-cleanup
pnpm run test:api-regression
```

The full regression retains the existing session and draft cleanup suites.
Changing only a test's schema guard or excluding a regression is not supported.
CI must use the dedicated database name in its PostgreSQL service, health probe
and base URL; integration with the separately owned workflow is required.

## Compiled image invocation and limits

The standard runtime image includes both compiled command and supervisor.
The Docker build checks both files; portable smoke executes the supervisor
without configuration and requires exit 1 and the safe failure event.

```sh
node /app/api/dist/study/studyGuestCleanupRuntime.js
# Equivalent from the deployed API package:
pnpm run study:cleanup-expired-guests:compiled
```

Supply `GUEST_CLEANUP_DATABASE_URL` and `GUEST_CLEANUP_ENVIRONMENT=TEST` for
the first dry run. Dry run defaults to true. Live deletion additionally requires
`GUEST_CLEANUP_DRY_RUN=false` and
`GUEST_CLEANUP_CONFIRM=CLEANUP_EXPIRED_GUEST_DATA` through the approved job
environment. Batch size defaults to 100 (maximum 500), batches to 10 (maximum
100), and duration to 30000 milliseconds (maximum 300000).

The supervisor kills its command child with SIGKILL at the duration limit,
including child startup, database waits and disconnect. Nonzero child exit,
timeout or signal stays nonzero. A killed run may have committed earlier batches, and the in-flight commit result
may be unknown; use the same bounded, idempotent command for the next authorized retry. This does not prove
that the database backend stops at the exact same instant. The external job
must also kill the entire container at its 35-second deadline for the pinned
30-second command budget, covering supervisor startup and external cancellation.

Success emits `study.guest_cleanup.ran` with counts and backlog. Remaining work
after a live run exits 1. Failure emits only `study.guest_cleanup.failed`;
absence of completion, nonzero exit or nonzero backlog must alert the operator.
Do not log database URLs, guest IDs, cookies or keys.

## Daily 03:00 Korea Standard Time definition

`operations/guest-cleanup-job.v1.json` is disabled and provider neutral:
`0 3 * * *` in `Asia/Seoul`, equivalent to `0 18 * * *` in UTC. Select one
timezone interpretation, never both. Use the immutable reviewed image digest,
one concurrent run, no overlap, no automatic retries and no missed-run catchup.
The database advisory lock is an additional overlap guard; contention fails.

The environment owner must map this definition to the approved scheduler,
bind the dedicated identity and alerts, and prove the container deadline before
enabling it. Do not install an operating-system cron job. This file registers
nothing. PRODUCTION still requires separate target/role/capability approvals,
`PRODUCTION_DATABASE_URL` matching the exact worker target, and an approved
production migration path; the current migration preflight is TEST/DEVELOPMENT only.
