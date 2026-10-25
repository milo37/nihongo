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
import { toStableSeedUuid } from '../../prisma/seed-data/id.js'
import {
  approvedReadingBatch2,
  createApprovedReadingBatch2Import
} from './approvedReadingBatch2.js'
import {
  approvedReadingBatch4,
  createApprovedReadingBatch4Import
} from './approvedReadingBatch4.js'

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
} = createPhase7HistoricalSchemaFixture({
  adminDatabaseUrl: adminUrl,
  legacyDatabaseUrl,
  migrationDatabaseUrl,
  expect
})
let historicalContext: IsolatedUpgradeSchema | undefined
let client: Client
const runtimeRoles = [
  'nihongo_app',
  'nihongo_auth_gateway',
  'nihongo_erasure_worker'
] as const
const batch = 'jlp-449-n4-n2-reading-tags-v1'
const installation = '20261009072500_phase7_approved_n4_n2_reading_tags'
const correction = '20261009092000_phase7_n4_n2_revision2_digest_fix'
const command = 'SELECT "apply_phase7_approved_n4_n2_reading_tags"()'
const baselineCounts = {
  questions: 65,
  versions: 65,
  options: 260,
  tags: 108,
  applicability: 127,
  snapshots: 130,
  oldRegistrations: 0,
  n3Registrations: 0,
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
const request = {
  items: [
    ...createApprovedReadingBatch2Import().items,
    ...createApprovedReadingBatch4Import().items
  ]
}
interface ExpectedTuple {
  name: string
  level: string
  subject: string
  questionType: string
  isNew: boolean
}
const expectedTuples: readonly ExpectedTuple[] = [
  {
    name: '짧은 글',
    level: 'N4',
    subject: 'READING',
    questionType: 'SHORT_READING',
    isNew: false
  },
  {
    name: '정보 찾기',
    level: 'N4',
    subject: 'READING',
    questionType: 'INFO_RETRIEVAL',
    isNew: false
  },
  {
    name: '중문 독해',
    level: 'N2',
    subject: 'READING',
    questionType: 'MEDIUM_READING',
    isNew: false
  },
  {
    name: '정보 찾기',
    level: 'N2',
    subject: 'READING',
    questionType: 'INFO_RETRIEVAL',
    isNew: false
  },
  {
    name: '행동 변화',
    level: 'N4',
    subject: 'READING',
    questionType: 'SHORT_READING',
    isNew: true
  },
  {
    name: '재사용',
    level: 'N4',
    subject: 'READING',
    questionType: 'SHORT_READING',
    isNew: true
  },
  {
    name: '요금',
    level: 'N4',
    subject: 'READING',
    questionType: 'INFO_RETRIEVAL',
    isNew: true
  },
  {
    name: '예외 조건',
    level: 'N4',
    subject: 'READING',
    questionType: 'INFO_RETRIEVAL',
    isNew: true
  },
  {
    name: '비교',
    level: 'N4',
    subject: 'READING',
    questionType: 'SHORT_READING',
    isNew: true
  },
  {
    name: '선택 이유',
    level: 'N4',
    subject: 'READING',
    questionType: 'SHORT_READING',
    isNew: true
  },
  {
    name: '행동 순서',
    level: 'N4',
    subject: 'READING',
    questionType: 'SHORT_READING',
    isNew: true
  },
  {
    name: '요리',
    level: 'N4',
    subject: 'READING',
    questionType: 'SHORT_READING',
    isNew: true
  },
  {
    name: '분리배출',
    level: 'N4',
    subject: 'READING',
    questionType: 'INFO_RETRIEVAL',
    isNew: true
  },
  {
    name: '물품별 조건',
    level: 'N4',
    subject: 'READING',
    questionType: 'INFO_RETRIEVAL',
    isNew: true
  },
  {
    name: '사례 종합',
    level: 'N2',
    subject: 'READING',
    questionType: 'MEDIUM_READING',
    isNew: true
  },
  {
    name: '역사와 지속 이용',
    level: 'N2',
    subject: 'READING',
    questionType: 'MEDIUM_READING',
    isNew: true
  },
  {
    name: '조사 해석',
    level: 'N2',
    subject: 'READING',
    questionType: 'MEDIUM_READING',
    isNew: true
  },
  {
    name: '판단 근거',
    level: 'N2',
    subject: 'READING',
    questionType: 'MEDIUM_READING',
    isNew: true
  },
  {
    name: '운영 조정',
    level: 'N2',
    subject: 'READING',
    questionType: 'MEDIUM_READING',
    isNew: true
  },
  {
    name: '상충 요구',
    level: 'N2',
    subject: 'READING',
    questionType: 'MEDIUM_READING',
    isNew: true
  },
  {
    name: '반환 연장',
    level: 'N2',
    subject: 'READING',
    questionType: 'INFO_RETRIEVAL',
    isNew: true
  },
  {
    name: '복수 조건',
    level: 'N2',
    subject: 'READING',
    questionType: 'INFO_RETRIEVAL',
    isNew: true
  },
  {
    name: '누적 상한',
    level: 'N2',
    subject: 'READING',
    questionType: 'INFO_RETRIEVAL',
    isNew: true
  },
  {
    name: '다음 개실일',
    level: 'N2',
    subject: 'READING',
    questionType: 'INFO_RETRIEVAL',
    isNew: true
  }
]
const newNames = expectedTuples
  .filter(({ isNew }) => isNew)
  .map(({ name }) => name)
const approvedItems = [
  {
    id: 'n4-reading-04',
    draftId: 'JLP-209-n4-reading-04-draft1',
    sourceSha256:
      '45ceb85ca0b3f737b46c2c5491f4439dcc82501a5d86dba72de787c873ef2dc6',
    originalTagNames: ['짧은 글', '행동 변화', '재사용']
  },
  {
    id: 'n4-reading-05',
    draftId: 'JLP-209-n4-reading-05-draft1',
    sourceSha256:
      'bd0b6ea588b7294aa0ae1ba4fb258edbf42d9e506fb3ac96a18cf4688698af5c',
    originalTagNames: ['정보 찾기', '요금', '예외 조건']
  },
  {
    id: 'n4-reading-06',
    draftId: 'JLP-209-n4-reading-06-draft1',
    sourceSha256:
      '851d5b6be6e19634dfd94c9965b294cd615245ad5d27843ff857cfbe6e4e1efe',
    originalTagNames: ['짧은 글', '비교', '선택 이유']
  },
  {
    id: 'n4-reading-07',
    draftId: 'JLP-209-n4-reading-07-draft1',
    sourceSha256:
      '6ac45b35a46bf4209a001ca83c006f9f6f7c143387745ccea910a85bd4440342',
    originalTagNames: ['짧은 글', '행동 순서', '요리']
  },
  {
    id: 'n4-reading-08',
    draftId: 'JLP-209-n4-reading-08-draft1',
    sourceSha256:
      'abae1a1d37844ea7d273483d964dfe844f76ba90029eba738ce6d5f215687d1d',
    originalTagNames: ['정보 찾기', '분리배출', '물품별 조건']
  },
  {
    id: 'n2-reading-04',
    draftId: 'JLP-216-n2-reading-04-draft1',
    sourceSha256:
      'a202d40cd796789b9cc15e96d001a12398a32143814506eb36365a54a23b9c2b',
    originalTagNames: ['중문 독해', '사례 종합', '역사와 지속 이용']
  },
  {
    id: 'n2-reading-05',
    draftId: 'JLP-216-n2-reading-05-draft1',
    sourceSha256:
      '224d1dc2a114f43bc3eba341b44e7ece64ed2a7bd92187b2f122c955ae3c088d',
    originalTagNames: ['중문 독해', '조사 해석', '판단 근거']
  },
  {
    id: 'n2-reading-06',
    draftId: 'JLP-216-n2-reading-06-draft1',
    sourceSha256:
      'e1c66cf7f08677cbe2beacbdd05a70dddcc8551d4f6343d072069d69fdd4fe0e',
    originalTagNames: ['중문 독해', '운영 조정', '상충 요구']
  },
  {
    id: 'n2-reading-07',
    draftId: 'JLP-216-n2-reading-07-draft1',
    sourceSha256:
      '5b25a9e9746678b34bb35d816668a2bb7f9e4ff0d0e97a033a53bb3ec053b9be',
    originalTagNames: ['정보 찾기', '반환 연장', '복수 조건']
  },
  {
    id: 'n2-reading-08',
    draftId: 'JLP-216-n2-reading-08-draft1',
    sourceSha256:
      'de24855fced46281524a700c04556ef41c28116ebcc015853c0708ffaa96f28f',
    originalTagNames: ['정보 찾기', '누적 상한', '다음 개실일']
  }
]
const sourceFiles = [
  [
    'approvedReadingBatch2.ts',
    '5125f9718e9e98d752ea52f9b110d69d2681c96bf5e9611898a587a9b4adbb2f'
  ],
  [
    'approvedReadingBatch4.ts',
    '6547f7a5a9adb61d4a194d17e27403c00ff849776c39e6fcdbfef07a2bc00871'
  ],
  [
    'approvedReadingBatch2.test.ts',
    '89886531ea3f3911b55085cc71c334442361a2db3ebbf5956e8d5ed083fc38fc'
  ],
  [
    'approvedReadingBatch4.test.ts',
    'd3ec444d0758ee11dded4760a430513a83b89b8c0776b77a8c267b789e5d5c92'
  ]
] as const
const afterCounts = {
  ...baselineCounts,
  tags: 128,
  applicability: 151,
  registrations: 1
}
const tupleKey = ({ tagId, level, subject, questionType }: ApplicabilityRow) =>
  [tagId, level, subject, questionType].join('\0')
const apply = async () => {
  await client.query('SET LOCAL ROLE nihongo_phase7_migration')
  await client.query(command)
  await client.query('SET LOCAL ROLE nihongo_phase7_owner')
}

// Deploy empty canonical36 through correction before inserting the reviewed revision2
// cohort. Setup installs command definitions without applying any registration.
// Every test is one transaction; even synthetic failures roll back in afterEach.
describe('approved N4/N2 reading dictionary database contract', () => {
  beforeAll(async () => {
    const context = await createIsolatedUpgradeSchema()
    historicalContext = context
    client = context.adminClient
    schema = context.schemaName
    const expected = loadExpectedMigrationManifest().filter(
      ({ name }) =>
        name <= correction &&
        name !== '20261005183000_phase7_reviewed_catalog_current'
    )
    expect(expected).toHaveLength(36)
    expect(expected.at(-2)?.name).toBe(installation)
    expect(expected.at(-1)?.name).toBe(correction)
    await context.serverClient.query(
      `GRANT CONNECT ON DATABASE ${quoteIdentifier(context.databaseName)} TO ${quoteIdentifier(LEGACY_APP_LOGIN)}`
    )
    for (const { name } of expected) copyMigration(name, context.migrationsPath)
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
    expect(await counts()).toEqual(baselineCounts)
    const owner = await client.query(
      `SELECT r.rolname AS owner FROM pg_catalog.pg_namespace n
      JOIN pg_catalog.pg_roles r ON r.oid = n.nspowner WHERE n.nspname = $1`,
      [schema]
    )
    expect(owner.rows).toEqual([{ owner: 'nihongo_phase7_owner' }])
    const expected = loadExpectedMigrationManifest().filter(
      ({ name }) =>
        name <= correction &&
        name !== '20261005183000_phase7_reviewed_catalog_current'
    )
    expect(expected).toHaveLength(36)
    expect(expected.at(-2)?.name).toBe(installation)
    expect(expected.at(-1)?.name).toBe(correction)
    const ledger = await client.query<{
      name: string
      checksum: string
      complete: boolean
    }>(
      `SELECT migration_name AS name, checksum,
       finished_at IS NOT NULL AND rolled_back_at IS NULL AND COALESCE(btrim(logs), '') = '' AS complete
       FROM "_prisma_migrations" ORDER BY migration_name COLLATE "C"`
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
    expect(request.items).toHaveLength(10)
    const originals = [
      ...approvedReadingBatch2.items,
      ...approvedReadingBatch4.items
    ]
    for (const [index, source] of approvedItems.entries()) {
      expect(originals[index]?.draftId).toBe(source.draftId)
      expect(originals[index]?.sha256).toBe(source.sourceSha256)
      expect(request.items[index]?.clientItemId).toBe(source.id)
      expect(request.items[index]?.content.tagNames).toEqual(
        source.originalTagNames
      )
      expect(request.items[index]?.content.explanationJa).toBeNull()
      expect(request.items[index]?.content.difficulty).toBe('NORMAL')
    }
    expect(
      request.items.flatMap(({ content }) => content.tagNames)
    ).toHaveLength(30)
  })
  afterEach(async () => {
    await client.query('ROLLBACK')
  })

  it('rejects unknown batches and direct dictionary mutation with the original guard', async () => {
    const before = await snapshot()
    await expectRejected(
      `INSERT INTO "Phase7ApprovedN4N2ReadingTagRegistration" ("batch") VALUES ('other-batch')`,
      '42501'
    )
    await expectRejected(
      `INSERT INTO "TagApplicability" SELECT "id", 'N4', 'READING', 'SHORT_READING' FROM "Tag" WHERE "normalizedName" = '짧은 글'`,
      '42501'
    )
    await expectRejected(
      `UPDATE "TagApplicability" SET "level" = 'N1'`,
      '42501'
    )
    await expectRejected(`DELETE FROM "TagApplicability"`, '42501')
    await expectRejected(
      `UPDATE "Tag" SET "label" = 'identity drift' WHERE "normalizedName" = '짧은 글'`,
      '42501'
    )
    expect(await snapshot()).toEqual(before)
    expect(await counts()).toEqual(baselineCounts)
  })

  it('keeps owned functions, pinned search paths and migration-only command authority', async () => {
    const functions = await client.query<{
      name: string
      owner: string
      definer: boolean
      config: string[]
      publicExecute: boolean
    }>(
      `SELECT p.proname AS name, r.rolname AS owner, p.prosecdef AS definer, p.proconfig AS config,
       EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
         WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE') AS "publicExecute"
       FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
       JOIN pg_catalog.pg_roles r ON r.oid = p.proowner
       WHERE n.nspname = $1 AND p.proname = ANY($2::text[])`,
      [
        schema,
        [
          'protect_phase7_approved_n4_n2_reading_tag_registration',
          'register_phase7_approved_n4_n2_reading_tag_rows',
          'apply_phase7_approved_n4_n2_reading_tags'
        ]
      ]
    )
    expect(functions.rows).toHaveLength(3)
    for (const row of functions.rows) {
      expect(row.owner).toBe('nihongo_phase7_owner')
      expect(row.config).toContain(`search_path=pg_catalog, ${schema}, pg_temp`)
      expect(row.definer).toBe(!row.name.startsWith('protect_'))
      expect(row.publicExecute).toBe(false)
    }
    const table = await client.query(`SELECT r.rolname AS owner,
      EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) acl WHERE acl.grantee = 0) AS "publicPrivilege"
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_roles r ON r.oid = c.relowner
      WHERE c.oid = '"Phase7ApprovedN4N2ReadingTagRegistration"'::regclass`)
    expect(table.rows).toEqual([
      { owner: 'nihongo_phase7_owner', publicPrivilege: false }
    ])
    expect(
      (
        await client.query(
          `SELECT has_function_privilege('nihongo_phase7_migration', 'apply_phase7_approved_n4_n2_reading_tags()', 'EXECUTE') AS allowed`
        )
      ).rows
    ).toEqual([{ allowed: true }])
    for (const role of runtimeRoles) {
      const privileges = await client.query(
        `SELECT has_schema_privilege($1, $2, 'CREATE') AS create,
        has_function_privilege($1, 'apply_phase7_approved_n4_n2_reading_tags()', 'EXECUTE') AS execute,
        has_table_privilege($1, '"Phase7ApprovedN4N2ReadingTagRegistration"', 'INSERT,UPDATE,DELETE,TRUNCATE') AS write,
        has_table_privilege($1, '"TagApplicability"', 'INSERT,UPDATE,DELETE') AS dictionary,
        has_table_privilege($1, '"Tag"', 'INSERT,UPDATE,DELETE') AS tags`,
        [role, schema]
      )
      expect(privileges.rows).toEqual([
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
        `INSERT INTO "Phase7ApprovedN4N2ReadingTagRegistration" ("batch") VALUES ('${batch}')`,
        '42501'
      )
      await expectRejected(
        `CREATE TABLE phase7_unapproved_dictionary_write (id integer)`,
        '42501'
      )
      await client.query('ROLLBACK TO SAVEPOINT runtime_authority')
      await client.query('RELEASE SAVEPOINT runtime_authority')
    }
    expect(await counts()).toEqual(baselineCounts)
  })

  it('rolls back all20 UUIDs, reused4 mappings and evidence after the final24th tuple', async () => {
    const before = await snapshot()
    await client.query(`CREATE FUNCTION phase7_test_reject_last_n4_n2_tuple() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF EXISTS (SELECT 1 FROM "Tag" WHERE "id" = NEW."tagId" AND "normalizedName" = '다음 개실일') THEN
        IF (SELECT COUNT(*) FROM "Tag") <> 128 OR (SELECT COUNT(*) FROM "TagApplicability") <> 151 THEN
          RAISE EXCEPTION 'synthetic failure did not reach final tuple' USING ERRCODE = '23514';
        END IF;
        RAISE EXCEPTION 'synthetic final-tuple failure' USING ERRCODE = '23514';
      END IF; RETURN NEW; END $$`)
    await client.query(
      'REVOKE ALL ON FUNCTION phase7_test_reject_last_n4_n2_tuple() FROM PUBLIC'
    )
    await client.query(`CREATE TRIGGER approved_n4_n2_atomic_failure AFTER INSERT ON "TagApplicability"
      FOR EACH ROW EXECUTE FUNCTION phase7_test_reject_last_n4_n2_tuple()`)
    await expectRejected(command, '23514', 'synthetic final-tuple failure')
    expect(await snapshot()).toEqual(before)
    expect(await counts()).toEqual(baselineCounts)
  })

  it('adds only exact24 cells, preserves all old snapshots, validates original10 and rejects widening/replay', async () => {
    const before = await snapshot()
    const payload = structuredClone(request)
    const missing = await repository.validateImport(request)
    expect(missing.valid).toBe(false)
    expect(missing.errors).toHaveLength(30)
    expect(missing.errors.every(({ code }) => code === 'UNKNOWN_TAG')).toBe(
      true
    )
    await apply()
    expect(await counts()).toEqual(afterCounts)
    const after = await snapshot()
    expect(
      after.tags.filter(
        ({ normalizedName }) => !newNames.includes(normalizedName)
      )
    ).toEqual(before.tags)
    expect(after.questions).toEqual(before.questions)
    expect(after.guards).toEqual(before.guards)
    expect(after.bindings).toEqual(before.bindings)
    expect(after.ledger).toEqual(before.ledger)
    const oldKeys = new Set(before.applicability.map(tupleKey))
    const added = after.applicability.filter(
      (row) => !oldKeys.has(tupleKey(row))
    )
    expect(added).toHaveLength(24)
    expect(
      after.applicability.filter((row) => oldKeys.has(tupleKey(row)))
    ).toEqual(before.applicability)
    const expectedKeys = expectedTuples.map(
      ({ name, level, subject, questionType, isNew }) => {
        const tag = after.tags.find(
          ({ normalizedName }) => normalizedName === name
        )
        expect(tag).toBeDefined()
        expect(tag?.label).toBe(name)
        if (!isNew) {
          expect(tag).toEqual(
            before.tags.find(({ normalizedName }) => normalizedName === name)
          )
          expect(tag?.id).toBe(toStableSeedUuid('question-tag', name))
        }
        return tupleKey({ tagId: tag!.id, level, subject, questionType })
      }
    )
    expect(added.map(tupleKey).toSorted()).toEqual(expectedKeys.toSorted())
    const created = after.tags.filter(({ normalizedName }) =>
      newNames.includes(normalizedName)
    )
    expect(created).toHaveLength(20)
    expect(new Set(created.map(({ id }) => id)).size).toBe(20)
    for (const tag of created) {
      expect(tag.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
      )
      expect(before.tags.some(({ id }) => id === tag.id)).toBe(false)
    }
    const informationId = before.tags.find(
      ({ normalizedName }) => normalizedName === '정보 찾기'
    )!.id
    expect(
      added
        .filter(({ tagId }) => tagId === informationId)
        .map(({ level }) => level)
        .toSorted()
    ).toEqual(['N2', 'N4'])
    const approved = await repository.validateImport(request)
    expect(approved.valid).toBe(true)
    expect(approved.errors).toEqual([])
    for (const change of ['level', 'subject', 'type', 'name'] as const) {
      const wrong = await repository.validateImport({
        items: request.items.map((item) => ({
          ...item,
          content: {
            ...item.content,
            ...(change === 'level' ? { level: 'N1' as const } : {}),
            ...(change === 'subject' ? { subject: 'VOCABULARY' as const } : {}),
            ...(change === 'type'
              ? {
                  questionType:
                    item.content.level === 'N4'
                      ? ('MEDIUM_READING' as const)
                      : ('SHORT_READING' as const)
                }
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
      ).toHaveLength(30)
    }
    expect(request).toEqual(payload)
    await expectRejected(command, '23514')
    await expectRejected(
      'SELECT "apply_phase7_approved_reading_tags"()',
      '23514'
    )
    await expectRejected(
      'SELECT "apply_phase7_approved_n3_reading_tags"()',
      '23514'
    )
    await expectRejected(
      `UPDATE "Phase7ApprovedN4N2ReadingTagRegistration" SET "batch" = 'other-batch'`,
      '42501'
    )
    await expectRejected(
      `DELETE FROM "Phase7ApprovedN4N2ReadingTagRegistration"`,
      '42501'
    )
    await expectRejected(
      `TRUNCATE "Phase7ApprovedN4N2ReadingTagRegistration"`,
      '42501'
    )
    expect(await snapshot()).toEqual(after)
    expect(await counts()).toEqual(afterCounts)
  })

  it('rejects a count-preserving altered migration identity/checksum', async () => {
    await client.query(`UPDATE "_prisma_migrations" SET "checksum" = repeat('0', 64)
      WHERE "migration_name" = '20260827101000_phase7_admin_cms_foundation'`)
    expect(await counts()).toEqual(baselineCounts)
    const drift = await snapshot()
    await expectRejected(
      command,
      '23514',
      'Approved registration canonical34 ledger prefix drifted.'
    )
    expect(await snapshot()).toEqual(drift)
    expect(await counts()).toEqual(baselineCounts)
  })

  it('rejects partial/pre-existing new-name state without repairing it', async () => {
    await client.query(`INSERT INTO "Tag" ("id", "label", "normalizedName", "createdAt", "updatedAt")
      VALUES (public.gen_random_uuid(), '행동 변화', '행동 변화', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
    const partial = await snapshot()
    await expectRejected(command, '23514')
    expect(await snapshot()).toEqual(partial)
    expect(await counts()).toEqual({ ...baselineCounts, tags: 109 })
  })

  it.each([
    {
      label: 'N5',
      sql: 'SELECT "apply_phase7_approved_reading_tags"()',
      tags: 114,
      applicability: 133,
      oldRegistrations: 1,
      n3Registrations: 0
    },
    {
      label: 'N3',
      sql: 'SELECT "apply_phase7_approved_n3_reading_tags"()',
      tags: 110,
      applicability: 130,
      oldRegistrations: 0,
      n3Registrations: 1
    }
  ])(
    'rejects already applied $label while preserving its original result',
    async ({ sql, label: _label, ...applied }) => {
      await client.query(sql)
      const expected = { ...baselineCounts, ...applied }
      expect(await counts()).toEqual(expected)
      const before = await snapshot()
      await expectRejected(command, '23514')
      expect(await snapshot()).toEqual(before)
      expect(await counts()).toEqual(expected)
    }
  )
})
