import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Client } from 'pg'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it
} from 'vitest'
import { originalQuestionSeeds } from '../../prisma/seed-data/questions/index.js'
import { normalizePhase7TagKey } from '@nihongo/contracts/admin/phase7'
import type { PrismaClient } from '../generated/prisma/client.js'
import { createPrismaAdminQuestionSlice5Repository } from '../admin/adminQuestionSlice5Repository.js'
import { parseApiEnvironment } from '../config/env.js'
import { getPostgresSchema } from '../db/databaseOptions.js'
import {
  createPhase7HistoricalSchemaFixture,
  LEGACY_APP_LOGIN,
  quoteIdentifier
} from '../db/fixtures/phase7HistoricalSchema.js'
import type { IsolatedUpgradeSchema } from '../db/fixtures/phase7HistoricalSchema.js'
import { assertSafeAdminCmsDatabase } from '../db/databaseTargetGuard.js'
import { loadExpectedMigrationManifest } from '../db/readiness.js'
import {
  approved308TagCommand,
  approved308TagMigration,
  createApproved308Imports,
  createApproved308TagRequirements
} from './approved308Supply.js'

// Require an explicit TEST/current38 selection, then prepare an owned current38
// fixture with immutable65/107/126 and no approved308 objects or imports.
const environment = parseApiEnvironment(process.env)
assertSafeAdminCmsDatabase({
  adminCmsMode: environment.ADMIN_CMS_MODE,
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})
const testUrl = process.env.PRISMA_TEST_DATABASE_URL
const adminUrl = process.env.PHASE7_ADMIN_DATABASE_URL
if (
  environment.NODE_ENV !== 'test' ||
  !testUrl ||
  !adminUrl ||
  process.env.PHASE7_APPROVED308_FIXTURE_PROFILE !== 'current38'
) {
  throw new Error(
    'Explicit isolated TEST/current38 approved308 fixture required.'
  )
}
let schema = getPostgresSchema(testUrl)
if (
  !schema ||
  !/^phase7_[a-z0-9_]+_test$/u.test(schema) ||
  getPostgresSchema(adminUrl) !== schema ||
  getPostgresSchema(environment.DATABASE_URL) !== schema
) {
  throw new Error('Approved308 disposable TEST schema mismatch.')
}
const connection = new URL(adminUrl)
for (const value of [testUrl, environment.DATABASE_URL]) {
  const endpoint = new URL(value)
  if (
    endpoint.hostname !== connection.hostname ||
    (endpoint.port || '5432') !== (connection.port || '5432') ||
    endpoint.pathname !== connection.pathname
  )
    throw new Error('Approved308 TEST endpoint mismatch.')
}
connection.searchParams.delete('schema')
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
  readLedger,
  seedCurrentCatalog
} = createPhase7HistoricalSchemaFixture({
  adminDatabaseUrl: adminUrl,
  legacyDatabaseUrl,
  migrationDatabaseUrl,
  expect
})
let historicalContext: IsolatedUpgradeSchema | undefined
let client: Client
const migrationSql = readFileSync(
  new URL(
    `../../prisma/migrations/${approved308TagMigration}/migration.sql`,
    import.meta.url
  ),
  'utf8'
)
const migrationChecksum = createHash('sha256')
  .update(migrationSql)
  .digest('hex')
const executable = migrationSql
  .replace(/^BEGIN;$/mu, '')
  .replace(/^COMMIT;$/mu, '')
const functions = [
  'protect_phase7_approved308_tag_registration',
  'register_phase7_approved308_tag_rows',
  'apply_phase7_approved308_tags'
]
const runtimeRoles = [
  'nihongo_app',
  'nihongo_auth_gateway',
  'nihongo_erasure_worker'
]
const batch = 'jlp-478-approved308-adbbaf21-v1'
const counts = async () =>
  (
    await client.query<{
      questions: number
      versions: number
      options: number
      snapshots: number
      tags: number
      applicability: number
    }>(`SELECT
  (SELECT COUNT(*)::int FROM "Question") questions,(SELECT COUNT(*)::int FROM "QuestionVersion") versions,
  (SELECT COUNT(*)::int FROM "QuestionOption") options,(SELECT COUNT(*)::int FROM "QuestionVersionTag") snapshots,
  (SELECT COUNT(*)::int FROM "Tag") tags,(SELECT COUNT(*)::int FROM "TagApplicability") applicability`)
  ).rows[0]
const baseline = {
  questions: 65,
  versions: 65,
  options: 260,
  snapshots: 130,
  tags: 107,
  applicability: 126
}
const snapshot = async () => ({
  tags: (await client.query('SELECT * FROM "Tag" ORDER BY "id"')).rows,
  applicability: (
    await client.query(
      'SELECT * FROM "TagApplicability" ORDER BY "tagId","level","subject","questionType"'
    )
  ).rows,
  content: (
    await client.query(`SELECT
    (SELECT jsonb_agg(to_jsonb(q) ORDER BY q."id") FROM "Question" q) questions,
    (SELECT jsonb_agg(to_jsonb(v) ORDER BY v."id") FROM "QuestionVersion" v) versions,
    (SELECT jsonb_agg(to_jsonb(o) ORDER BY o."id") FROM "QuestionOption" o) options,
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY t."id") FROM "QuestionVersionTag" t) snapshots`)
  ).rows,
  priorEvidence: (
    await client.query(`SELECT
    (SELECT jsonb_agg(to_jsonb(t)) FROM "Phase7ApprovedReadingTagRegistration" t) n5,
    (SELECT jsonb_agg(to_jsonb(t)) FROM "Phase7ApprovedN3ReadingTagRegistration" t) n3,
    (SELECT jsonb_agg(to_jsonb(t)) FROM "Phase7ApprovedN4N2ReadingTagRegistration" t) n4n2,
    (SELECT jsonb_agg(to_jsonb(t)) FROM "Phase7ApprovedN4ReadingBatch7TagRegistration" t) batch7`)
  ).rows,
  ledger: (
    await client.query(
      'SELECT * FROM "_prisma_migrations" ORDER BY migration_name COLLATE "C",id'
    )
  ).rows,
  oldFunctions: (
    await client.query(
      `SELECT p.proname,p.prosrc,p.proconfig,p.prosecdef,p.proowner::regrole::text owner,p.proacl::text acl
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname=$1 AND p.proname<>ALL($2::text[]) ORDER BY p.proname,p.oid`,
      [schema, functions]
    )
  ).rows,
  bindings: (
    await client.query(
      `SELECT c.relname,c.relowner::regrole::text owner,c.relacl::text acl,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) definition
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_catalog.pg_trigger t ON t.tgrelid=c.oid
    WHERE n.nspname=$1 AND c.relname NOT LIKE 'Phase7Approved308TagRegistration%' ORDER BY c.relname,t.tgname`,
      [schema]
    )
  ).rows
})
const rejected = async (sql: string, code: string, message?: string) => {
  await client.query('SAVEPOINT approved308_rejection')
  try {
    await expect(client.query(sql)).rejects.toMatchObject({
      code,
      ...(message ? { message } : {})
    })
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT approved308_rejection')
    await client.query('RELEASE SAVEPOINT approved308_rejection')
  }
}
const install = async (sql = executable) => {
  await client.query(sql)
  await client.query('SET LOCAL ROLE nihongo_phase7_owner')
}
const record = async () => {
  await client.query(
    `INSERT INTO "_prisma_migrations" (id,checksum,finished_at,migration_name,logs,rolled_back_at,started_at,applied_steps_count)
  VALUES (gen_random_uuid()::text,$1,CURRENT_TIMESTAMP,$2,NULL,NULL,CURRENT_TIMESTAMP,1)`,
    [migrationChecksum, approved308TagMigration]
  )
}
const apply = async () => {
  await client.query('SET LOCAL ROLE nihongo_phase7_migration')
  await client.query(approved308TagCommand)
  await client.query('SET LOCAL ROLE nihongo_phase7_owner')
}
const repository = createPrismaAdminQuestionSlice5Repository({
  auditEnvironment: 'TEST',
  client: {
    $queryRawUnsafe: async (sql: string, ...parameters: unknown[]) =>
      (await client.query(sql, parameters)).rows
  } as unknown as PrismaClient
})

describe('Approved308 closed current38 successor registration', () => {
  beforeAll(async () => {
    const context = await createIsolatedUpgradeSchema()
    historicalContext = context
    client = context.adminClient
    schema = context.schemaName
    const prefix = loadExpectedMigrationManifest().slice(0, 38)
    expect(prefix).toHaveLength(38)
    expect(prefix.at(-1)?.name).toBe(
      '20261009120000_phase7_approved_n4_reading_batch7_tags'
    )
    await context.serverClient.query(
      `GRANT CONNECT ON DATABASE ${quoteIdentifier(context.databaseName)} TO ${quoteIdentifier(LEGACY_APP_LOGIN)}`
    )
    for (const { name } of prefix.slice(0, 37))
      copyMigration(name, context.migrationsPath)
    await deploy(context)
    expect(await readLedger(context)).toHaveLength(37)
    await client.query(`SET search_path TO ${context.quotedSchemaName}`)
    await client.query('SET ROLE nihongo_phase7_owner')
    try {
      await expect(seedCurrentCatalog(client)).resolves.toEqual({
        insertedCount: 65,
        verifiedCount: 0
      })
    } finally {
      await client.query('RESET ROLE')
    }
    copyMigration(
      '20261009120000_phase7_approved_n4_reading_batch7_tags',
      context.migrationsPath
    )
    await deploy(context)
    expect(await readLedger(context)).toHaveLength(38)
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
  beforeEach(async () => {
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE nihongo_phase7_owner')
    await client.query("SET LOCAL TIME ZONE 'UTC'")
    expect(await counts()).toEqual(baseline)
    const expected = loadExpectedMigrationManifest().slice(0, 38)
    expect(expected).toHaveLength(38)
    expect(expected.at(-1)?.name).toBe(
      '20261009120000_phase7_approved_n4_reading_batch7_tags'
    )
    expect(
      (
        await client.query(
          'SELECT migration_name AS name,checksum,finished_at IS NOT NULL AND rolled_back_at IS NULL AND COALESCE(btrim(logs),\'\')=\'\' AND applied_steps_count=1 AS complete FROM "_prisma_migrations" ORDER BY migration_name COLLATE "C"'
        )
      ).rows
    ).toEqual(expected.map((x) => ({ ...x, complete: true })))
    expect(
      (
        await client.query(
          'SELECT to_regclass(\'"Phase7Approved308TagRegistration"\') AS registration'
        )
      ).rows[0]?.registration
    ).toBeNull()
  })
  afterEach(async () => {
    await client.query('ROLLBACK')
  })

  it('installs objects only and rolls failed sealing DDL back atomically', async () => {
    const before = await snapshot()
    const invalid = executable.replace(
      "sealed_predecessor_digest CONSTANT TEXT := 'JLP478_APPROVED308_PREDECESSOR_UNSET'",
      "sealed_predecessor_digest CONSTANT TEXT := 'invalid'"
    )
    expect(invalid).not.toBe(executable)
    await rejected(invalid, '23514')
    expect(
      (
        await client.query(
          'SELECT to_regclass(\'"Phase7Approved308TagRegistration"\') AS registration'
        )
      ).rows[0]?.registration
    ).toBeNull()
    expect(await snapshot()).toEqual(before)
    await install()
    expect(await snapshot()).toEqual(before)
    expect(await counts()).toEqual(baseline)
  })

  it('rejects catalog/prefix/count/content drift before installing any registration objects', async () => {
    for (const mutation of [
      `UPDATE "_prisma_migrations" SET checksum=repeat('0',64) WHERE migration_name='20261005183000_phase7_reviewed_catalog_current'`,
      `UPDATE "_prisma_migrations" SET finished_at=NULL WHERE migration_name='20261009120000_phase7_approved_n4_reading_batch7_tags'`,
      `DELETE FROM "_prisma_migrations" WHERE migration_name='20261005183000_phase7_reviewed_catalog_current'`
    ]) {
      await client.query('SAVEPOINT installer_drift')
      await client.query(mutation)
      await rejected(executable, '23514')
      expect(
        (
          await client.query(
            'SELECT to_regclass(\'"Phase7Approved308TagRegistration"\') AS registration'
          )
        ).rows[0]?.registration
      ).toBeNull()
      await client.query('ROLLBACK TO SAVEPOINT installer_drift')
      await client.query('RELEASE SAVEPOINT installer_drift')
    }
    await client.query(
      `INSERT INTO "Tag" ("id","label","normalizedName","createdAt","updatedAt") VALUES (gen_random_uuid(),'unapproved','unapproved',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`
    )
    await rejected(executable, '23514')
  })

  it('pins owner/path/definer/UTC and migration-only execution; direct writes stay denied', async () => {
    await install()
    await record()
    const rows = (
      await client.query<{
        proname: string
        owner: string
        prosecdef: boolean
        proconfig: string[]
        prosrc: string
      }>(
        `SELECT proname,proowner::regrole::text owner,prosecdef,proconfig,prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND proname=ANY($2::text[]) ORDER BY proname`,
        [schema, functions]
      )
    ).rows
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row.owner).toBe('nihongo_phase7_owner')
      expect(row.proconfig).toContain(
        `search_path=pg_catalog, ${schema}, pg_temp`
      )
    }
    const register = rows.find(
      (x) => x.proname === 'register_phase7_approved308_tag_rows'
    )
    expect(register?.prosecdef).toBe(true)
    expect(
      register?.proconfig
        ?.map((setting) =>
          setting.replace(/[A-Z]/gu, (letter) => letter.toLowerCase())
        )
        .filter((setting) => setting.split('=')[0] === 'timezone')
    ).toEqual(['timezone=utc'])
    expect(register?.prosrc).not.toContain(
      'JLP478_APPROVED308_PREDECESSOR_UNSET'
    )
    for (const role of runtimeRoles) {
      await client.query(`SET LOCAL ROLE "${role}"`)
      await rejected(approved308TagCommand, '42501')
      await rejected(
        `INSERT INTO "Phase7Approved308TagRegistration" ("batch") VALUES ('${batch}')`,
        '42501'
      )
      await client.query('SET LOCAL ROLE nihongo_phase7_owner')
    }
    await rejected(
      `INSERT INTO "TagApplicability" SELECT * FROM "TagApplicability" LIMIT 1`,
      '42501'
    )
  })

  it('registers293 actual UUIDs and323 triples, preserves all parent rows, and validates all308 without importing', async () => {
    await install()
    await record()
    const before = await snapshot()
    const prior = await Promise.all(
      createApproved308Imports().map((request) =>
        repository.validateImport(request)
      )
    )
    expect(
      prior.flatMap((x) => x.errors).every((x) => x.code === 'UNKNOWN_TAG')
    ).toBe(true)
    expect(prior.flatMap((x) => x.errors).length).toBeGreaterThan(0)
    await apply()
    const after = await snapshot()
    expect(await counts()).toEqual({
      ...baseline,
      tags: 400,
      applicability: 449
    })
    const oldIds = new Set(before.tags.map((t) => t.id))
    const additions = after.tags.filter((t) => !oldIds.has(t.id))
    expect(additions).toHaveLength(293)
    expect(new Set(additions.map((t) => t.id)).size).toBe(293)
    expect(after.tags.filter((t) => oldIds.has(t.id))).toEqual(before.tags)
    const oldTuples = new Set(
      before.applicability.map((t) => JSON.stringify(t))
    )
    expect(
      after.applicability.filter((t) => oldTuples.has(JSON.stringify(t)))
    ).toEqual(before.applicability)
    expect(
      after.applicability.filter((t) => !oldTuples.has(JSON.stringify(t)))
    ).toHaveLength(323)
    for (const key of [
      'content',
      'priorEvidence',
      'ledger',
      'oldFunctions',
      'bindings'
    ] as const)
      expect(after[key]).toEqual(before[key])
    for (const request of createApproved308Imports()) {
      const result = await repository.validateImport(request)
      expect(result.valid).toBe(true)
      expect(result.errors).toEqual([])
    }
    expect(
      (await client.query('SELECT * FROM "Phase7Approved308TagRegistration"'))
        .rows
    ).toHaveLength(1)
  })

  it('reaches the final323rd triple and rolls all new tags/cells/evidence back on its failure', async () => {
    await install()
    await record()
    const before = await snapshot()
    const base = new Set(
      originalQuestionSeeds.flatMap((q) =>
        q.tags.map((t) =>
          [normalizePhase7TagKey(t), q.level, q.subject, q.questionType].join(
            '\0'
          )
        )
      )
    )
    const last = createApproved308TagRequirements()
      .filter(
        (t) =>
          !base.has(
            [t.normalizedName, t.level, t.subject, t.questionType].join('\0')
          )
      )
      .at(-1)
    expect(last).toBeDefined()
    if (!last) throw new Error('Missing final tuple')
    const escaped = last.normalizedName.replaceAll("'", "''")
    await client.query(`CREATE FUNCTION approved308_test_final_failure() RETURNS TRIGGER LANGUAGE plpgsql AS $test$ BEGIN
      IF NEW."level"::text='${last.level}' AND NEW."subject"::text='${last.subject}' AND NEW."questionType"::text='${last.questionType}'
        AND EXISTS(SELECT 1 FROM "Tag" WHERE "id"=NEW."tagId" AND "normalizedName"='${escaped}') THEN
        IF (SELECT COUNT(*) FROM "Tag")<>400 OR (SELECT COUNT(*) FROM "TagApplicability")<>449 THEN RAISE EXCEPTION 'Final tuple reached at wrong counts'; END IF;
        RAISE EXCEPTION 'Approved308 final323 reached' USING ERRCODE='P0001'; END IF; RETURN NEW; END; $test$;
      CREATE TRIGGER approved308_test_final_failure AFTER INSERT ON "TagApplicability" FOR EACH ROW EXECUTE FUNCTION approved308_test_final_failure()`)
    const withFault = await snapshot()
    await client.query('SET LOCAL ROLE nihongo_phase7_migration')
    await rejected(
      approved308TagCommand,
      'P0001',
      'Approved308 final323 reached'
    )
    await client.query('SET LOCAL ROLE nihongo_phase7_owner')
    expect(await snapshot()).toEqual(withFault)
    expect(await counts()).toEqual(baseline)
    expect(
      (await client.query('SELECT * FROM "Phase7Approved308TagRegistration"'))
        .rows
    ).toEqual([])
    await client.query(
      'DROP TRIGGER approved308_test_final_failure ON "TagApplicability";DROP FUNCTION approved308_test_final_failure()'
    )
    expect(await snapshot()).toEqual(before)
  })

  it('rejects completed39 ledger drift and unfinished own row before any additions', async () => {
    await install()
    await record()
    for (const mutation of [
      `UPDATE "_prisma_migrations" SET checksum=repeat('0',64) WHERE migration_name='20261009120000_phase7_approved_n4_reading_batch7_tags'`,
      `UPDATE "_prisma_migrations" SET finished_at=NULL WHERE migration_name='${approved308TagMigration}'`,
      `DELETE FROM "_prisma_migrations" WHERE migration_name='${approved308TagMigration}'`
    ]) {
      await client.query('SAVEPOINT ledger_drift')
      await client.query(mutation)
      const before = await snapshot()
      await rejected(approved308TagCommand, '23514')
      expect(await snapshot()).toEqual(before)
      await client.query('ROLLBACK TO SAVEPOINT ledger_drift')
      await client.query('RELEASE SAVEPOINT ledger_drift')
    }
  })

  it('rejects count-preserving dictionary drift and caller-forged seal settings', async () => {
    await install()
    await record()
    await client.query(
      'ALTER TABLE "Tag" DISABLE TRIGGER "Tag_protect_identity"'
    )
    await client.query(
      `UPDATE "Tag" SET "updatedAt"="updatedAt"+interval '1 millisecond' WHERE "id"=(SELECT "id" FROM "Tag" ORDER BY "id" LIMIT 1)`
    )
    const before = await snapshot()
    await client.query(
      "SELECT set_config('app.approved308_predecessor_digest',repeat('0',64),true)"
    )
    await rejected(approved308TagCommand, '23514')
    expect(await snapshot()).toEqual(before)
    expect(await counts()).toEqual(baseline)
  })

  it('rejects replay/evidence mutation and retains all old strict commands', async () => {
    await install()
    await record()
    await apply()
    const before = await snapshot()
    await rejected(approved308TagCommand, '23514')
    for (const sql of [
      'DELETE FROM "Phase7Approved308TagRegistration"',
      'UPDATE "Phase7Approved308TagRegistration" SET "appliedAt"=CURRENT_TIMESTAMP',
      'TRUNCATE "Phase7Approved308TagRegistration"'
    ])
      await rejected(sql, '42501')
    for (const command of [
      'apply_phase7_approved_reading_tags',
      'apply_phase7_approved_n3_reading_tags',
      'apply_phase7_approved_n4_n2_reading_tags',
      'apply_phase7_approved_n4_reading_batch7_tags'
    ])
      await rejected(`SELECT "${command}"()`, '23514')
    expect(await snapshot()).toEqual(before)
  })
})
