# API test fixtures

Test-only helpers and data for the API integration tests. They are not part of the API build.

- `db/`: database fixtures (SQL helpers, SSO sessions, account erasure, schema catalog).
- `db/baseline/`: `schema76.catalog.json`, the frozen catalog of the 76-migration schema, and `baselineDelta.ts`. `src/db/adminCmsFoundation.integration.test.ts` checks the baseline migration against them.
- `auth/`: admin provisioning for the tests.

These files used to live in `apps/api/src/db/fixtures/` and `apps/api/src/auth/fixtures/`. The comments in the applied baseline migration (`prisma/migrations/20261105090000_baseline/migration.sql`) still name the old `db/fixtures/` paths. Applied migrations are not edited, so read those paths as `test/fixtures/db/`.
