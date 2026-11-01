import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
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
import {
  createHistoricalSchemaFixture,
  LEGACY_APP_LOGIN,
  quoteIdentifier
} from '../db/fixtures/historicalSchema.js'
import type { IsolatedUpgradeSchema } from '../db/fixtures/historicalSchema.js'
import { loadExpectedMigrationManifest } from '../db/readiness.js'
import { toStableSeedUuid } from '../../prisma/seed-data/id.js'
import {
  approvedReadingBatch2,
  createApprovedReadingBatch2Import
} from './approvedReadingBatch2.js'
import {
  approvedReadingBatch7,
  createApprovedReadingBatch7Import
} from './approvedReadingBatch7.js'

const fixtureProfile = process.env.PHASE7_BATCH7_FIXTURE_PROFILE ?? 'legacy'
if (fixtureProfile !== 'legacy' && fixtureProfile !== 'current') {
  throw new Error('Batch7 fixture profile must be legacy or current.')
}

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
let schema = getPostgresSchema(explicitTestUrl)
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
let client: Client
const runtimeRoles = [
  'nihongo_app',
  'nihongo_auth_gateway',
  'nihongo_erasure_worker'
] as const
const batch = 'jlp-470-n4-reading-batch7-tags-v1'
const installation = '20261009120000_phase7_approved_n4_reading_batch7_tags'
const command = 'SELECT "apply_phase7_approved_n4_reading_batch7_tags"()'
const baselineCounts = {
  questions: 65,
  versions: 65,
  options: 260,
  tags: 128,
  applicability: 151,
  snapshots: 130,
  oldRegistrations: 0,
  n3Registrations: 0,
  registrations: 1
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
       (SELECT COUNT(*)::int FROM "QuestionVersionTag") AS snapshots,
       (SELECT COUNT(*)::int FROM "Phase7ApprovedN3ReadingTagRegistration") AS "n3Registrations",
       (SELECT COUNT(*)::int FROM "Phase7ApprovedReadingTagRegistration") AS "oldRegistrations",
       (SELECT COUNT(*)::int FROM "Phase7ApprovedN4N2ReadingTagRegistration") AS registrations`
    )
  ).rows[0]
const expectRejected = async (sql: string, code: string, message?: string) => {
  await client.query('SAVEPOINT rejection')
  await expect(client.query(sql)).rejects.toMatchObject({
    code,
    ...(message ? { message } : {})
  })
  await client.query('ROLLBACK TO SAVEPOINT rejection')
  await client.query('RELEASE SAVEPOINT rejection')
}
const snapshot = async () => ({
  bindings: (
    await client.query(
      `SELECT c.relname, c.relowner::regrole::text AS owner, c.relacl::text AS acl,
    t.tgname, t.tgenabled, pg_catalog.pg_get_triggerdef(t.oid) AS definition
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_trigger t ON t.tgrelid = c.oid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1 AND t.tgname IN ('Tag_lock_assignment_scope', 'Tag_protect_identity', 'TagApplicability_protect_write')
    ORDER BY c.relname, t.tgname`,
      [schema]
    )
  ).rows,
  ledger: (
    await client.query(
      `SELECT * FROM "_prisma_migrations" ORDER BY "migration_name", "id"`
    )
  ).rows,
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
  priorEvidence: (
    await client.query(
      'SELECT * FROM "Phase7ApprovedN4N2ReadingTagRegistration" ORDER BY "batch"'
    )
  ).rows,
  newEvidence: (
    await client.query(
      'SELECT * FROM "Phase7ApprovedN4ReadingBatch7TagRegistration" ORDER BY "batch"'
    )
  ).rows,
  oldSecurity: (
    await client.query(
      `SELECT p.proname, p.prosrc, p.proconfig, p.prosecdef,
    p.proowner::regrole::text AS owner, p.proacl::text AS acl FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = $1 AND p.proname = ANY($2::text[]) ORDER BY p.proname`,
      [
        schema,
        [
          'protect_phase7_tag_applicability',
          'protect_phase7_tag_identity',
          'apply_phase7_approved_n4_n2_reading_tags',
          'register_phase7_approved_n4_n2_reading_tag_rows',
          'protect_phase7_approved_n4_n2_reading_tag_registration',
          'apply_phase7_approved_reading_tags',
          'apply_phase7_approved_n3_reading_tags'
        ]
      ]
    )
  ).rows,
  guards: (
    await client.query(
      `SELECT pg_get_functiondef('protect_phase7_tag_applicability()'::regprocedure) AS applicability,
       pg_get_functiondef('validate_phase7_system_seed_catalog()'::regprocedure) AS seed,
       pg_get_functiondef('protect_phase7_tag_identity()'::regprocedure) AS identity,
       pg_get_functiondef('apply_phase7_approved_reading_tags()'::regprocedure) AS oldN5,
       pg_get_functiondef('apply_phase7_approved_n3_reading_tags()'::regprocedure) AS oldN3`
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
const request = createApprovedReadingBatch7Import()
const priorRequest = createApprovedReadingBatch2Import()
const expectedTuples = [
  {
    label: '전달 메모',
    level: 'N4',
    subject: 'READING',
    questionType: 'SHORT_READING'
  },
  {
    label: '보관 장소 변경',
    level: 'N4',
    subject: 'READING',
    questionType: 'SHORT_READING'
  },
  {
    label: '우산',
    level: 'N4',
    subject: 'READING',
    questionType: 'SHORT_READING'
  },
  {
    label: '옷 수거',
    level: 'N4',
    subject: 'READING',
    questionType: 'SHORT_READING'
  },
  {
    label: '참여 조건',
    level: 'N4',
    subject: 'READING',
    questionType: 'SHORT_READING'
  },
  {
    label: '두 이유 결합',
    level: 'N4',
    subject: 'READING',
    questionType: 'SHORT_READING'
  },
  {
    label: '예약 변경',
    level: 'N4',
    subject: 'READING',
    questionType: 'SHORT_READING'
  },
  {
    label: '이동 수단',
    level: 'N4',
    subject: 'READING',
    questionType: 'SHORT_READING'
  },
  {
    label: '조건 변화',
    level: 'N4',
    subject: 'READING',
    questionType: 'SHORT_READING'
  },
  {
    label: '신청 안내',
    level: 'N4',
    subject: 'READING',
    questionType: 'INFO_RETRIEVAL'
  },
  {
    label: '참가 이력',
    level: 'N4',
    subject: 'READING',
    questionType: 'INFO_RETRIEVAL'
  },
  {
    label: '마감 준비물',
    level: 'N4',
    subject: 'READING',
    questionType: 'INFO_RETRIEVAL'
  },
  {
    label: '자전거 보관',
    level: 'N4',
    subject: 'READING',
    questionType: 'INFO_RETRIEVAL'
  },
  {
    label: '날짜 기준 요금',
    level: 'N4',
    subject: 'READING',
    questionType: 'INFO_RETRIEVAL'
  },
  {
    label: '출입 시간',
    level: 'N4',
    subject: 'READING',
    questionType: 'INFO_RETRIEVAL'
  }
] as const
const newNames: readonly string[] = expectedTuples.map(({ label }) => label)
const tupleKey = ({ tagId, level, subject, questionType }: ApplicabilityRow) =>
  [tagId, level, subject, questionType].join('\0')
const afterCounts = { ...baselineCounts, tags: 143, applicability: 166 }
const apply = async () => {
  await client.query('SET LOCAL ROLE nihongo_phase7_migration')
  await client.query(command)
  await client.query('SET LOCAL ROLE nihongo_phase7_owner')
}
const sourceFiles = [
  [
    'approvedReadingBatch2.ts',
    '5125f9718e9e98d752ea52f9b110d69d2681c96bf5e9611898a587a9b4adbb2f'
  ],
  [
    'approvedReadingBatch2.test.ts',
    '89886531ea3f3911b55085cc71c334442361a2db3ebbf5956e8d5ed083fc38fc'
  ],
  [
    'approvedReadingBatch7.ts',
    'f82368c5b388cd633118b72b831bac851e6c16617d3375f1c502dd792eddab5f'
  ],
  [
    'approvedReadingBatch7.test.ts',
    'd74e325f7a9712ef7db7f1e8d6c1450afa556d74d9a841bd0619ec013374a913'
  ]
] as const
const approvedSources = [
  {
    id: 'n4-reading-09',
    draftId: 'JLP-265-n4-reading-09-draft1',
    draftSHA256:
      '31d5701993366c30b9f3129b55b57e2d2ac1d3ce70041c91afa752e972d06fd3',
    originalTagNames: ['전달 메모', '보관 장소 변경', '우산'],
    correctIndex: 2
  },
  {
    id: 'n4-reading-10',
    draftId: 'JLP-265-n4-reading-10-draft1',
    draftSHA256:
      '8ddb1761e3964cca348af6c34dd110c3f0ad0d388103dedf8a8097e5ed913538',
    originalTagNames: ['옷 수거', '참여 조건', '두 이유 결합'],
    correctIndex: 0
  },
  {
    id: 'n4-reading-11',
    draftId: 'JLP-265-n4-reading-11-draft1',
    draftSHA256:
      'dda0f192724ae7e356d75abda307f1e5936cbd8668134984b1cad569bc6017c7',
    originalTagNames: ['예약 변경', '이동 수단', '조건 변화'],
    correctIndex: 3
  },
  {
    id: 'n4-reading-12',
    draftId: 'JLP-265-n4-reading-12-draft1',
    draftSHA256:
      'ef0fff025704e6ca435e0d71065034c25b99afeef839209fd7b23ec35fa14635',
    originalTagNames: ['신청 안내', '참가 이력', '마감 준비물'],
    correctIndex: 1
  },
  {
    id: 'n4-reading-13',
    draftId: 'JLP-265-n4-reading-13-draft1',
    draftSHA256:
      'f3d28a2698574a4c1532c44a16a00f727d3483cc95cb5a9fd61b0641c883d845',
    originalTagNames: ['자전거 보관', '날짜 기준 요금', '출입 시간'],
    correctIndex: 3
  }
] as const

// Prepare canonical36/revision2, apply the unchanged predecessor20/24 once, then
// install Batch7 definitions. Each case still rolls back its own changes.
const defineLegacyFixtureTests = () => {
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
    seedReviewedRevision2Catalog
  } = createHistoricalSchemaFixture({
    adminDatabaseUrl: adminUrl,
    legacyDatabaseUrl,
    migrationDatabaseUrl,
    expect
  })
  let historicalContext: IsolatedUpgradeSchema | undefined
  beforeAll(async () => {
    const context = await createIsolatedUpgradeSchema()
    historicalContext = context
    client = context.adminClient
    schema = context.schemaName
    const predecessor = loadExpectedMigrationManifest().filter(
      ({ name }) =>
        name < installation &&
        name !== '20261005183000_phase7_reviewed_catalog_current'
    )
    expect(predecessor).toHaveLength(36)
    expect(predecessor.at(-1)?.name).toBe(
      '20261009092000_phase7_n4_n2_revision2_digest_fix'
    )
    await context.serverClient.query(
      `GRANT CONNECT ON DATABASE ${quoteIdentifier(context.databaseName)} TO ${quoteIdentifier(LEGACY_APP_LOGIN)}`
    )
    for (const { name } of predecessor)
      copyMigration(name, context.migrationsPath)
    await deploy(context)
    expect(await readLedger(context)).toHaveLength(36)
    await client.query(`SET search_path TO ${context.quotedSchemaName}`)
    await client.query('SET ROLE nihongo_phase7_owner')
    try {
      await expect(seedReviewedRevision2Catalog(client)).resolves.toEqual({
        insertedCount: 65,
        verifiedCount: 0
      })
    } finally {
      await client.query('RESET ROLE')
    }
    await client.query('SET ROLE nihongo_phase7_migration')
    try {
      await client.query('SELECT "apply_phase7_approved_n4_n2_reading_tags"()')
    } finally {
      await client.query('RESET ROLE')
    }
    expect(await counts()).toEqual(baselineCounts)
    copyMigration(installation, context.migrationsPath)
    await deploy(context)
    expect(await readLedger(context)).toHaveLength(37)
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
    expect(await counts()).toEqual(baselineCounts)
    expect((await snapshot()).newEvidence).toEqual([])
    const expected = loadExpectedMigrationManifest().filter(
      ({ name }) =>
        name <= installation &&
        name !== '20261005183000_phase7_reviewed_catalog_current'
    )
    expect(expected).toHaveLength(37)
    expect(expected.at(-1)?.name).toBe(installation)
    const ledger = await client.query<{
      name: string
      checksum: string
      complete: boolean
    }>(
      `SELECT migration_name AS name, checksum,
      finished_at IS NOT NULL AND rolled_back_at IS NULL AND COALESCE(btrim(logs), '') = ''
        AND applied_steps_count = 1 AS complete FROM "_prisma_migrations" ORDER BY migration_name COLLATE "C"`
    )
    expect(ledger.rows).toEqual(
      expected.map((row) => ({ ...row, complete: true }))
    )
    for (const [name, hash] of sourceFiles) {
      expect(
        createHash('sha256')
          .update(readFileSync(new URL(name, import.meta.url)))
          .digest('hex')
      ).toBe(hash)
    }
    expect(request.items).toHaveLength(5)
    for (const [i, source] of approvedSources.entries()) {
      expect(approvedReadingBatch7.items[i]?.draftId).toBe(source.draftId)
      expect(approvedReadingBatch7.items[i]?.sha256).toBe(source.draftSHA256)
      expect(request.items[i]?.clientItemId).toBe(source.id)
      expect(request.items[i]?.content.tagNames).toEqual(
        source.originalTagNames
      )
      expect(request.items[i]?.content.explanationJa).toBeNull()
      expect(request.items[i]?.content.difficulty).toBe('NORMAL')
      expect(request.items[i]?.content.correctOptionKey).toBe(
        `option-${source.correctIndex + 1}`
      )
    }
    expect(priorRequest.items.map(({ content }) => content.tagNames)).toEqual(
      approvedReadingBatch2.items.map(({ registration }) => registration.tags)
    )
    for (const label of ['짧은 글', '정보 찾기', '중문 독해']) {
      expect(
        (await snapshot()).tags.find(
          ({ normalizedName }) => normalizedName === label
        )?.id
      ).toBe(toStableSeedUuid('question-tag', label))
    }
  })
  afterEach(async () => {
    await client.query('ROLLBACK')
  })

  it('keeps original five blocked by exactly15 missing tags while prior five remain valid', async () => {
    const before = await snapshot()
    const payload = structuredClone(request)
    const missing = await repository.validateImport(request)
    expect(missing.valid).toBe(false)
    expect(missing.errors).toHaveLength(15)
    expect(missing.errors.every(({ code }) => code === 'UNKNOWN_TAG')).toBe(
      true
    )
    expect((await repository.validateImport(priorRequest)).valid).toBe(true)
    expect(request).toEqual(payload)
    expect(await snapshot()).toEqual(before)
  })

  it('pins owner/path/definer and migration-only execute while rejecting direct writes', async () => {
    const before = await snapshot()
    const functions = await client.query<{
      name: string
      owner: string
      definer: boolean
      config: string[]
      body: string
      publicExecute: boolean
    }>(
      `SELECT p.proname AS name, r.rolname AS owner, p.prosecdef AS definer, p.proconfig AS config, p.prosrc AS body,
      EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS "publicExecute"
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_catalog.pg_roles r ON r.oid = p.proowner WHERE n.nspname = $1 AND p.proname = ANY($2::text[])`,
      [
        schema,
        [
          'protect_phase7_approved_n4_reading_batch7_tag_registration',
          'register_phase7_approved_n4_reading_batch7_tag_rows',
          'apply_phase7_approved_n4_reading_batch7_tags'
        ]
      ]
    )
    expect(functions.rows).toHaveLength(3)
    for (const row of functions.rows) {
      expect(row.owner).toBe('nihongo_phase7_owner')
      expect(row.config).toContain(`search_path=pg_catalog, ${schema}, pg_temp`)
      expect(row.definer).toBe(!row.name.startsWith('protect_'))
      expect(row.publicExecute).toBe(false)
      if (row.name.startsWith('register_')) {
        expect(row.config.map((value) => value.toLowerCase())).toContain(
          'timezone=utc'
        )
        expect(
          row.body.match(
            /sealed_predecessor_digest CONSTANT TEXT := '[0-9a-f]{64}';/gu
          )
        ).toHaveLength(1)
        expect(row.body).not.toContain('JLP478_BATCH7_PREDECESSOR_DIGEST_UNSET')
        expect(
          row.config.some((value) =>
            value.startsWith('app.phase7_batch7_predecessor_digest=')
          )
        ).toBe(false)
      }
    }
    expect(
      (
        await client.query(`SELECT has_function_privilege('nihongo_phase7_migration', 'apply_phase7_approved_n4_reading_batch7_tags()', 'EXECUTE') AS allowed,
      has_table_privilege('nihongo_phase7_migration', '"Phase7ApprovedN4ReadingBatch7TagRegistration"', 'INSERT,UPDATE,DELETE,TRUNCATE') AS write`)
      ).rows
    ).toEqual([{ allowed: true, write: false }])
    expect(
      (
        await client.query(`SELECT r.rolname AS owner, EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) a WHERE a.grantee = 0) AS "publicPrivilege"
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_roles r ON r.oid = c.relowner WHERE c.oid = '"Phase7ApprovedN4ReadingBatch7TagRegistration"'::regclass`)
      ).rows
    ).toEqual([{ owner: 'nihongo_phase7_owner', publicPrivilege: false }])
    await expectRejected(
      `INSERT INTO "Phase7ApprovedN4ReadingBatch7TagRegistration" ("batch") VALUES ('other-batch')`,
      '42501'
    )
    await expectRejected(
      `UPDATE "Tag" SET "label" = 'drift' WHERE "normalizedName" = '짧은 글'`,
      '42501'
    )
    for (const sql of [
      `INSERT INTO "TagApplicability" SELECT "id", 'N1', 'READING', 'SHORT_READING' FROM "Tag" WHERE "normalizedName" = '짧은 글'`,
      `UPDATE "TagApplicability" SET "level" = 'N1'`,
      `DELETE FROM "TagApplicability"`
    ]) {
      await expectRejected(sql, '42501')
    }
    for (const role of runtimeRoles) {
      expect(
        (
          await client.query(
            `SELECT has_schema_privilege($1, $2, 'CREATE') AS create,
      has_function_privilege($1, 'apply_phase7_approved_n4_reading_batch7_tags()', 'EXECUTE') AS execute,
      has_table_privilege($1, '"Phase7ApprovedN4ReadingBatch7TagRegistration"', 'INSERT,UPDATE,DELETE,TRUNCATE') AS write,
      has_table_privilege($1, '"TagApplicability"', 'INSERT,UPDATE,DELETE') AS dictionary,
      has_table_privilege($1, '"Tag"', 'INSERT,UPDATE,DELETE') AS tags`,
            [role, schema]
          )
        ).rows
      ).toEqual([
        {
          create: false,
          execute: false,
          write: false,
          dictionary: false,
          tags: false
        }
      ])
      await client.query('SAVEPOINT runtime_authority')
      await client.query(`SET LOCAL ROLE ${role}`)
      await expectRejected(command, '42501')
      await expectRejected(
        `INSERT INTO "Phase7ApprovedN4ReadingBatch7TagRegistration" ("batch") VALUES ('${batch}')`,
        '42501'
      )
      await expectRejected(
        'CREATE TABLE phase7_unapproved_batch7_write (id integer)',
        '42501'
      )
      await client.query('ROLLBACK TO SAVEPOINT runtime_authority')
      await client.query('RELEASE SAVEPOINT runtime_authority')
    }
    expect(await snapshot()).toEqual(before)
  })

  it('reaches the final15th cell with old128/151 preserved and rolls all new rows back', async () => {
    const before = await snapshot()
    await client.query(`CREATE TABLE "${schema}".phase7_batch7_old_tags AS SELECT * FROM "Tag";
      CREATE TABLE "${schema}".phase7_batch7_old_cells AS SELECT * FROM "TagApplicability";
      CREATE TABLE "${schema}".phase7_batch7_old_parent AS SELECT jsonb_build_object(
      'questions', (SELECT jsonb_agg(to_jsonb(q) ORDER BY q."id") FROM "Question" q),
      'versions', (SELECT jsonb_agg(to_jsonb(v) ORDER BY v."id") FROM "QuestionVersion" v),
      'options', (SELECT jsonb_agg(to_jsonb(o) ORDER BY o."id") FROM "QuestionOption" o),
      'snapshots', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t."id") FROM "QuestionVersionTag" t),
      'priorEvidence', (SELECT jsonb_agg(to_jsonb(e) ORDER BY e."batch") FROM "Phase7ApprovedN4N2ReadingTagRegistration" e)) AS state`)
    await client.query(`CREATE FUNCTION phase7_test_reject_last_batch7_tuple() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF EXISTS (SELECT 1 FROM "Tag" WHERE "id" = NEW."tagId" AND "normalizedName" = '출입 시간') THEN
        IF NEW."level" <> 'N4' OR NEW."subject" <> 'READING' OR NEW."questionType" <> 'INFO_RETRIEVAL'
          OR (SELECT COUNT(*) FROM "Tag") <> 143 OR (SELECT COUNT(*) FROM "TagApplicability") <> 166
          OR EXISTS (SELECT * FROM "${schema}".phase7_batch7_old_tags EXCEPT SELECT * FROM "Tag")
          OR (SELECT COUNT(*) FROM "Tag" WHERE "id" IN (SELECT "id" FROM "${schema}".phase7_batch7_old_tags)) <> 128
          OR EXISTS (SELECT * FROM "${schema}".phase7_batch7_old_cells EXCEPT SELECT * FROM "TagApplicability")
          OR (SELECT state FROM "${schema}".phase7_batch7_old_parent) IS DISTINCT FROM (jsonb_build_object(
      'questions', (SELECT jsonb_agg(to_jsonb(q) ORDER BY q."id") FROM "Question" q),
      'versions', (SELECT jsonb_agg(to_jsonb(v) ORDER BY v."id") FROM "QuestionVersion" v),
      'options', (SELECT jsonb_agg(to_jsonb(o) ORDER BY o."id") FROM "QuestionOption" o),
      'snapshots', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t."id") FROM "QuestionVersionTag" t),
      'priorEvidence', (SELECT jsonb_agg(to_jsonb(e) ORDER BY e."batch") FROM "Phase7ApprovedN4N2ReadingTagRegistration" e)))
          OR EXISTS (SELECT 1 FROM "Phase7ApprovedN4ReadingBatch7TagRegistration") THEN
          RAISE EXCEPTION 'synthetic failure missed exact final15th preserved state' USING ERRCODE = '23514';
        END IF;
        RAISE EXCEPTION 'synthetic final15th-tuple failure' USING ERRCODE = '23514';
      END IF; RETURN NEW; END $$`)
    await client.query(
      'REVOKE ALL ON FUNCTION phase7_test_reject_last_batch7_tuple() FROM PUBLIC'
    )
    await client.query(
      `CREATE TRIGGER approved_batch7_atomic_failure AFTER INSERT ON "TagApplicability" FOR EACH ROW EXECUTE FUNCTION phase7_test_reject_last_batch7_tuple()`
    )
    await expectRejected(command, '23514', 'synthetic final15th-tuple failure')
    expect(await snapshot()).toEqual(before)
    expect(await counts()).toEqual(baselineCounts)
  })

  it('adds only15 actual UUIDs/cells and validates original five without widening', async () => {
    const before = await snapshot()
    const payload = structuredClone(request)
    await apply()
    expect(await counts()).toEqual(afterCounts)
    const after = await snapshot()
    const oldKeys = new Set(before.applicability.map(tupleKey))
    const added = after.applicability.filter(
      (row) => !oldKeys.has(tupleKey(row))
    )
    expect(added).toHaveLength(15)
    expect(
      after.tags.filter(
        ({ normalizedName }) => !newNames.includes(normalizedName)
      )
    ).toEqual(before.tags)
    expect(
      after.applicability.filter((row) => oldKeys.has(tupleKey(row)))
    ).toEqual(before.applicability)
    for (const key of [
      'questions',
      'guards',
      'oldSecurity',
      'bindings',
      'ledger',
      'priorEvidence'
    ] as const) {
      expect(after[key]).toEqual(before[key])
    }
    const created = after.tags.filter(({ normalizedName }) =>
      newNames.includes(normalizedName)
    )
    expect(created).toHaveLength(15)
    expect(new Set(created.map(({ id }) => id)).size).toBe(15)
    for (const tag of created) {
      expect(tag.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
      )
      expect(before.tags.some(({ id }) => id === tag.id)).toBe(false)
      expect(tag.label).toBe(tag.normalizedName)
    }
    expect(added.map(tupleKey).toSorted()).toEqual(
      expectedTuples
        .map(({ label, ...cell }) => {
          const tag = created.find(
            ({ normalizedName }) => normalizedName === label
          )
          expect(tag).toBeDefined()
          return tupleKey({ tagId: tag!.id, ...cell })
        })
        .toSorted()
    )
    expect(after.newEvidence).toHaveLength(1)
    expect(after.newEvidence[0]).toMatchObject({ batch })
    expect(
      (
        await client.query(
          `SELECT COUNT(*)::int AS exact FROM "Tag" t JOIN "Phase7ApprovedN4ReadingBatch7TagRegistration" e
      ON t."createdAt" = e."appliedAt"::timestamptz(3) AND t."updatedAt" = e."appliedAt"::timestamptz(3)
      WHERE t."normalizedName" = ANY($1::text[])`,
          [newNames]
        )
      ).rows
    ).toEqual([{ exact: 15 }])
    for (const input of [request, priorRequest]) {
      const approved = await repository.validateImport(input)
      expect(approved.valid).toBe(true)
      expect(approved.errors).toEqual([])
    }
    for (const change of ['level', 'subject', 'type', 'name'] as const) {
      const wrong = await repository.validateImport({
        items: request.items.map((item) => ({
          ...item,
          content: {
            ...item.content,
            ...(change === 'level' ? { level: 'N1' as const } : {}),
            ...(change === 'subject' ? { subject: 'VOCABULARY' as const } : {}),
            ...(change === 'type'
              ? { questionType: 'MEDIUM_READING' as const }
              : {}),
            ...(change === 'name'
              ? {
                  tagNames: ['미승인 태그 1', '미승인 태그 2', '미승인 태그 3']
                }
              : {})
          }
        }))
      })
      expect(wrong.valid).toBe(false)
      expect(
        wrong.errors.filter(({ code }) => code === 'UNKNOWN_TAG')
      ).toHaveLength(15)
    }
    expect(request).toEqual(payload)
    expect(await snapshot()).toEqual(after)
  })

  it('rejects prefix drift and unfinished/rolled-back/extra/wrong canonical37 ledgers', async () => {
    const changes = [
      `UPDATE "_prisma_migrations" SET "checksum" = repeat('0', 64) WHERE "migration_name" = '20260827101000_phase7_admin_cms_foundation'`,
      `UPDATE "_prisma_migrations" SET "migration_name" = 'wrong_predecessor' WHERE "migration_name" = '20260827101000_phase7_admin_cms_foundation'`,
      `UPDATE "_prisma_migrations" SET "finished_at" = NULL WHERE "migration_name" = '${installation}'`,
      `UPDATE "_prisma_migrations" SET "rolled_back_at" = CURRENT_TIMESTAMP WHERE "migration_name" = '${installation}'`,
      `UPDATE "_prisma_migrations" SET "applied_steps_count" = 0 WHERE "migration_name" = '${installation}'`,
      `UPDATE "_prisma_migrations" SET "logs" = 'unapproved ledger error' WHERE "migration_name" = '${installation}'`,
      `UPDATE "_prisma_migrations" SET "migration_name" = 'wrong_append' WHERE "migration_name" = '${installation}'`,
      `INSERT INTO "_prisma_migrations" SELECT public.gen_random_uuid()::text, "checksum", "finished_at", 'extra_append', "logs", "rolled_back_at", "started_at", "applied_steps_count" FROM "_prisma_migrations" WHERE "migration_name" = '${installation}'`,
      `DELETE FROM "_prisma_migrations" WHERE "migration_name" = '${installation}'`
    ]
    for (const sql of changes) {
      await client.query('SAVEPOINT altered_ledger')
      await client.query(sql)
      const drift = await snapshot()
      await expectRejected(command, '23514')
      expect(await snapshot()).toEqual(drift)
      await client.query('ROLLBACK TO SAVEPOINT altered_ledger')
      await client.query('RELEASE SAVEPOINT altered_ledger')
    }
  })

  it('rejects count-preserving prior identities/cells/seed drift and pre-existing new names', async () => {
    const changes = [
      `UPDATE "Tag" SET "createdAt" = "createdAt" + interval '1 millisecond' WHERE "normalizedName" = '행동 변화'`,
      `UPDATE "TagApplicability" SET "level" = 'N1' WHERE "tagId" = (SELECT "id" FROM "Tag" WHERE "normalizedName" = '행동 변화')`,
      `UPDATE "Tag" SET "label" = 'seed identity drift' WHERE "normalizedName" = '짧은 글'`,
      `UPDATE "QuestionVersionTag" SET "labelSnapshot" = 'snapshot drift' WHERE "id" = (SELECT "id" FROM "QuestionVersionTag" LIMIT 1)`,
      `UPDATE "QuestionVersion" SET "questionText" = "questionText" || ' drift' WHERE "id" = (SELECT "id" FROM "QuestionVersion" LIMIT 1)`,
      `DO $$ DECLARE old_id UUID; new_id UUID := public.gen_random_uuid(); BEGIN
        SELECT "id" INTO old_id FROM "Tag" WHERE "normalizedName" = '행동 변화';
        INSERT INTO "Tag" SELECT new_id, "label" || ' drift', "normalizedName" || ' drift', "createdAt", "updatedAt" FROM "Tag" WHERE "id" = old_id;
        UPDATE "TagApplicability" SET "tagId" = new_id WHERE "tagId" = old_id;
        DELETE FROM "Tag" WHERE "id" = old_id;
        UPDATE "Tag" SET "label" = '행동 변화', "normalizedName" = '행동 변화' WHERE "id" = new_id; END $$`,
      `INSERT INTO "Tag" ("id", "label", "normalizedName", "createdAt", "updatedAt") VALUES (public.gen_random_uuid(), '전달 메모', '전달 메모', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      `INSERT INTO "Tag" ("id", "label", "normalizedName", "createdAt", "updatedAt") VALUES (public.gen_random_uuid(), '전달 메모', '전달 메모', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
       INSERT INTO "TagApplicability" SELECT "id", 'N4', 'READING', 'SHORT_READING' FROM "Tag" WHERE "normalizedName" = '전달 메모'`
    ]
    // Trusted owner fault injection only, rolled back per subcase. Restore guards
    // BEFORE invoking the command so each rejection uses the real trigger policy.
    for (const sql of changes) {
      await client.query('SAVEPOINT altered_parent')
      for (const table of [
        'Tag',
        'TagApplicability',
        'QuestionVersionTag',
        'QuestionVersion'
      ]) {
        await client.query(`ALTER TABLE "${table}" DISABLE TRIGGER USER`)
      }
      await client.query(sql)
      for (const table of [
        'Tag',
        'TagApplicability',
        'QuestionVersionTag',
        'QuestionVersion'
      ]) {
        await client.query(`ALTER TABLE "${table}" ENABLE TRIGGER USER`)
      }
      const drift = await snapshot()
      // A caller-supplied digest matching the altered rows must not replace the
      // installer's checkpoint. Exercise the full-row guard with unchanged counts.
      if (sql === changes[5]) {
        await client.query(`SELECT pg_catalog.set_config('app.phase7_batch7_predecessor_digest',
          encode(public.digest(convert_to(jsonb_build_object(
            'tags', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t."id") FROM "Tag" t),
            'applicability', (SELECT jsonb_agg(to_jsonb(a) ORDER BY a."tagId", a."level", a."subject", a."questionType") FROM "TagApplicability" a),
            'priorEvidence', (SELECT jsonb_agg(to_jsonb(e) ORDER BY e."batch") FROM "Phase7ApprovedN4N2ReadingTagRegistration" e),
            'questions', (SELECT jsonb_agg(to_jsonb(q) ORDER BY q."id") FROM "Question" q),
            'versions', (SELECT jsonb_agg(to_jsonb(v) ORDER BY v."id") FROM "QuestionVersion" v),
            'options', (SELECT jsonb_agg(to_jsonb(o) ORDER BY o."id") FROM "QuestionOption" o),
            'snapshots', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s."id") FROM "QuestionVersionTag" s)
          )::text, 'UTF8'), 'sha256'), 'hex'), true)`)
      }
      await client.query('SET LOCAL ROLE nihongo_phase7_migration')
      await expectRejected(
        command,
        '23514',
        sql === changes[5]
          ? 'Batch7 sealed predecessor rows drifted.'
          : undefined
      )
      await client.query('SET LOCAL ROLE nihongo_phase7_owner')
      expect(await snapshot()).toEqual(drift)
      await client.query('ROLLBACK TO SAVEPOINT altered_parent')
      await client.query('RELEASE SAVEPOINT altered_parent')
    }
  })

  it('rejects missing predecessor, current-catalog counts, earlier evidence and changed65', async () => {
    const priorNewNames = [
      '행동 변화',
      '재사용',
      '요금',
      '예외 조건',
      '비교',
      '선택 이유',
      '행동 순서',
      '요리',
      '분리배출',
      '물품별 조건',
      '사례 종합',
      '역사와 지속 이용',
      '조사 해석',
      '판단 근거',
      '운영 조정',
      '상충 요구',
      '반환 연장',
      '복수 조건',
      '누적 상한',
      '다음 개실일'
    ]
    const removePrior = `DELETE FROM "TagApplicability" WHERE "tagId" IN (SELECT "id" FROM "Tag" WHERE "normalizedName" = ANY($1::text[]))
      OR ("subject" = 'READING' AND (("level" = 'N4' AND "tagId" IN (SELECT "id" FROM "Tag" WHERE "normalizedName" IN ('짧은 글', '정보 찾기')))
      OR ("level" = 'N2' AND "tagId" IN (SELECT "id" FROM "Tag" WHERE "normalizedName" IN ('중문 독해', '정보 찾기')))))`
    for (const profile of [
      'original108/127',
      'current107/126',
      'N5 evidence',
      'N3 evidence',
      'changed65'
    ] as const) {
      await client.query('SAVEPOINT wrong_profile')
      for (const table of [
        'Tag',
        'TagApplicability',
        'QuestionVersionTag',
        'Question',
        'Phase7ApprovedN4N2ReadingTagRegistration',
        'Phase7ApprovedReadingTagRegistration',
        'Phase7ApprovedN3ReadingTagRegistration'
      ]) {
        await client.query(`ALTER TABLE "${table}" DISABLE TRIGGER USER`)
      }
      if (profile === 'original108/127' || profile === 'current107/126') {
        await client.query(removePrior, [priorNewNames])
        await client.query(
          'DELETE FROM "Tag" WHERE "normalizedName" = ANY($1::text[])',
          [priorNewNames]
        )
        await client.query(
          'DELETE FROM "Phase7ApprovedN4N2ReadingTagRegistration"'
        )
        expect(await counts()).toEqual({
          ...baselineCounts,
          tags: 108,
          applicability: 127,
          registrations: 0
        })
        if (profile === 'current107/126') {
          // Synthetic wrong profile, not an actual source-seed replay.
          await client.query(`DO $$ DECLARE removed UUID; BEGIN SELECT t."id" INTO removed FROM "Tag" t
            WHERE (SELECT COUNT(*) FROM "TagApplicability" a WHERE a."tagId" = t."id") = 1 LIMIT 1;
            DELETE FROM "QuestionVersionTag" WHERE "tagId" = removed;
            DELETE FROM "TagApplicability" WHERE "tagId" = removed;
            DELETE FROM "Tag" WHERE "id" = removed; END $$`)
          const actual = await counts()
          expect(actual?.tags).toBe(107)
          expect(actual?.applicability).toBe(126)
        }
      } else if (profile === 'N5 evidence') {
        await client.query(
          `INSERT INTO "Phase7ApprovedReadingTagRegistration" ("batch") VALUES ('jlp-208-n5-reading-tags-v1')`
        )
      } else if (profile === 'N3 evidence') {
        await client.query(
          `INSERT INTO "Phase7ApprovedN3ReadingTagRegistration" ("batch") VALUES ('jlp-429-n3-reading04-tags-v1')`
        )
      } else {
        await client.query(
          `UPDATE "Question" SET "rowVersion" = 2 WHERE "id" = (SELECT "id" FROM "Question" LIMIT 1)`
        )
      }
      for (const table of [
        'Tag',
        'TagApplicability',
        'QuestionVersionTag',
        'Question',
        'Phase7ApprovedN4N2ReadingTagRegistration',
        'Phase7ApprovedReadingTagRegistration',
        'Phase7ApprovedN3ReadingTagRegistration'
      ]) {
        await client.query(`ALTER TABLE "${table}" ENABLE TRIGGER USER`)
      }
      const drift = await snapshot()
      await expectRejected(command, '23514')
      expect(await snapshot()).toEqual(drift)
      await client.query('ROLLBACK TO SAVEPOINT wrong_profile')
      await client.query('RELEASE SAVEPOINT wrong_profile')
    }
  })

  it('rejects replay and evidence mutation while retaining old strict commands', async () => {
    await apply()
    const applied = await snapshot()
    for (const sql of [
      command,
      'SELECT "apply_phase7_approved_n4_n2_reading_tags"()',
      'SELECT "apply_phase7_approved_reading_tags"()',
      'SELECT "apply_phase7_approved_n3_reading_tags"()'
    ]) {
      await expectRejected(sql, '23514')
    }
    for (const table of [
      'Phase7ApprovedN4ReadingBatch7TagRegistration',
      'Phase7ApprovedN4N2ReadingTagRegistration'
    ]) {
      await expectRejected(
        `UPDATE "${table}" SET "batch" = 'other-batch'`,
        '42501'
      )
      await expectRejected(`DELETE FROM "${table}"`, '42501')
      await expectRejected(`TRUNCATE "${table}"`, '42501')
    }
    expect(await snapshot()).toEqual(applied)
    expect(await counts()).toEqual(afterCounts)
  })
}

if (fixtureProfile === 'legacy') {
  describe(
    'approved N4 reading Batch7 staged dictionary database contract',
    defineLegacyFixtureTests
  )
}

// The current profile keeps its explicitly prepared external fixture.
// Run legacy8 and current8 separately. Selection does not skip individual cases.
if (fixtureProfile === 'current') {
  const currentCounts = {
    ...baselineCounts,
    tags: 107,
    applicability: 126,
    registrations: 0
  }
  const migrationSql = readFileSync(
    new URL(
      `../../prisma/migrations/${installation}/migration.sql`,
      import.meta.url
    ),
    'utf8'
  )
  const predecessorStart = migrationSql.indexOf('DO $predecessor$')
  const predecessorEnd = migrationSql.indexOf(
    '$predecessor$;',
    predecessorStart
  )
  if (predecessorStart < 0 || predecessorEnd < 0) {
    throw new Error('Batch7 predecessor installation guard is missing.')
  }
  const predecessorSql = migrationSql.slice(
    predecessorStart,
    predecessorEnd + '$predecessor$;'.length
  )
  const parentDigest = async () => {
    const result = await client.query<{ digest: string }>(
      `SELECT encode(public.digest(convert_to(jsonb_build_object(
        'tags', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t."id") FROM "Tag" t),
        'applicability', (SELECT jsonb_agg(to_jsonb(a) ORDER BY a."tagId", a."level", a."subject", a."questionType") FROM "TagApplicability" a),
        'priorEvidence', (SELECT jsonb_agg(to_jsonb(e) ORDER BY e."batch") FROM "Phase7ApprovedN4N2ReadingTagRegistration" e),
        'questions', (SELECT jsonb_agg(to_jsonb(q) ORDER BY q."id") FROM "Question" q),
        'versions', (SELECT jsonb_agg(to_jsonb(v) ORDER BY v."id") FROM "QuestionVersion" v),
        'options', (SELECT jsonb_agg(to_jsonb(o) ORDER BY o."id") FROM "QuestionOption" o),
        'snapshots', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s."id") FROM "QuestionVersionTag" s)
      )::text, 'UTF8'), 'sha256'), 'hex') AS digest`
    )
    const digest = result.rows[0]?.digest
    expect(digest).toMatch(/^[0-9a-f]{64}$/u)
    if (!digest)
      throw new Error('Current full-row predecessor digest is absent.')
    return digest
  }
  const expectInstallationRejected = async (
    change: string,
    tables: readonly string[] = [],
    message?: string
  ) => {
    await client.query('SAVEPOINT current_fault')
    for (const table of tables) {
      await client.query(`ALTER TABLE "${table}" DISABLE TRIGGER USER`)
    }
    await client.query(change)
    for (const table of tables) {
      await client.query(`ALTER TABLE "${table}" ENABLE TRIGGER USER`)
    }
    // Owner-only negative fault injection; real guards are restored before use.
    // Never repair, spoof or resolve a ledger to produce a successful bootstrap.
    const changed = await snapshot()
    await expectRejected(predecessorSql, '23514', message)
    expect(await snapshot()).toEqual(changed)
    await client.query('ROLLBACK TO SAVEPOINT current_fault')
    await client.query('RELEASE SAVEPOINT current_fault')
  }

  describe('approved N4 reading Batch7 current installation database contract', () => {
    beforeAll(async () => {
      client = new Client({
        connectionString: connectionUrl.toString(),
        options: createPostgresStartupOptions(schema)
      })
      await client.connect()
    })
    afterAll(async () => {
      await client.end()
    })
    beforeEach(async () => {
      await client.query('BEGIN')
      await client.query('SET LOCAL ROLE nihongo_phase7_owner')
      await client.query("SET LOCAL TIME ZONE 'UTC'")
      expect(await counts()).toEqual(currentCounts)
      expect((await snapshot()).newEvidence).toEqual([])
      const expected = loadExpectedMigrationManifest()
      expect(expected).toHaveLength(38)
      expect(expected.at(-1)?.name).toBe(installation)
      const ledger = await client.query<{
        name: string
        checksum: string
        complete: boolean
      }>(
        `SELECT migration_name AS name, checksum,
        finished_at IS NOT NULL AND rolled_back_at IS NULL AND COALESCE(btrim(logs), '') = ''
          AND applied_steps_count = 1 AS complete FROM "_prisma_migrations" ORDER BY migration_name COLLATE "C"`
      )
      expect(ledger.rows).toEqual(
        expected.map((row) => ({ ...row, complete: true }))
      )
      for (const [name, hash] of sourceFiles) {
        expect(
          createHash('sha256')
            .update(readFileSync(new URL(name, import.meta.url)))
            .digest('hex')
        ).toBe(hash)
      }
    })
    afterEach(async () => {
      await client.query('ROLLBACK')
    })

    it('installs the actual current SQL objects atomically without changing parent rows or ledger', async () => {
      const before = await snapshot()
      const digest = await parentDigest()
      // Recreate ONLY this append's objects inside the test transaction. Existing
      // completed38 rows are untouched; installation excludes its optional own row.
      await client.query(
        'DROP TABLE "Phase7ApprovedN4ReadingBatch7TagRegistration" CASCADE'
      )
      for (const name of [
        'apply_phase7_approved_n4_reading_batch7_tags',
        'register_phase7_approved_n4_reading_batch7_tag_rows',
        'protect_phase7_approved_n4_reading_batch7_tag_registration'
      ]) {
        await client.query(`DROP FUNCTION "${name}"()`)
      }
      expect(migrationSql.match(/^BEGIN;$/gmu)).toHaveLength(1)
      expect(migrationSql.match(/^COMMIT;$/gmu)).toHaveLength(1)
      await client.query(
        migrationSql.replace(/^BEGIN;$/mu, '').replace(/^COMMIT;$/mu, '')
      )
      await client.query('SET LOCAL ROLE nihongo_phase7_owner')
      expect(await counts()).toEqual(currentCounts)
      expect(await snapshot()).toEqual(before)
      expect(await parentDigest()).toBe(digest)

      // A seal failure after DDL must also restore the prior objects and rows.
      await client.query('SAVEPOINT current_install_atomicity')
      await client.query(
        'DROP TABLE "Phase7ApprovedN4ReadingBatch7TagRegistration" CASCADE'
      )
      for (const name of [
        'apply_phase7_approved_n4_reading_batch7_tags',
        'register_phase7_approved_n4_reading_batch7_tag_rows',
        'protect_phase7_approved_n4_reading_batch7_tag_registration'
      ]) {
        await client.query(`DROP FUNCTION "${name}"()`)
      }
      const invalidSeal = migrationSql
        .replace(/^BEGIN;$/mu, '')
        .replace(/^COMMIT;$/mu, '')
        .replace(
          "sealed_installation_profile CONSTANT TEXT := 'JLP483_BATCH7_PROFILE_UNSET';",
          "sealed_installation_profile CONSTANT TEXT := 'unapproved';"
        )
      expect(invalidSeal).not.toBe(
        migrationSql.replace(/^BEGIN;$/mu, '').replace(/^COMMIT;$/mu, '')
      )
      await expectRejected(
        invalidSeal,
        '23514',
        'Batch7 predecessor digest seal is missing.'
      )
      await client.query('ROLLBACK TO SAVEPOINT current_install_atomicity')
      await client.query('RELEASE SAVEPOINT current_install_atomicity')
      expect(await snapshot()).toEqual(before)
      expect(await parentDigest()).toBe(digest)
    })

    it('seals this current full-row predecessor and pins profile, owner, path and migration-only execution', async () => {
      const result = await client.query<{
        name: string
        owner: string
        definer: boolean
        config: string[]
        body: string
        publicExecute: boolean
      }>(
        `SELECT p.proname AS name, r.rolname AS owner, p.prosecdef AS definer, p.proconfig AS config, p.prosrc AS body,
        EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
          WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS "publicExecute"
        FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        JOIN pg_catalog.pg_roles r ON r.oid = p.proowner WHERE n.nspname = $1 AND p.proname = ANY($2::text[])`,
        [
          schema,
          [
            'protect_phase7_approved_n4_reading_batch7_tag_registration',
            'register_phase7_approved_n4_reading_batch7_tag_rows',
            'apply_phase7_approved_n4_reading_batch7_tags'
          ]
        ]
      )
      expect(result.rows).toHaveLength(3)
      for (const row of result.rows) {
        expect(row.owner).toBe('nihongo_phase7_owner')
        expect(row.config).toContain(
          `search_path=pg_catalog, ${schema}, pg_temp`
        )
        expect(row.definer).toBe(!row.name.startsWith('protect_'))
        expect(row.publicExecute).toBe(false)
        if (row.name.startsWith('register_')) {
          expect(row.body).toContain(
            `sealed_predecessor_digest CONSTANT TEXT := '${await parentDigest()}';`
          )
          expect(row.body).toContain(
            "sealed_installation_profile CONSTANT TEXT := 'CURRENT_PHYSICAL37';"
          )
          expect(row.body).not.toContain('JLP483_BATCH7_PROFILE_UNSET')
          expect(row.body).not.toContain(
            'JLP478_BATCH7_PREDECESSOR_DIGEST_UNSET'
          )
          expect(row.config.map((value) => value.toLowerCase())).toContain(
            'timezone=utc'
          )
          expect(
            row.config.some((value) => value.startsWith('app.phase7_batch7_'))
          ).toBe(false)
        }
      }
      expect(
        (
          await client.query(`SELECT has_function_privilege('nihongo_phase7_migration', 'apply_phase7_approved_n4_reading_batch7_tags()', 'EXECUTE') AS allowed,
        has_table_privilege('nihongo_phase7_migration', '"Phase7ApprovedN4ReadingBatch7TagRegistration"', 'INSERT,UPDATE,DELETE,TRUNCATE') AS write`)
        ).rows
      ).toEqual([{ allowed: true, write: false }])
      for (const role of runtimeRoles) {
        await client.query(`SET LOCAL ROLE "${role}"`)
        await expectRejected(command, '42501')
        await client.query('SET LOCAL ROLE nihongo_phase7_owner')
      }
    })

    it('rejects altered, incomplete, rolled-back, missing-catalog and extra current predecessor rows', async () => {
      for (const change of [
        `UPDATE "_prisma_migrations" SET "checksum" = repeat('0',64) WHERE "migration_name" = '20261005183000_phase7_reviewed_catalog_current'`,
        `UPDATE "_prisma_migrations" SET "finished_at" = NULL WHERE "migration_name" = '20261005183000_phase7_reviewed_catalog_current'`,
        `UPDATE "_prisma_migrations" SET "rolled_back_at" = CURRENT_TIMESTAMP WHERE "migration_name" = '20261005183000_phase7_reviewed_catalog_current'`,
        `UPDATE "_prisma_migrations" SET "applied_steps_count" = 0 WHERE "migration_name" = '20261005183000_phase7_reviewed_catalog_current'`,
        `UPDATE "_prisma_migrations" SET "logs" = 'unapproved error' WHERE "migration_name" = '20261005183000_phase7_reviewed_catalog_current'`,
        `UPDATE "_prisma_migrations" SET "migration_name" = 'wrong_current_catalog' WHERE "migration_name" = '20261005183000_phase7_reviewed_catalog_current'`,
        `DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261005183000_phase7_reviewed_catalog_current'`,
        `INSERT INTO "_prisma_migrations" SELECT public.gen_random_uuid()::text, "checksum", "finished_at", 'extra_append', "logs", "rolled_back_at", "started_at", "applied_steps_count" FROM "_prisma_migrations" WHERE "migration_name" = '${installation}'`
      ]) {
        await expectInstallationRejected(change)
      }
    })

    it('rejects wrong dictionary counts and every historical registration residue', async () => {
      await expectInstallationRejected(
        `DELETE FROM "TagApplicability" WHERE ("tagId", "level", "subject", "questionType") =
          (SELECT "tagId", "level", "subject", "questionType" FROM "TagApplicability" LIMIT 1)`,
        ['TagApplicability']
      )
      await expectInstallationRejected(
        `INSERT INTO "Tag" ("id", "label", "normalizedName", "createdAt", "updatedAt")
          VALUES (public.gen_random_uuid(), 'unapproved tag', 'unapproved tag', '2026-01-01', '2026-01-01')`,
        ['Tag']
      )
      for (const [table, batchName] of [
        ['Phase7ApprovedReadingTagRegistration', 'jlp-208-n5-reading-tags-v1'],
        [
          'Phase7ApprovedN3ReadingTagRegistration',
          'jlp-429-n3-reading04-tags-v1'
        ],
        [
          'Phase7ApprovedN4N2ReadingTagRegistration',
          'jlp-449-n4-n2-reading-tags-v1'
        ]
      ] as const) {
        await expectInstallationRejected(
          `INSERT INTO "${table}" ("batch") VALUES ('${batchName}')`,
          [table]
        )
      }
      // Nonempty review/audit/report/intent predicates are pinned by the static
      // companion; fabricating foreign user/operation graphs is outside this fixture.
    })

    it('rejects count-preserving content, option, assignment and applicability drift', async () => {
      for (const [change, table] of [
        [
          `UPDATE "QuestionVersion" SET "explanationKo" = "explanationKo" || ' drift' WHERE "id" = (SELECT "id" FROM "QuestionVersion" LIMIT 1)`,
          'QuestionVersion'
        ],
        [
          `UPDATE "QuestionOption" SET "text" = "text" || ' drift' WHERE "id" = (SELECT "id" FROM "QuestionOption" LIMIT 1)`,
          'QuestionOption'
        ],
        [
          `UPDATE "QuestionVersionTag" SET "normalizedNameSnapshot" = 'snapshot drift' WHERE "id" = (SELECT "id" FROM "QuestionVersionTag" LIMIT 1)`,
          'QuestionVersionTag'
        ],
        [
          `UPDATE "TagApplicability" SET "level" = 'N1' WHERE "level" = 'N5' AND ("tagId", "level", "subject", "questionType") = (SELECT "tagId", "level", "subject", "questionType" FROM "TagApplicability" a WHERE a."level" = 'N5' AND NOT EXISTS (SELECT 1 FROM "TagApplicability" other WHERE other."tagId" = a."tagId" AND other."level" = 'N1' AND other."subject" = a."subject" AND other."questionType" = a."questionType") ORDER BY "tagId" LIMIT 1)`,
          'TagApplicability'
        ]
      ] as const) {
        await expectInstallationRejected(change, [table])
        expect(await counts()).toEqual(currentCounts)
      }
    })

    it('rejects count-preserving provenance, timestamps and original identities', async () => {
      for (const [change, table] of [
        [
          `UPDATE "Question" SET "rowVersion" = 2 WHERE "id" = (SELECT "id" FROM "Question" LIMIT 1)`,
          'Question'
        ],
        [
          `UPDATE "QuestionVersion" SET "createdByLabelSnapshot" = 'unapproved creator' WHERE "id" = (SELECT "id" FROM "QuestionVersion" LIMIT 1)`,
          'QuestionVersion'
        ],
        [
          `UPDATE "Tag" SET "createdAt" = "createdAt" + interval '1 millisecond' WHERE "normalizedName" = '짧은 글'`,
          'Tag'
        ],
        [
          `UPDATE "Tag" SET "label" = 'identity drift' WHERE "normalizedName" = '짧은 글'`,
          'Tag'
        ]
      ] as const) {
        await expectInstallationRejected(change, [table])
        expect(await counts()).toEqual(currentCounts)
      }
    })

    it('rejects forged caller profile/digest settings matching altered current rows', async () => {
      await client.query('SAVEPOINT forged_current')
      await client.query('ALTER TABLE "Tag" DISABLE TRIGGER USER')
      await client.query(
        `UPDATE "Tag" SET "createdAt" = "createdAt" + interval '1 millisecond' WHERE "normalizedName" = '짧은 글'`
      )
      await client.query('ALTER TABLE "Tag" ENABLE TRIGGER USER')
      const changed = await snapshot()
      const forged = await parentDigest()
      await client.query(
        "SELECT pg_catalog.set_config('app.phase7_batch7_predecessor_digest', $1, true), pg_catalog.set_config('app.phase7_batch7_installation_profile', 'LEGACY_CANONICAL36', true)",
        [forged]
      )
      await expectRejected(predecessorSql, '23514')
      await client.query('SET LOCAL ROLE nihongo_phase7_migration')
      await expectRejected(
        command,
        '23514',
        'Batch7 historical registration is unavailable on the current catalog.'
      )
      await client.query('SET LOCAL ROLE nihongo_phase7_owner')
      expect(await snapshot()).toEqual(changed)
      await client.query('ROLLBACK TO SAVEPOINT forged_current')
      await client.query('RELEASE SAVEPOINT forged_current')
    })

    it('retains current dictionary and empty evidence while rejecting old commands and direct writes', async () => {
      const before = await snapshot()
      await client.query('SET LOCAL ROLE nihongo_phase7_migration')
      await expectRejected(
        `INSERT INTO "Phase7ApprovedN4ReadingBatch7TagRegistration" ("batch") VALUES ('${batch}')`,
        '42501'
      )
      for (const sql of [
        command,
        'SELECT "apply_phase7_approved_n4_n2_reading_tags"()',
        'SELECT "apply_phase7_approved_reading_tags"()',
        'SELECT "apply_phase7_approved_n3_reading_tags"()'
      ]) {
        await expectRejected(sql, '23514')
      }
      await client.query('SET LOCAL ROLE nihongo_phase7_owner')
      for (const sql of [
        `UPDATE "Tag" SET "label" = 'drift' WHERE "normalizedName" = '짧은 글'`,
        'DELETE FROM "TagApplicability"',
        'TRUNCATE "Phase7ApprovedN4ReadingBatch7TagRegistration"'
      ]) {
        await expectRejected(sql, '42501')
      }
      expect(await snapshot()).toEqual(before)
      expect(await counts()).toEqual(currentCounts)
    })
  })
}
