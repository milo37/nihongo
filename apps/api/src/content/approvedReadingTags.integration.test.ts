import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseApiEnvironment } from '../config/env.js'
import { getPostgresSchema } from '../db/databaseOptions.js'
import {
  createHistoricalSchemaFixture,
  LEGACY_APP_LOGIN,
  quoteIdentifier
} from '../db/fixtures/historicalSchema.js'
import type { IsolatedUpgradeSchema } from '../db/fixtures/historicalSchema.js'
import { assertSafeAdminCmsDatabase } from '../db/databaseTargetGuard.js'

const environment = parseApiEnvironment(process.env)
assertSafeAdminCmsDatabase({
  adminCmsMode: environment.ADMIN_CMS_MODE,
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})
const adminUrl = process.env.PHASE7_ADMIN_DATABASE_URL
if (!adminUrl) throw new Error('Explicit isolated admin database URL required')
const schema = getPostgresSchema(environment.DATABASE_URL)
if (getPostgresSchema(adminUrl) !== schema) throw new Error('Schema mismatch')
const legacyDatabaseUrl = process.env.PHASE7_LEGACY_DATABASE_URL
if (!legacyDatabaseUrl)
  throw new Error('Phase 7 legacy compatibility database URL is required.')
const migrationDatabaseUrl = process.env.PHASE7_MIGRATION_DATABASE_URL
if (!migrationDatabaseUrl)
  throw new Error('Phase 7 migration wrapper database URL is required.')
const {
  copyMigration,
  createIsolatedUpgradeSchema,
  deploy,
  dispose,
  readHistoricalMigrationProfile,
  readLedger,
  seedPreAdminCatalog,
  transferPreAdminTargetOwnership
} = createHistoricalSchemaFixture({
  adminDatabaseUrl: adminUrl,
  legacyDatabaseUrl,
  migrationDatabaseUrl,
  expect
})
let historicalContext: IsolatedUpgradeSchema | undefined
let client: Client
const expectRejected = async (sql: string, code: string) => {
  await client.query('SAVEPOINT rejection')
  await expect(client.query(sql)).rejects.toMatchObject({ code })
  await client.query('ROLLBACK TO SAVEPOINT rejection')
  await client.query('RELEASE SAVEPOINT rejection')
}
const counts = async () =>
  (
    await client.query<{
      tags: number
      applicability: number
      registrations: number
    }>(
      `SELECT (SELECT COUNT(*)::int FROM "Tag") AS tags,
    (SELECT COUNT(*)::int FROM "TagApplicability") AS applicability,
    (SELECT COUNT(*)::int FROM "Phase7ApprovedReadingTagRegistration") AS registrations`
    )
  ).rows[0]

// Reconstruct the historical 65-question bootstrap before the approved registration.
// All mutations, including injected failure fixtures, roll back.
describe('approved tag registration database contract', () => {
  beforeAll(async () => {
    const context = await createIsolatedUpgradeSchema()
    historicalContext = context
    client = context.adminClient
    const { phase6MigrationNames, historicalMigrationNames } =
      readHistoricalMigrationProfile()
    for (const name of phase6MigrationNames)
      copyMigration(name, context.migrationsPath)
    await deploy(context, context.legacyOwnerDatabaseUrl)
    expect(await readLedger(context)).toHaveLength(27)
    await client.query(`SET search_path TO ${context.quotedSchemaName}`)
    await expect(seedPreAdminCatalog(client)).resolves.toEqual({
      insertedCount: 65,
      verifiedCount: 0
    })
    await context.serverClient.query(
      `GRANT CONNECT ON DATABASE ${quoteIdentifier(context.databaseName)} TO ${quoteIdentifier(LEGACY_APP_LOGIN)}`
    )
    await transferPreAdminTargetOwnership(context)
    for (const name of historicalMigrationNames.slice(27))
      copyMigration(name, context.migrationsPath)
    await deploy(context)
    expect(await readLedger(context)).toHaveLength(31)
    // Install only the registration under test, before reviewed catalog revisions replace its historical input.
    copyMigration(
      '20261007060000_phase7_approved_reading_tags',
      context.migrationsPath
    )
    await deploy(context)
    expect(await readLedger(context)).toHaveLength(32)
  }, 180_000)
  afterAll(async () => {
    if (!historicalContext) return
    try {
      await historicalContext.adminClient
        .query('ROLLBACK')
        .catch(() => undefined)
      await historicalContext.serverClient
        .query(
          `REVOKE CONNECT ON DATABASE ${quoteIdentifier(historicalContext.databaseName)} FROM ${quoteIdentifier(LEGACY_APP_LOGIN)}`
        )
        .catch(() => undefined)
    } finally {
      await dispose(historicalContext)
    }
  })
  it('enforces exact tuples, authority, atomic failure, immutable evidence and one-shot application', async () => {
    await client.query('BEGIN')
    try {
      await client.query('SET LOCAL ROLE nihongo_phase7_owner')
      expect(await counts()).toEqual({
        tags: 108,
        applicability: 127,
        registrations: 0
      })
      const beforeGuard = await client.query(
        `SELECT pg_get_functiondef('protect_phase7_tag_applicability()'::regprocedure) AS definition`
      )
      await expectRejected(
        `INSERT INTO "Phase7ApprovedReadingTagRegistration" ("batch") VALUES ('other-batch')`,
        '42501'
      )
      await expectRejected(
        `INSERT INTO "TagApplicability" SELECT "tagId", 'N1', 'READING', 'LONG_READING' FROM "TagApplicability" LIMIT 1`,
        '42501'
      )
      await expectRejected(
        `UPDATE "TagApplicability" SET "level" = 'N1'`,
        '42501'
      )
      await expectRejected(`DELETE FROM "TagApplicability"`, '42501')
      await client.query('SAVEPOINT runtime_authority')
      await client.query('SET LOCAL ROLE nihongo_app')
      await expectRejected(
        `SELECT "apply_phase7_approved_reading_tags"()`,
        '42501'
      )
      await client.query('ROLLBACK TO SAVEPOINT runtime_authority')
      await client.query(`CREATE FUNCTION "phase7_test_reject_last_approved_tag"() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW."label" = '준비물' THEN RAISE EXCEPTION 'synthetic last-row failure' USING ERRCODE = '23514'; END IF; RETURN NEW; END $$`)
      await client.query(
        `CREATE TRIGGER approved_tag_atomic_failure BEFORE INSERT ON "Tag" FOR EACH ROW EXECUTE FUNCTION "phase7_test_reject_last_approved_tag"()`
      )
      await expectRejected(
        `SELECT "apply_phase7_approved_reading_tags"()`,
        '23514'
      )
      expect(await counts()).toEqual({
        tags: 108,
        applicability: 127,
        registrations: 0
      })
      await client.query('DROP TRIGGER approved_tag_atomic_failure ON "Tag"')
      await client.query(
        'DROP FUNCTION "phase7_test_reject_last_approved_tag"()'
      )
      await client.query(`SELECT "apply_phase7_approved_reading_tags"()`)
      expect(await counts()).toEqual({
        tags: 114,
        applicability: 133,
        registrations: 1
      })
      const rows = await client.query(
        `SELECT "label", "level", "subject", "questionType" FROM "Tag" JOIN "TagApplicability" ON "tagId" = "id" WHERE "label" = ANY($1::text[]) ORDER BY "label" COLLATE "C"`,
        [['요청', '완료와 미완료', '시설 안내', '조건', '지시어', '준비물']]
      )
      expect(rows.rows).toHaveLength(6)
      for (const row of rows.rows) {
        expect(row.level).toBe('N5')
        expect(row.subject).toBe('READING')
        expect(row.questionType).toBe(
          ['시설 안내', '조건'].includes(row.label)
            ? 'INFO_RETRIEVAL'
            : 'SHORT_READING'
        )
      }
      await expectRejected(
        `SELECT "apply_phase7_approved_reading_tags"()`,
        '23514'
      )
      await expectRejected(
        `UPDATE "Phase7ApprovedReadingTagRegistration" SET "batch" = 'other-batch'`,
        '42501'
      )
      await expectRejected(
        `DELETE FROM "Phase7ApprovedReadingTagRegistration"`,
        '42501'
      )
      expect(
        await client.query(
          `SELECT pg_get_functiondef('protect_phase7_tag_applicability()'::regprocedure) AS definition`
        )
      ).toMatchObject({ rows: beforeGuard.rows })
    } finally {
      await client.query('ROLLBACK')
    }
  })
})
