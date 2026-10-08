import { Client } from 'pg'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it
} from 'vitest'
import type { PrismaClient } from '../generated/prisma/client.js'
import { createPrismaAdminQuestionSlice5Repository } from '../admin/adminQuestionSlice5Repository.js'
import { parseApiEnvironment } from '../config/env.js'
import {
  createPostgresStartupOptions,
  getPostgresSchema
} from '../db/databaseOptions.js'
import { assertSafeAdminCmsDatabase } from '../db/databaseTargetGuard.js'
import { createApprovedReadingBatch3Import } from './approvedReadingBatch3.js'

const environment = parseApiEnvironment(process.env)
assertSafeAdminCmsDatabase({
  adminCmsMode: environment.ADMIN_CMS_MODE,
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})
const explicitTestUrl = process.env.PRISMA_TEST_DATABASE_URL
const adminUrl = process.env.PHASE7_ADMIN_DATABASE_URL
if (environment.NODE_ENV !== 'test' || !explicitTestUrl || !adminUrl) {
  throw new Error('Explicit isolated TEST and admin database URLs required')
}
const schema = getPostgresSchema(explicitTestUrl)
if (
  !schema ||
  !/^phase7_[a-z0-9_]+_test$/.test(schema) ||
  getPostgresSchema(environment.DATABASE_URL) !== schema ||
  getPostgresSchema(adminUrl) !== schema
) {
  throw new Error('Disposable Phase 7 TEST schema mismatch')
}
const connectionUrl = new URL(adminUrl)
const testEndpoint = new URL(explicitTestUrl)
const runtimeEndpoint = new URL(environment.DATABASE_URL)
if (
  [testEndpoint, runtimeEndpoint].some(
    (endpoint) =>
      endpoint.hostname !== connectionUrl.hostname ||
      (endpoint.port || '5432') !== (connectionUrl.port || '5432') ||
      endpoint.pathname !== connectionUrl.pathname
  )
) {
  throw new Error('Disposable TEST database endpoint mismatch')
}
connectionUrl.searchParams.delete('schema')
const client = new Client({
  connectionString: connectionUrl.toString(),
  options: createPostgresStartupOptions(schema)
})
const runtimeRoles = [
  'nihongo_app',
  'nihongo_auth_gateway',
  'nihongo_erasure_worker'
] as const
const names = ['짧은 글', '업무 연락', '조건별 기한']
const command = 'SELECT "apply_phase7_approved_n3_reading_tags"()'
const baselineCounts = {
  questions: 65,
  versions: 65,
  options: 260,
  tags: 108,
  applicability: 127,
  oldRegistrations: 0,
  registrations: 0
}
interface TagRow {
  id: string
  label: string
  normalizedName: string
  createdAt: Date
  updatedAt: Date
}
interface ApplicabilityRow {
  tagId: string
  level: string
  subject: string
  questionType: string
}
const counts = async () =>
  (
    await client.query<typeof baselineCounts>(
      `SELECT (SELECT COUNT(*)::int FROM "Question") AS questions,
       (SELECT COUNT(*)::int FROM "QuestionVersion") AS versions,
       (SELECT COUNT(*)::int FROM "QuestionOption") AS options,
       (SELECT COUNT(*)::int FROM "Tag") AS tags,
       (SELECT COUNT(*)::int FROM "TagApplicability") AS applicability,
       (SELECT COUNT(*)::int FROM "Phase7ApprovedReadingTagRegistration") AS "oldRegistrations",
       (SELECT COUNT(*)::int FROM "Phase7ApprovedN3ReadingTagRegistration") AS registrations`
    )
  ).rows[0]
const expectRejected = async (sql: string, code: string) => {
  await client.query('SAVEPOINT rejection')
  await expect(client.query(sql)).rejects.toMatchObject({ code })
  await client.query('ROLLBACK TO SAVEPOINT rejection')
  await client.query('RELEASE SAVEPOINT rejection')
}
const snapshot = async () => ({
  tags: (
    await client.query<TagRow>(
      `SELECT * FROM "Tag" ORDER BY "normalizedName" COLLATE "C", "id"`
    )
  ).rows,
  applicability: (
    await client.query<ApplicabilityRow>(
      `SELECT * FROM "TagApplicability" ORDER BY "tagId", "level", "subject", "questionType"`
    )
  ).rows,
  questions: (
    await client.query(
      `SELECT
       (SELECT jsonb_agg(to_jsonb(q) ORDER BY q."id") FROM "Question" q) AS questions,
       (SELECT jsonb_agg(to_jsonb(v) ORDER BY v."id") FROM "QuestionVersion" v) AS versions,
       (SELECT jsonb_agg(to_jsonb(o) ORDER BY o."id") FROM "QuestionOption" o) AS options,
       (SELECT jsonb_agg(to_jsonb(t) ORDER BY t."id") FROM "QuestionVersionTag" t) AS snapshots`
    )
  ).rows,
  guards: (
    await client.query(
      `SELECT pg_get_functiondef('protect_phase7_tag_applicability()'::regprocedure) AS applicability,
       pg_get_functiondef('validate_phase7_system_seed_catalog()'::regprocedure) AS seed`
    )
  ).rows
})
// This adapter performs the repository's validation queries against this real
// disposable database; no fabricated tag/fingerprint rows and no import apply.
const validationClient = {
  $queryRawUnsafe: async (sql: string, ...parameters: unknown[]) =>
    (await client.query(sql, parameters)).rows
} as unknown as PrismaClient
const repository = createPrismaAdminQuestionSlice5Repository({
  auditEnvironment: 'TEST',
  client: validationClient
})
const request = {
  items: createApprovedReadingBatch3Import().items.filter(
    ({ clientItemId }) => clientItemId === 'n3-reading-04'
  )
}

// Install canonical33 + this additive migration, then seed unchanged65.
// Current107/126 or prior N5 application is not this profile. Every mutation,
// including fault injection and the N5-order rejection case, rolls back.
describe('approved N3 reading04 dictionary database contract', () => {
  beforeAll(async () => {
    await client.connect()
  })
  afterAll(async () => {
    await client.end()
  })
  beforeEach(async () => {
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE nihongo_phase7_owner')
    expect(await counts()).toEqual(baselineCounts)
    expect(request.items).toHaveLength(1)
    expect(request.items[0]?.content.tagNames).toEqual(names)
  })
  afterEach(async () => {
    await client.query('ROLLBACK')
  })

  it('rejects unknown batches and direct applicability mutations without weakening the guard', async () => {
    const before = await snapshot()
    await expectRejected(
      `INSERT INTO "Phase7ApprovedN3ReadingTagRegistration" ("batch") VALUES ('other-batch')`,
      '42501'
    )
    await expectRejected(
      `INSERT INTO "TagApplicability" SELECT "id", 'N3', 'READING', 'SHORT_READING' FROM "Tag" WHERE "normalizedName" = '짧은 글'`,
      '42501'
    )
    await expectRejected(
      `UPDATE "TagApplicability" SET "level" = 'N1'`,
      '42501'
    )
    await expectRejected(`DELETE FROM "TagApplicability"`, '42501')
    expect(await snapshot()).toEqual(before)
    expect(await counts()).toEqual(baselineCounts)
  })

  it('keeps function ownership, search paths and closed runtime authority', async () => {
    const functions = await client.query<{
      name: string
      owner: string
      definer: boolean
      config: string[]
    }>(
      `SELECT p.proname AS name, r.rolname AS owner, p.prosecdef AS definer, p.proconfig AS config
       FROM pg_catalog.pg_proc p
       JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
       JOIN pg_catalog.pg_roles r ON r.oid = p.proowner
       WHERE n.nspname = $1 AND p.proname = ANY($2::text[])`,
      [
        schema,
        [
          'protect_phase7_approved_n3_reading_tag_registration',
          'register_phase7_approved_n3_reading_tag_rows',
          'apply_phase7_approved_n3_reading_tags'
        ]
      ]
    )
    expect(functions.rows).toHaveLength(3)
    for (const row of functions.rows) {
      expect(row.owner).toBe('nihongo_phase7_owner')
      expect(row.config).toContain(`search_path=pg_catalog, ${schema}, pg_temp`)
      expect(row.definer).toBe(!row.name.startsWith('protect_'))
    }
    const executePrivilege = await client.query(
      `SELECT has_function_privilege('nihongo_phase7_migration', 'apply_phase7_approved_n3_reading_tags()', 'EXECUTE') AS allowed`
    )
    expect(executePrivilege.rows).toEqual([{ allowed: true }])
    for (const role of runtimeRoles) {
      const privileges = await client.query(
        `SELECT has_schema_privilege($1, $2, 'CREATE') AS create,
         has_function_privilege($1, 'apply_phase7_approved_n3_reading_tags()', 'EXECUTE') AS execute,
         has_table_privilege($1, '"Phase7ApprovedN3ReadingTagRegistration"', 'INSERT,UPDATE,DELETE') AS write`,
        [role, schema]
      )
      expect(privileges.rows).toEqual([
        { create: false, execute: false, write: false }
      ])
      await client.query('SAVEPOINT runtime_authority')
      await client.query(`SET LOCAL ROLE ${role}`)
      await expectRejected(command, '42501')
      await expectRejected(
        `INSERT INTO "Phase7ApprovedN3ReadingTagRegistration" ("batch") VALUES ('jlp-429-n3-reading04-tags-v1')`,
        '42501'
      )
      await client.query('ROLLBACK TO SAVEPOINT runtime_authority')
      await client.query('RELEASE SAVEPOINT runtime_authority')
    }
    expect(await counts()).toEqual(baselineCounts)
  })

  it('rolls back the reused mapping, both new names and evidence on a final-tuple failure', async () => {
    const before = await snapshot()
    await client.query(`CREATE FUNCTION "phase7_test_reject_last_n3_tuple"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF EXISTS (SELECT 1 FROM "Tag" WHERE "id" = NEW."tagId" AND "normalizedName" = '조건별 기한')
        THEN RAISE EXCEPTION 'synthetic final-tuple failure' USING ERRCODE = '23514'; END IF; RETURN NEW; END $$`)
    await client.query(
      `CREATE TRIGGER approved_n3_atomic_failure BEFORE INSERT ON "TagApplicability" FOR EACH ROW EXECUTE FUNCTION "phase7_test_reject_last_n3_tuple"()`
    )
    await expectRejected(command, '23514')
    expect(await snapshot()).toEqual(before)
    expect(await counts()).toEqual(baselineCounts)
  })

  it('adds only the reviewed three tuples, reuses the original ID and rejects replay or immutable-evidence changes', async () => {
    const before = await snapshot()
    const shortTag = before.tags.find((row) => row.normalizedName === '짧은 글')
    expect(shortTag).toBeDefined()
    const missing = await repository.validateImport(request)
    expect(missing.valid).toBe(false)
    expect(missing.errors).toHaveLength(3)
    expect(missing.errors.every(({ code }) => code === 'UNKNOWN_TAG')).toBe(
      true
    )
    await client.query('SET LOCAL ROLE nihongo_phase7_migration')
    await client.query(command)
    await client.query('SET LOCAL ROLE nihongo_phase7_owner')
    expect(await counts()).toEqual({
      ...baselineCounts,
      tags: 110,
      applicability: 130,
      registrations: 1
    })
    const after = await snapshot()
    expect(
      after.tags.filter(
        (tag) => !['업무 연락', '조건별 기한'].includes(tag.normalizedName)
      )
    ).toEqual(before.tags)
    expect(after.tags.find((tag) => tag.normalizedName === '짧은 글')).toEqual(
      shortTag
    )
    expect(after.questions).toEqual(before.questions)
    expect(after.guards).toEqual(before.guards)
    const newIds = after.tags
      .filter((tag) =>
        ['업무 연락', '조건별 기한'].includes(tag.normalizedName)
      )
      .map((tag) => tag.id)
    const added = after.applicability.filter(
      (row) =>
        newIds.includes(row.tagId) ||
        (row.tagId === shortTag?.id && row.level === 'N3')
    )
    expect(added).toHaveLength(3)
    for (const row of added) {
      expect(row).toMatchObject({
        level: 'N3',
        subject: 'READING',
        questionType: 'SHORT_READING'
      })
    }
    expect(after.applicability.filter((row) => !added.includes(row))).toEqual(
      before.applicability
    )
    const approved = await repository.validateImport(request)
    expect(approved.valid).toBe(true)
    expect(approved.errors).toEqual([])
    for (const classification of [
      { level: 'N4' as const },
      { questionType: 'MEDIUM_READING' as const }
    ]) {
      const wrongCell = await repository.validateImport({
        items: request.items.map((item) => ({
          ...item,
          content: { ...item.content, ...classification }
        }))
      })
      expect(wrongCell.valid).toBe(false)
      expect(
        wrongCell.errors.filter(({ code }) => code === 'UNKNOWN_TAG')
      ).toHaveLength(3)
    }
    await expectRejected(command, '23514')
    await expectRejected(
      `UPDATE "Phase7ApprovedN3ReadingTagRegistration" SET "batch" = 'other-batch'`,
      '42501'
    )
    await expectRejected(
      `DELETE FROM "Phase7ApprovedN3ReadingTagRegistration"`,
      '42501'
    )
    expect(await snapshot()).toEqual(after)
    expect(await counts()).toEqual({
      ...baselineCounts,
      tags: 110,
      applicability: 130,
      registrations: 1
    })
  })

  it('rejects an already applied N5 command and preserves its original six-tag result', async () => {
    await client.query('SELECT "apply_phase7_approved_reading_tags"()')
    expect(await counts()).toEqual({
      ...baselineCounts,
      tags: 114,
      applicability: 133,
      oldRegistrations: 1
    })
    const before = await snapshot()
    await expectRejected(command, '23514')
    expect(await snapshot()).toEqual(before)
    expect(await counts()).toEqual({
      ...baselineCounts,
      tags: 114,
      applicability: 133,
      oldRegistrations: 1
    })
  })
})
