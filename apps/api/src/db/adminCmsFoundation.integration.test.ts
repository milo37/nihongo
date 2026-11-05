import { readFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import {
  expectedBaselineCatalog,
  withoutLegacyBranchSources
} from './fixtures/baseline/baselineDelta.js'
import {
  readSchemaCatalog,
  type SchemaCatalog
} from './fixtures/schemaCatalog.js'
import { registerDatabaseCapability } from './databaseCapability.js'
import { installAuditDigestSql } from './fixtures/auditDigestSql.js'
import { canonicalDuplicateIdentity } from '@nihongo/domain/content/validators/v1/duplicates'
import type { PersistedQuestionSemanticV1 } from '@nihongo/domain/content/validators/v1/types'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bridgedQuery, ownedSessionSql } from './fixtures/ownedSessionSql.js'
import { Client } from 'pg'
import { buildAllQuestionSeeds } from '../../prisma/seedQuestionCatalog.js'
import type { QuestionAggregateSeed } from '../../prisma/seed-data/buildQuestionSeed.js'
import {
  armAdminOperation,
  type ArmableOperation
} from '../admin/adminOperationArm.js'
import {
  beginAdminOperation as beginApiAdminOperation,
  finishAdminOperation
} from '../admin/adminOperationAuthority.js'
import { AdminRuleViolation } from '../admin/adminRepositoryCommon.js'
import { parseApiEnvironment } from '../config/env.js'
import type { Prisma } from '../generated/prisma/client.js'
import { adminFreshContextSchema } from '../auth/ssoAdminFreshRepository.js'
import { createRoleDatabaseRuntime } from './database.js'
import {
  createPostgresStartupOptions,
  getPostgresSchema
} from './databaseOptions.js'
import { assertSafeAdminCmsDatabase } from './databaseTargetGuard.js'
import {
  runFoundationStage,
  type FoundationStage
} from './foundationDiagnostics.js'
import { attestRuntimeRoles } from './runtimeRoleAttestation.js'

// #504 P8-1: one baseline replaces the 76 migrations.
const EXPECTED_MIGRATIONS = ['20261105090000_baseline'] as const
const EXPECTED_CHANGED_FIELDS = [
  'LIFECYCLE_STATUS',
  'LEVEL',
  'SUBJECT',
  'QUESTION_TYPE',
  'DIFFICULTY',
  'PASSAGE',
  'QUESTION_TEXT',
  'EXPLANATION_KO',
  'EXPLANATION_JA',
  'OPTIONS',
  'CORRECT_OPTION',
  'TAGS'
] as const
const ALLOWED_EXECUTION_ROLES = ['nihongo_app', 'nihongo_migration'] as const
type ExecutionRole = (typeof ALLOWED_EXECUTION_ROLES)[number]

const environment = parseApiEnvironment(process.env)
assertSafeAdminCmsDatabase({
  adminCmsMode: environment.ADMIN_CMS_MODE,
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})

const schema = getPostgresSchema(environment.DATABASE_URL)
const adminDatabaseUrl = process.env.ADMIN_DATABASE_URL
if (!adminDatabaseUrl) {
  throw new Error('Admin integration database URL is required.')
}
if (getPostgresSchema(adminDatabaseUrl) !== schema) {
  throw new Error('Admin and runtime schemas must match exactly.')
}
const connectionUrl = new URL(adminDatabaseUrl)
connectionUrl.searchParams.delete('schema')
const client = new Client({
  connectionString: connectionUrl.toString(),
  options: createPostgresStartupOptions(schema)
})
const developmentApplicationDatabaseUrl =
  process.env.TEST_DEVELOPMENT_APP_DATABASE_URL
if (!developmentApplicationDatabaseUrl) {
  throw new Error('Development app wrapper URL is required.')
}
const repeatableReadActorId = randomUUID()

const createExpectedFingerprint = (seed: QuestionAggregateSeed): string => {
  const correctOption = seed.options.find(
    ({ id }) => id === seed.correctOptionId
  )
  const [first, second, third, fourth] = seed.options
  if (!correctOption || !first || !second || !third || !fourth) {
    throw new Error(`Seed correct option is unavailable: ${seed.legacyId}`)
  }
  const semantic = {
    level: seed.level,
    subject: seed.subject,
    questionType: seed.questionType,
    difficulty: seed.difficulty,
    passage: seed.passage,
    questionText: seed.questionText,
    options: [
      { key: first.label, text: first.text },
      { key: second.label, text: second.text },
      { key: third.label, text: third.text },
      { key: fourth.label, text: fourth.text }
    ],
    correctOptionKey: correctOption.label,
    explanationKo: seed.explanationKo,
    explanationJa: seed.explanationJa,
    tagKeys: seed.tags.map(({ normalizedName }) => normalizedName)
  } satisfies PersistedQuestionSemanticV1
  return createHash('sha256')
    .update(canonicalDuplicateIdentity(semantic), 'utf8')
    .digest('hex')
}

/**
 * #504 P7 PR2: admin operation authority runs in the API. These run the API
 * begin/finish on a raw pg connection inside its transaction and return a
 * pg-shaped result, so the SQL-era assertions keep their shape.
 */
const asTestTransaction = (databaseClient: Client): Prisma.TransactionClient =>
  ({
    $queryRawUnsafe: async (sql: string, ...values: unknown[]) =>
      (await databaseClient.query(sql, values)).rows,
    $executeRawUnsafe: async (sql: string, ...values: unknown[]) =>
      (await databaseClient.query(sql, values)).rowCount ?? 0
  }) as unknown as Prisma.TransactionClient

const beginInTest = async (
  databaseClient: Client,
  [command, rawSessionToken, , referencedUserIds]: readonly unknown[]
) => {
  const operation = await beginApiAdminOperation(
    asTestTransaction(databaseClient),
    {
      auditEnvironment: 'TEST',
      command: String(command),
      rawSessionToken: String(rawSessionToken),
      referencedUserIds: referencedUserIds as string[]
    }
  )
  return { rowCount: 1, rows: [operation] }
}

const finishInTest = async (
  databaseClient: Client,
  [operationId]: readonly unknown[]
) => {
  await finishAdminOperation(
    asTestTransaction(databaseClient),
    String(operationId)
  )
  return { rowCount: 1, rows: [] }
}

const expectFailedTransaction = async (
  action: () => Promise<void>,
  code: string
): Promise<void> => {
  await client.query('BEGIN')
  try {
    await expect(action()).rejects.toMatchObject({ code })
  } finally {
    await client.query('ROLLBACK')
  }
}

const observeInitialization = <Result>(
  stage: FoundationStage,
  action: () => Promise<Result>
): Promise<Result> =>
  runFoundationStage(stage, action, (diagnostic) => {
    process.stdout.write(`${JSON.stringify(diagnostic)}\n`)
  })

const withExecutionRole = async <Result>(
  role: ExecutionRole,
  action: () => Promise<Result>,
  diagnoseInitialization = false
): Promise<Result> => {
  if (!ALLOWED_EXECUTION_ROLES.includes(role)) {
    throw new Error(`Unexpected Phase 7 execution role: ${role}`)
  }
  const observe = <Value>(
    stage: FoundationStage,
    operation: () => Promise<Value>
  ) =>
    diagnoseInitialization
      ? observeInitialization(stage, operation)
      : operation()
  await observe('REGISTER_ROLE', () => client.query(`SET ROLE "${role}"`))
  let actionError: unknown
  let actionFailed = false
  let resetError: unknown
  let resetFailed = false
  let result: Result | undefined
  try {
    result = await observe('CAPABILITY_REGISTER', action)
  } catch (error: unknown) {
    actionFailed = true
    actionError = error
  }
  try {
    await observe('RESET_ROLE', () => client.query('RESET ROLE'))
  } catch (error: unknown) {
    resetFailed = true
    resetError = error
  }
  if (actionFailed) throw actionError
  if (resetFailed) throw resetError
  return result as Result
}

interface AdminTargetManifest {
  readonly questions: readonly AdminTargetManifestItem[]
  readonly reports: readonly AdminTargetManifestItem[]
  readonly tags: readonly string[]
  readonly versions: readonly AdminTargetManifestItem[]
}

interface AdminTargetManifestItem {
  readonly id: string
  readonly rowVersion: number
  readonly state: string
}

const beginAdminOperation = async (
  databaseClient: Client,
  input: {
    command: string
    referencedUserIds: readonly string[]
    requestId: string
    sessionToken: string
    targetManifest: AdminTargetManifest
  }
): Promise<{ actorUserId: string; occurredAt: Date; operationId: string }> => {
  const isolationLevel = [
    'QUESTION_CREATE',
    'QUESTION_VERSION_CREATE',
    'QUESTION_VERSION_UPDATE',
    'PUBLICATION',
    'IMPORT_APPLY'
  ].includes(input.command)
    ? 'SERIALIZABLE'
    : input.command === 'EXPORT'
      ? 'REPEATABLE READ'
      : 'READ COMMITTED'
  await databaseClient.query(
    `SET TRANSACTION ISOLATION LEVEL ${isolationLevel}`
  )
  const begun = await beginInTest(databaseClient, [
    input.command,
    input.sessionToken,
    input.requestId,
    input.referencedUserIds
  ])
  const operation = begun.rows[0]
  if (!operation) throw new Error('Phase 7 operation was not created.')
  // The arm step runs in the API since #504 P4 (adminOperationArm.ts).
  const occurredAt = await armInTest(
    databaseClient,
    {
      ...operation,
      command: input.command,
      referencedUserIds: input.referencedUserIds
    },
    input.targetManifest
  )
  return { ...operation, occurredAt }
}

/** Runs the API arm step on a raw pg connection inside its transaction. */
const pgTransaction = (databaseClient: Client): Prisma.TransactionClient =>
  ({
    $queryRawUnsafe: async (sql: string, ...values: unknown[]) =>
      (await databaseClient.query(sql, values)).rows
  }) as unknown as Prisma.TransactionClient

/** Arms through the API and exposes a rule violation's SQLSTATE as `code`. */
const armInTest = async (
  databaseClient: Client,
  operation: ArmableOperation,
  manifest: AdminTargetManifest
): Promise<Date> => {
  try {
    return await armAdminOperation(
      pgTransaction(databaseClient),
      operation,
      manifest
    )
  } catch (error: unknown) {
    if (error instanceof AdminRuleViolation) {
      throw Object.assign(error, { code: error.sqlState })
    }
    throw error
  }
}

const insertCredentialUser = async (input: {
  id: string
  role: 'ADMIN' | 'USER'
}): Promise<void> => {
  const now = new Date()
  await client.query('BEGIN')
  try {
    await client.query(
      `INSERT INTO "User" (
        "id", "name", "email", "emailVerified", "role",
        "accountStatus", "createdAt", "updatedAt"
      ) VALUES ($1, 'DB integration', $2, true, $3, 'ACTIVE', $4, $4)`,
      [input.id, `phase7-${randomUUID()}@example.test`, input.role, now]
    )
    await client.query(
      `INSERT INTO "Account" (
        "id", "accountId", "providerId", "userId", "password",
        "createdAt", "updatedAt"
      ) VALUES (
        $1, $2::uuid::text, 'credential', $2::uuid,
        'integration-password-hash', $3, $3
      )`,
      [randomUUID(), input.id, now]
    )
    await client.query('COMMIT')
  } catch (error: unknown) {
    await client.query('ROLLBACK')
    throw error
  }
}

const insertGoogleFixtureAccount = async (userId: string): Promise<void> => {
  await client.query(
    `INSERT INTO "Account" (
      "id", "accountId", "providerId", "userId", "createdAt", "updatedAt"
    ) VALUES ($1, $2, 'google', $3, clock_timestamp(), clock_timestamp())`,
    [randomUUID(), `phase7-foundation-${randomUUID()}`, userId]
  )
}

const completeAdminSsoFresh = async (
  userId: string,
  oldToken: string
): Promise<string> => {
  const token = `phase7-foundation-fresh-${randomUUID()}`
  await withExecutionRole('nihongo_app', async () => {
    const prepared = await ownedSessionSql(
      client,
      `SELECT "phase7_prepare_sso_admin_fresh"($1, 'google') AS context`,
      [oldToken]
    )
    const context = adminFreshContextSchema.parse(prepared.rows[0]?.context)
    expect(context.userId).toBe(userId)
    const proof = createHash('sha256').update(randomUUID()).digest('hex')
    const staged = await ownedSessionSql(
      client,
      `SELECT "phase7_stage_sso_admin_fresh_proof"(
        $1::jsonb, 'google', $2, $3, '/admin/questions'
      ) AS accepted`,
      [JSON.stringify(context), context.accountId, proof]
    )
    expect(staged.rows).toEqual([{ accepted: true }])
    const sessionId = randomUUID()
    const completed = await ownedSessionSql(
      client,
      `SELECT * FROM "phase7_complete_sso_admin_fresh"($1, $2, $3, $4, $5, $6)`,
      [
        proof,
        oldToken,
        sessionId,
        token,
        '127.0.0.1',
        'phase7-foundation-fresh'
      ]
    )
    expect(completed.rowCount).toBe(1)
    expect(completed.rows[0]).toMatchObject({ id: sessionId, userId })
  })
  await withExecutionRole('nihongo_app', async () => {
    const fresh = await ownedSessionSql(
      client,
      `SELECT "phase7_sso_admin_session_is_fresh"($1) AS fresh`,
      [token]
    )
    expect(fresh.rows).toEqual([{ fresh: true }])
  })
  return token
}

const insertIncompleteSystemQuestion = async (): Promise<void> => {
  const questionId = randomUUID()
  const versionId = randomUUID()
  const optionIds = Array.from({ length: 3 }, () => randomUUID())
  const tag = await client.query<{
    id: string
    label: string
    normalizedName: string
  }>(
    `SELECT tag."id", tag."label", tag."normalizedName"
     FROM "Tag" AS tag
     JOIN "TagApplicability" AS applicability
       ON applicability."tagId" = tag."id"
     WHERE applicability."level" = 'N5'
       AND applicability."subject" = 'VOCABULARY'
       AND applicability."questionType" = 'KANJI_READING'
     ORDER BY tag."id"
     LIMIT 1`
  )
  const selectedTag = tag.rows[0]
  if (!selectedTag || !optionIds[0]) {
    throw new Error('Incomplete-content fixture is unavailable.')
  }

  await client.query(
    `INSERT INTO "Question" (
      "id", "createdByLabelSnapshot", "createdAt", "updatedAt"
    ) VALUES ($1, 'SYSTEM_SEED', clock_timestamp(), clock_timestamp())`,
    [questionId]
  )
  await client.query(
    `INSERT INTO "QuestionVersion" (
      "id", "questionId", "versionNumber", "level", "subject",
      "questionType", "questionText", "correctOptionId", "explanationKo",
      "difficulty", "contentFingerprint", "createdByLabelSnapshot",
      "createdAt", "updatedAt"
    ) VALUES (
      $1, $2, 1, 'N5', 'VOCABULARY', 'KANJI_READING', $3, $4,
      '세 개 보기로는 commit할 수 없어야 합니다.', 'EASY', repeat('0', 64),
      'SYSTEM_SEED', clock_timestamp(), clock_timestamp()
    )`,
    [versionId, questionId, `불완전 문제 ${questionId}`, optionIds[0]]
  )
  for (const [index, optionId] of optionIds.entries()) {
    await client.query(
      `INSERT INTO "QuestionOption" (
        "id", "questionVersionId", "label", "text", "ordinal"
      ) VALUES ($1, $2, $3, $4, $5)`,
      [
        optionId,
        versionId,
        String(index + 1),
        `불완전 보기 ${index + 1}`,
        index + 1
      ]
    )
  }
  await client.query(
    `INSERT INTO "QuestionVersionTag" (
      "id", "questionVersionId", "tagId", "labelSnapshot",
      "normalizedNameSnapshot"
    ) VALUES ($1, $2, $3, $4, $5)`,
    [
      randomUUID(),
      versionId,
      selectedTag.id,
      selectedTag.label,
      selectedTag.normalizedName
    ]
  )
  await client.query('COMMIT')
}

beforeAll(async () => {
  await observeInitialization('ADMIN_CONNECT', () => client.connect())
  // #504 P7 PR5b: the SQL audit digest is a test fixture now.
  await installAuditDigestSql(client)
  // #504 P8-1: the baseline starts with V1 issuance active; only the
  // capability row is registered.
  await withExecutionRole(
    'nihongo_migration',
    () => registerDatabaseCapability(client, 'TEST'),
    true
  )
})

afterAll(async () => {
  await client.end()
})

describe('Persistence foundation', () => {
  // #504 P8-1: the baseline is the 76-migration schema with exactly the
  // listed exclusions and renames (fixtures/baseline/baselineDelta.ts).
  it('baseline catalog는 76 migration catalog에서 제외·이름 변경만 다르다', async () => {
    if (!schema) throw new Error('Integration schema is unavailable.')
    const snapshot = JSON.parse(
      readFileSync(
        new URL('./fixtures/baseline/schema76.catalog.json', import.meta.url),
        'utf8'
      )
    ) as SchemaCatalog
    const actual = await readSchemaCatalog(client, schema)
    expect(withoutLegacyBranchSources(actual)).toEqual(
      withoutLegacyBranchSources(expectedBaselineCatalog(snapshot))
    )
  })
  it('baseline fresh schema와 핵심 DB guard를 exact manifest로 배포한다', async () => {
    const ledger = await client.query<{ migrationName: string }>(
      `SELECT migration_name AS "migrationName"
       FROM "_prisma_migrations"
       WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
       ORDER BY started_at`
    )
    expect(ledger.rows.map(({ migrationName }) => migrationName)).toEqual(
      EXPECTED_MIGRATIONS
    )
    expect(
      (
        await client.query<{
          aclEntryCount: number
          appCanExecute: boolean
          argumentCount: number
          argumentTypes: string
          config: string[] | null
          identityArguments: string
          isSecurityDefiner: boolean
          nonOwnerAclCount: number
          objectId: string
          ownerCanExecute: boolean
          ownerName: string
          publicCanExecute: boolean
          resultType: string
        }>(
          `SELECT procedure_record.oid::text AS "objectId",
             owner_role.rolname AS "ownerName",
             procedure_record.pronargs::int AS "argumentCount",
             procedure_record.proargtypes::text AS "argumentTypes",
             pg_get_function_identity_arguments(procedure_record.oid)
               AS "identityArguments",
             pg_get_function_result(procedure_record.oid) AS "resultType",
             procedure_record.prosecdef AS "isSecurityDefiner",
             procedure_record.proconfig::text[] AS config,
             has_function_privilege(
               'nihongo_owner', procedure_record.oid, 'EXECUTE'
             ) AS "ownerCanExecute",
             has_function_privilege(
               'nihongo_app', procedure_record.oid, 'EXECUTE'
             ) AS "appCanExecute",
             (SELECT COUNT(*)::int
              FROM aclexplode(COALESCE(
                procedure_record.proacl,
                acldefault('f', procedure_record.proowner)
              ))) AS "aclEntryCount",
             (SELECT COUNT(*)::int
              FROM aclexplode(COALESCE(
                procedure_record.proacl,
                acldefault('f', procedure_record.proowner)
              )) AS permission
              WHERE permission.grantee <> procedure_record.proowner)
               AS "nonOwnerAclCount",
             EXISTS (
               SELECT 1
               FROM aclexplode(COALESCE(
                 procedure_record.proacl,
                 acldefault('f', procedure_record.proowner)
               )) AS permission
               WHERE permission.grantee = 0
                 AND permission.privilege_type = 'EXECUTE'
             ) AS "publicCanExecute"
           FROM pg_proc AS procedure_record
           JOIN pg_namespace AS namespace_record
             ON namespace_record.oid = procedure_record.pronamespace
           JOIN pg_roles AS owner_role
             ON owner_role.oid = procedure_record.proowner
           WHERE namespace_record.nspname = current_schema()
             AND procedure_record.proname =
               'phase7_verify_operation_manifest'
             AND procedure_record.proargtypes = '2950'::oidvector`
        )
      ).rows
    ).toEqual([])
    await client.query('BEGIN')
    try {
      await client.query(`SET LOCAL ROLE "nihongo_app"`)
      expect(
        (
          await client.query<{ migrationCount: number }>(
            `SELECT COUNT(*)::int AS "migrationCount"
             FROM "_prisma_migrations"
             WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`
          )
        ).rows
      ).toEqual([{ migrationCount: 1 }])
    } finally {
      await client.query('ROLLBACK')
    }

    expect(
      (
        await client.query<{
          command: string
          name: string
          roles: string[]
        }>(
          `SELECT policyname AS name, cmd AS command, roles::text[] AS roles
           FROM pg_policies
           WHERE schemaname = current_schema()
             AND tablename = '_prisma_migrations'
           ORDER BY policyname`
        )
      ).rows
    ).toEqual([
      {
        command: 'SELECT',
        name: 'ledger_app_read',
        roles: ['nihongo_app']
      },
      {
        command: 'ALL',
        name: 'ledger_full_access',
        roles: ['nihongo_migration']
      }
    ])

    const directUserForeignKeys = await client.query<{
      constraintName: string
      deleteAction: string
      tableName: string
      updateAction: string
    }>(
      `SELECT constraint_record.conname AS "constraintName",
         child.relname AS "tableName",
         constraint_record.confdeltype::text AS "deleteAction",
         constraint_record.confupdtype::text AS "updateAction"
       FROM pg_constraint AS constraint_record
       JOIN pg_class AS child ON child.oid = constraint_record.conrelid
       JOIN pg_namespace AS namespace ON namespace.oid = child.relnamespace
       JOIN pg_class AS parent ON parent.oid = constraint_record.confrelid
       WHERE namespace.nspname = current_schema()
         AND parent.relname = 'User'
         AND constraint_record.conname = ANY($1::text[])
       ORDER BY child.relname`,
      [
        [
          'StudySession_userId_fkey',
          'Bookmark_userId_fkey',
          'WrongNote_userId_fkey',
          'IdempotencyRecord_userId_fkey'
        ]
      ]
    )
    expect(directUserForeignKeys.rows).toEqual([
      {
        constraintName: 'Bookmark_userId_fkey',
        deleteAction: 'c',
        tableName: 'Bookmark',
        updateAction: 'a'
      },
      {
        constraintName: 'IdempotencyRecord_userId_fkey',
        deleteAction: 'c',
        tableName: 'IdempotencyRecord',
        updateAction: 'a'
      },
      {
        constraintName: 'StudySession_userId_fkey',
        deleteAction: 'c',
        tableName: 'StudySession',
        updateAction: 'a'
      },
      {
        constraintName: 'WrongNote_userId_fkey',
        deleteAction: 'c',
        tableName: 'WrongNote',
        updateAction: 'a'
      }
    ])

    const roles = await client.query<{
      canBypassRls: boolean
      canCreateDatabase: boolean
      canCreateRole: boolean
      canLogin: boolean
      inherits: boolean
      isReplication: boolean
      isSuperuser: boolean
      name: string
    }>(
      `SELECT rolname AS name, rolcanlogin AS "canLogin",
         rolinherit AS inherits, rolsuper AS "isSuperuser",
         rolcreatedb AS "canCreateDatabase", rolcreaterole AS "canCreateRole",
         rolreplication AS "isReplication", rolbypassrls AS "canBypassRls"
       FROM pg_roles
       WHERE rolname = ANY($1::text[])
       ORDER BY rolname`,
      [['nihongo_app', 'nihongo_migration', 'nihongo_owner']]
    )
    expect(roles.rows.map(({ name }) => name)).toEqual([
      'nihongo_app',
      'nihongo_migration',
      'nihongo_owner'
    ])
    expect(
      roles.rows.every(
        ({
          canBypassRls,
          canCreateDatabase,
          canCreateRole,
          canLogin,
          inherits,
          isReplication,
          isSuperuser
        }) =>
          !canBypassRls &&
          !canCreateDatabase &&
          !canCreateRole &&
          !canLogin &&
          !inherits &&
          !isReplication &&
          !isSuperuser
      )
    ).toBe(true)
    const memberships = await client.query<{
      memberName: string
      roleName: string
    }>(
      `SELECT member_role.rolname AS "memberName",
         granted_role.rolname AS "roleName"
       FROM pg_auth_members AS membership
       JOIN pg_roles AS member_role ON member_role.oid = membership.member
       JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
       WHERE member_role.rolname = ANY($1::text[])
       ORDER BY member_role.rolname, granted_role.rolname`,
      [['nihongo_app', 'nihongo_migration', 'nihongo_owner']]
    )
    expect(memberships.rows).toEqual([
      {
        memberName: 'nihongo_migration',
        roleName: 'nihongo_owner'
      }
    ])

    const schemaPrivileges = await client.query<{
      canCreate: boolean
      canUse: boolean
      name: string
    }>(
      `SELECT required.role_name AS name,
         has_schema_privilege(
           required.role_name, current_schema(), 'USAGE'
         ) AS "canUse",
         has_schema_privilege(
           required.role_name, current_schema(), 'CREATE'
         ) AS "canCreate"
       FROM unnest($1::text[]) AS required(role_name)
       ORDER BY required.role_name`,
      [['nihongo_app', 'nihongo_migration']]
    )
    expect(schemaPrivileges.rows).toEqual([
      { canCreate: false, canUse: true, name: 'nihongo_app' },
      { canCreate: true, canUse: true, name: 'nihongo_migration' }
    ])
    expect(
      (
        await client.query<{
          ownerName: string
          publicCanCreate: boolean
        }>(
          `SELECT owner_role.rolname AS "ownerName",
             EXISTS (
               SELECT 1
               FROM aclexplode(COALESCE(
                 namespace.nspacl,
                 acldefault('n', namespace.nspowner)
               )) AS permission
               WHERE permission.grantee = 0
                 AND permission.privilege_type = 'CREATE'
             ) AS "publicCanCreate"
           FROM pg_namespace AS namespace
           JOIN pg_roles AS owner_role ON owner_role.oid = namespace.nspowner
           WHERE namespace.nspname = current_schema()`
        )
      ).rows
    ).toEqual([{ ownerName: 'nihongo_owner', publicCanCreate: false }])

    const appTablePrivileges = await client.query<{
      canDelete: boolean
      canInsert: boolean
      canReferences: boolean
      canSelect: boolean
      canTrigger: boolean
      canTruncate: boolean
      canUpdate: boolean
      name: string
    }>(
      `SELECT required.table_name AS name,
         has_table_privilege('nihongo_app',
           format('%I.%I', current_schema(), required.table_name),
           'SELECT') AS "canSelect",
         has_table_privilege('nihongo_app',
           format('%I.%I', current_schema(), required.table_name),
           'INSERT') AS "canInsert",
         has_table_privilege('nihongo_app',
           format('%I.%I', current_schema(), required.table_name),
           'UPDATE') AS "canUpdate",
         has_table_privilege('nihongo_app',
           format('%I.%I', current_schema(), required.table_name),
           'DELETE') AS "canDelete",
         has_table_privilege('nihongo_app',
           format('%I.%I', current_schema(), required.table_name),
           'TRUNCATE') AS "canTruncate",
         has_table_privilege('nihongo_app',
           format('%I.%I', current_schema(), required.table_name),
           'REFERENCES') AS "canReferences",
         has_table_privilege('nihongo_app',
           format('%I.%I', current_schema(), required.table_name),
           'TRIGGER') AS "canTrigger"
       FROM unnest($1::text[]) AS required(table_name)
       ORDER BY required.table_name`,
      [
        [
          'AdminAuditLog',
          'ContentReview',
          'Question',
          'QuestionOption',
          'QuestionReport',
          'QuestionVersion',
          'QuestionVersionTag',
          'Tag',
          'TagApplicability',
          '_prisma_migrations'
        ]
      ]
    )
    const noExtendedPrivileges = {
      canReferences: false,
      canTrigger: false,
      canTruncate: false
    }
    expect(appTablePrivileges.rows).toEqual([
      {
        canDelete: false,
        canInsert: true,
        canSelect: true,
        canUpdate: false,
        name: 'AdminAuditLog',
        ...noExtendedPrivileges
      },
      {
        canDelete: false,
        canInsert: true,
        canSelect: true,
        canUpdate: false,
        name: 'ContentReview',
        ...noExtendedPrivileges
      },
      {
        canDelete: false,
        canInsert: true,
        canSelect: true,
        canUpdate: true,
        name: 'Question',
        ...noExtendedPrivileges
      },
      {
        canDelete: false,
        canInsert: true,
        canSelect: true,
        canUpdate: true,
        name: 'QuestionOption',
        ...noExtendedPrivileges
      },
      {
        canDelete: false,
        canInsert: false,
        canSelect: true,
        canUpdate: true,
        name: 'QuestionReport',
        ...noExtendedPrivileges
      },
      {
        canDelete: false,
        canInsert: true,
        canSelect: true,
        canUpdate: true,
        name: 'QuestionVersion',
        ...noExtendedPrivileges
      },
      {
        canDelete: true,
        canInsert: true,
        canSelect: true,
        canUpdate: false,
        name: 'QuestionVersionTag',
        ...noExtendedPrivileges
      },
      {
        canDelete: false,
        canInsert: false,
        canSelect: true,
        canUpdate: false,
        name: 'Tag',
        ...noExtendedPrivileges
      },
      {
        canDelete: false,
        canInsert: false,
        canSelect: true,
        canUpdate: false,
        name: 'TagApplicability',
        ...noExtendedPrivileges
      },
      {
        canDelete: false,
        canInsert: false,
        canSelect: true,
        canUpdate: false,
        name: '_prisma_migrations',
        ...noExtendedPrivileges
      }
    ])

    await expectFailedTransaction(async () => {
      await client.query(`SET LOCAL ROLE "nihongo_app"`)
      await client.query(
        `CREATE FUNCTION "phase7_app_spoof_function"()
         RETURNS INTEGER LANGUAGE SQL AS $body$ SELECT 1 $body$`
      )
    }, '42501')
    expect(
      (
        await client.query<{ functionCount: number }>(
          `SELECT COUNT(*)::int AS "functionCount"
           FROM pg_proc AS procedure_record
           JOIN pg_namespace AS namespace
             ON namespace.oid = procedure_record.pronamespace
           WHERE namespace.nspname = current_schema()
             AND procedure_record.proname = 'phase7_app_spoof_function'`
        )
      ).rows
    ).toEqual([{ functionCount: 0 }])
    for (const runtimeRole of ['nihongo_app'] as const) {
      for (const authTable of [
        'User',
        'Account',
        'Session',
        'Verification'
      ] as const) {
        await expectFailedTransaction(async () => {
          await client.query(`SET LOCAL ROLE "${runtimeRole}"`)
          await client.query(`SELECT * FROM "${authTable}" LIMIT 1`)
        }, '42501')
      }
    }

    const tables = await client.query<{ name: string }>(
      `SELECT table_name AS name
       FROM information_schema.tables
       WHERE table_schema = current_schema()
         AND table_name = ANY($1::text[])
       ORDER BY table_name`,
      [
        [
          'AdminAuditLog',
          'ContentReview',
          'DatabaseCapability',
          'OperationIntent',
          'QuestionReport',
          'TagApplicability'
        ]
      ]
    )
    expect(tables.rows.map(({ name }) => name)).toEqual([
      'AdminAuditLog',
      'ContentReview',
      'DatabaseCapability',
      'OperationIntent',
      'QuestionReport',
      'TagApplicability'
    ])

    const triggers = await client.query<{
      enabled: string
      initiallyDeferred: boolean
      isDeferrable: boolean
      name: string
    }>(
      `SELECT trigger.tgname AS name, trigger.tgenabled AS enabled,
         trigger.tgdeferrable AS "isDeferrable",
         trigger.tginitdeferred AS "initiallyDeferred"
       FROM pg_trigger AS trigger
       JOIN pg_class AS relation ON relation.oid = trigger.tgrelid
       JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname = current_schema()
         AND trigger.tgname = ANY($1::text[])
       ORDER BY trigger.tgname`,
      [
        [
          'Account_deferred_credential_totality',
          'QuestionVersion_deferred_full_content',
          'QuestionVersion_deferred_question_aggregate',
          'QuestionVersion_protect_delete',
          'Question_protect_history_delete',
          'QuestionReport_deferred_remediation',
          'User_limit_erasure_delete'
        ]
      ]
    )
    expect(triggers.rows.map(({ name }) => name)).toEqual([
      'Account_deferred_credential_totality',
      'QuestionReport_deferred_remediation',
      'QuestionVersion_deferred_full_content',
      'QuestionVersion_deferred_question_aggregate',
      'QuestionVersion_protect_delete',
      'Question_protect_history_delete',
      'User_limit_erasure_delete'
    ])
    expect(triggers.rows.every(({ enabled }) => enabled === 'O')).toBe(true)
    expect(
      triggers.rows
        .filter(({ name }) => name.includes('deferred'))
        .every(
          ({ initiallyDeferred, isDeferrable }) =>
            initiallyDeferred && isDeferrable
        )
    ).toBe(true)

    const publicExecute = await client.query<{
      isSecurityDefiner: boolean
      name: string
      ownerName: string
      publicCanExecute: boolean
    }>(
      `SELECT procedure_record.proname AS name,
         owner_role.rolname AS "ownerName",
         procedure_record.prosecdef AS "isSecurityDefiner",
         EXISTS (
           SELECT 1
           FROM aclexplode(COALESCE(
             procedure_record.proacl,
             acldefault('f', procedure_record.proowner)
           )) AS permission
           WHERE permission.grantee = 0
             AND permission.privilege_type = 'EXECUTE'
         ) AS "publicCanExecute"
       FROM pg_proc AS procedure_record
       JOIN pg_namespace AS namespace
         ON namespace.oid = procedure_record.pronamespace
       JOIN pg_roles AS owner_role ON owner_role.oid = procedure_record.proowner
       WHERE namespace.nspname = current_schema()
         AND procedure_record.proname = ANY($1::text[])
       ORDER BY procedure_record.proname`,
      [
        [
          'require_runtime_ready',
          'require_database_capability',
          'require_caller_role',
          'user_erasure_confirmed',
          'validate_question_report_remediation'
        ]
      ]
    )
    expect(publicExecute.rows).toHaveLength(5)
    expect(
      publicExecute.rows.filter(
        ({ ownerName, publicCanExecute }) =>
          ownerName !== 'nihongo_owner' || publicCanExecute
      )
    ).toEqual([])
    expect(
      publicExecute.rows.find(({ name }) => name === 'require_caller_role')
    ).toMatchObject({ isSecurityDefiner: false })
    expect(
      publicExecute.rows
        .filter(({ name }) => name !== 'require_caller_role')
        .every(({ isSecurityDefiner }) => isSecurityDefiner)
    ).toBe(true)
  })

  it('questionText prefix index의 COLLATE C·text_pattern_ops 계약과 planner 사용을 고정한다', async () => {
    if (!schema) {
      throw new Error('Integration schema is unavailable.')
    }
    const index = await client.query<{
      accessMethod: string
      attributeName: string
      collationName: string
      indexDefinition: string
      indexName: string
      isReady: boolean
      isUnique: boolean
      isValid: boolean
      keyCount: number
      operatorClassName: string
      schemaName: string
      tableName: string
    }>(
      `SELECT index_namespace.nspname AS "schemaName",
         index_relation.relname AS "indexName",
         table_relation.relname AS "tableName",
         access_method.amname AS "accessMethod",
         table_attribute.attname AS "attributeName",
         index_collation.collname AS "collationName",
         operator_class.opcname AS "operatorClassName",
         index_record.indnkeyatts::int AS "keyCount",
         index_record.indisunique AS "isUnique",
         index_record.indisvalid AS "isValid",
         index_record.indisready AS "isReady",
         pg_get_indexdef(index_relation.oid) AS "indexDefinition"
       FROM pg_index AS index_record
       JOIN pg_class AS index_relation
         ON index_relation.oid = index_record.indexrelid
       JOIN pg_namespace AS index_namespace
         ON index_namespace.oid = index_relation.relnamespace
       JOIN pg_class AS table_relation
         ON table_relation.oid = index_record.indrelid
       JOIN pg_am AS access_method
         ON access_method.oid = index_relation.relam
       JOIN pg_attribute AS table_attribute
         ON table_attribute.attrelid = table_relation.oid
        AND table_attribute.attnum = index_record.indkey[0]
       JOIN pg_collation AS index_collation
         ON index_collation.oid = index_record.indcollation[0]
       JOIN pg_opclass AS operator_class
         ON operator_class.oid = index_record.indclass[0]
       WHERE index_namespace.nspname = current_schema()
         AND index_relation.relname =
           'QuestionVersion_questionText_prefix_idx'`
    )
    expect(index.rows).toEqual([
      {
        accessMethod: 'btree',
        attributeName: 'questionText',
        collationName: 'C',
        indexDefinition:
          `CREATE INDEX "QuestionVersion_questionText_prefix_idx" ON ` +
          `${schema}."QuestionVersion" USING btree ` +
          `("questionText" COLLATE "C" text_pattern_ops)`,
        indexName: 'QuestionVersion_questionText_prefix_idx',
        isReady: true,
        isUnique: false,
        isValid: true,
        keyCount: 1,
        operatorClassName: 'text_pattern_ops',
        schemaName: schema,
        tableName: 'QuestionVersion'
      }
    ])

    const databaseLocale = await client.query<{ collation: string }>(
      `SELECT datcollate AS "collation"
       FROM pg_database WHERE datname = current_database()`
    )
    if (!['C', 'POSIX'].includes(databaseLocale.rows[0]?.collation ?? '')) {
      const fixture = await client.query<{ questionText: string }>(
        `SELECT "questionText" FROM "QuestionVersion"
         ORDER BY "id" LIMIT 1`
      )
      const prefix = Array.from(fixture.rows[0]?.questionText ?? '')
        .slice(0, 2)
        .join('')
      if (!prefix) {
        throw new Error('Prefix planner fixture is unavailable.')
      }
      const pattern =
        prefix
          .replaceAll('\\', '\\\\')
          .replaceAll('%', '\\%')
          .replaceAll('_', '\\_') + '%'
      await client.query('BEGIN')
      try {
        await client.query('SET LOCAL enable_seqscan = off')
        const plan = await client.query<{ 'QUERY PLAN': unknown }>(
          `EXPLAIN (FORMAT JSON)
           SELECT "id" FROM "QuestionVersion"
           WHERE ("questionText" COLLATE "C") LIKE $1 ESCAPE E'\\\\'`,
          [pattern]
        )
        expect(JSON.stringify(plan.rows[0]?.['QUERY PLAN'])).toContain(
          'QuestionVersion_questionText_prefix_idx'
        )
      } finally {
        await client.query('ROLLBACK')
      }
    }
  })

  it('기존 65문항 fingerprint·snapshot·applicability parity와 fake evidence 0을 고정한다', async () => {
    const counts = await client.query<{
      applicabilityCount: number
      auditCount: number
      fingerprintMismatchCount: number
      fingerprintNullCount: number
      optionCount: number
      questionCount: number
      reportCount: number
      reviewCount: number
      snapshotMismatchCount: number
      tagCount: number
      versionCount: number
      versionTagCount: number
    }>(
      `SELECT
        (SELECT COUNT(*)::int FROM "Question") AS "questionCount",
        (SELECT COUNT(*)::int FROM "QuestionVersion") AS "versionCount",
        (SELECT COUNT(*)::int FROM "QuestionOption") AS "optionCount",
        (SELECT COUNT(*)::int FROM "Tag") AS "tagCount",
        (SELECT COUNT(*)::int FROM "QuestionVersionTag") AS "versionTagCount",
        (SELECT COUNT(*)::int FROM "TagApplicability") AS "applicabilityCount",
        (SELECT COUNT(*)::int FROM "ContentReview") AS "reviewCount",
        (SELECT COUNT(*)::int FROM "AdminAuditLog") AS "auditCount",
        (SELECT COUNT(*)::int FROM "QuestionReport") AS "reportCount",
        (SELECT COUNT(*)::int FROM "QuestionVersion"
          WHERE "contentFingerprint" IS NULL
             OR "contentFingerprint" !~ '^[0-9a-f]{64}$')
          AS "fingerprintNullCount",
        (SELECT COUNT(*)::int FROM "QuestionVersion"
          WHERE "contentFingerprint" IS DISTINCT FROM
            "question_version_fingerprint"("id"))
          AS "fingerprintMismatchCount",
        (SELECT COUNT(*)::int
          FROM "QuestionVersionTag" AS assignment
          JOIN "Tag" AS tag ON tag."id" = assignment."tagId"
          WHERE assignment."labelSnapshot" <> tag."label"
             OR assignment."normalizedNameSnapshot" <> tag."normalizedName")
          AS "snapshotMismatchCount"`
    )
    expect(counts.rows).toEqual([
      {
        applicabilityCount: 126,
        auditCount: 0,
        fingerprintMismatchCount: 0,
        fingerprintNullCount: 0,
        optionCount: 260,
        questionCount: 65,
        reportCount: 0,
        reviewCount: 0,
        snapshotMismatchCount: 0,
        tagCount: 107,
        versionCount: 65,
        versionTagCount: 130
      }
    ])

    const persisted = await client.query<{
      contentFingerprint: string
      id: string
    }>(
      `SELECT "id", "contentFingerprint"
       FROM "QuestionVersion"
       ORDER BY "id"`
    )
    const expected = buildAllQuestionSeeds()
      .map((seed) => ({
        contentFingerprint: createExpectedFingerprint(seed),
        id: seed.versionId
      }))
      .toSorted((left, right) => left.id.localeCompare(right.id))
    expect(persisted.rows).toEqual(expected)
    const fingerprintDigest = await client.query<{ digest: string }>(
      `SELECT encode(public.digest(convert_to(string_agg(
         "id"::text || '|' || "contentFingerprint", E'\\n'
         ORDER BY "id"::text COLLATE "C"
       ), 'UTF8'), 'sha256'), 'hex') AS digest
       FROM "QuestionVersion"`
    )
    expect(fingerprintDigest.rows).toEqual([
      {
        digest: createHash('sha256')
          .update(
            expected
              .map(
                ({ contentFingerprint, id }) => `${id}|${contentFingerprint}`
              )
              .join('\n'),
            'utf8'
          )
          .digest('hex')
      }
    ])
  })

  it('hard delete, published mutation, incomplete content commit을 raw SQL에서도 거부한다', async () => {
    const seed = buildAllQuestionSeeds()[0]
    if (!seed) throw new Error('Canonical Phase 6 seed fixture is unavailable.')

    await expectFailedTransaction(async () => {
      await client.query('DELETE FROM "QuestionVersion" WHERE "id" = $1', [
        seed.versionId
      ])
    }, '23514')
    await expectFailedTransaction(async () => {
      await client.query('DELETE FROM "Question" WHERE "id" = $1', [
        seed.questionId
      ])
    }, '23514')
    await expectFailedTransaction(insertIncompleteSystemQuestion, '23514')
  })

  it('SYSTEM_SEED aggregate에 정상 v2 create→review→approval→publication을 허용한다', async () => {
    const seed = buildAllQuestionSeeds().at(-1)
    if (!seed) throw new Error('SYSTEM_SEED v2 target is unavailable.')
    const selectedTag = seed.tags[0]
    if (!selectedTag) {
      throw new Error('SYSTEM_SEED v2 Tag is unavailable.')
    }
    const authorId = randomUUID()
    const reviewerId = randomUUID()
    const authorSessionId = randomUUID()
    const reviewerSessionId = randomUUID()
    let authorSessionToken = `phase7-seed-v2-author-${randomUUID()}`
    let reviewerSessionToken = `phase7-seed-v2-reviewer-${randomUUID()}`
    const versionId = randomUUID()
    const optionIds = Array.from({ length: 4 }, () => randomUUID())
    if (!optionIds[0]) {
      throw new Error('SYSTEM_SEED v2 options are unavailable.')
    }
    await insertCredentialUser({ id: authorId, role: 'ADMIN' })
    await insertCredentialUser({ id: reviewerId, role: 'ADMIN' })
    await insertGoogleFixtureAccount(authorId)
    await insertGoogleFixtureAccount(reviewerId)
    await withExecutionRole('nihongo_app', () =>
      ownedSessionSql(
        client,
        `SELECT * FROM "phase7_issue_v1_session"(
          $1, 1, 'ADMIN', 'ACTIVE', $2, $3,
          '127.0.0.1', 'phase7-seed-v2-author', false
        )`,
        [authorId, authorSessionId, authorSessionToken]
      )
    )
    await withExecutionRole('nihongo_app', () =>
      ownedSessionSql(
        client,
        `SELECT * FROM "phase7_issue_v1_session"(
          $1, 1, 'ADMIN', 'ACTIVE', $2, $3,
          '127.0.0.1', 'phase7-seed-v2-reviewer', false
        )`,
        [reviewerId, reviewerSessionId, reviewerSessionToken]
      )
    )

    const insertAudit = async (input: {
      actorUserId: string
      afterRowVersion: number | null
      afterState: string | null
      beforeRowVersion: number | null
      beforeState: string | null
      changedFields: readonly string[]
      command: string
      occurredAt: Date
      operationId: string
      requestId: string
      targetId: string
    }): Promise<void> => {
      const changedFields = JSON.stringify(input.changedFields)
      await client.query(
        `INSERT INTO "AdminAuditLog" (
          "command", "targetType", "targetId", "actorKind",
          "actorUserId", "actorId", "actorRole", "actorLabel",
          "beforeState", "afterState", "beforeRowVersion",
          "afterRowVersion", "changedFields", "metadata", "contentDigest",
          "operationId", "requestId", "environment", "occurredAt"
        ) VALUES (
          $1::"AdminAuditCommand", 'QUESTION_VERSION', $2, 'ACCOUNT',
          $3, $3, 'ADMIN', 'ACTIVE_ADMIN', $4::TEXT, $5::TEXT, $6, $7,
          $8::jsonb,
          '{"kind":"NONE_V1"}'::jsonb,
          pg_temp."phase7_admin_audit_content_digest"(
            $9, $1::"AdminAuditCommand", 'QUESTION_VERSION', $2,
            $4::TEXT, $5::TEXT, $6, $7, $8::jsonb,
            '{"kind":"NONE_V1"}'::jsonb
          ), $9, $10, 'TEST', $11
        )`,
        [
          input.command,
          input.targetId,
          input.actorUserId,
          input.beforeState,
          input.afterState,
          input.beforeRowVersion,
          input.afterRowVersion,
          changedFields,
          input.operationId,
          input.requestId,
          input.occurredAt
        ]
      )
    }
    const insertReview = async (input: {
      action: string
      actorUserId: string
      counterpartUserId?: string
      fromState: string
      occurredAt: Date
      operationId: string
      reason?: string
      requestId: string
      toState: string
    }): Promise<void> => {
      await client.query(
        `INSERT INTO "ContentReview" (
          "questionId", "questionVersionId", "action", "fromState",
          "toState", "actorKind", "actorUserId", "actorId", "actorRole",
          "actorLabel", "counterpartUserId", "counterpartActorId",
          "counterpartRole", "counterpartLabel", "reason", "operationId",
          "requestId", "occurredAt"
        ) VALUES (
          $1, $2, $3::"ContentReviewAction", $4::"QuestionVersionStatus",
          $5::"QuestionVersionStatus", 'ACCOUNT', $6, $6, 'ADMIN',
          'ACTIVE_ADMIN', $7, $7,
          CASE WHEN $7::uuid IS NULL THEN NULL ELSE 'ADMIN'::"UserRole" END,
          CASE WHEN $7::uuid IS NULL THEN NULL
            ELSE 'ACTIVE_ADMIN'::"AccountActorLabel" END,
          $8, $9, $10, $11
        )`,
        [
          seed.questionId,
          versionId,
          input.action,
          input.fromState,
          input.toState,
          input.actorUserId,
          input.counterpartUserId ?? null,
          input.reason ?? null,
          input.operationId,
          input.requestId,
          input.occurredAt
        ]
      )
    }

    const createRequestId = randomUUID()
    await client.query('BEGIN')
    try {
      await client.query(`SET LOCAL ROLE "nihongo_app"`)
      const operation = await beginAdminOperation(client, {
        command: 'QUESTION_VERSION_CREATE',
        referencedUserIds: [authorId],
        requestId: createRequestId,
        sessionToken: authorSessionToken,
        targetManifest: {
          questions: [{ id: seed.questionId, rowVersion: 1, state: 'ACTIVE' }],
          reports: [],
          tags: [selectedTag.id],
          versions: []
        }
      })
      await client.query(
        `UPDATE "Question"
         SET "rowVersion" = 2, "updatedAt" = $2 WHERE "id" = $1`,
        [seed.questionId, operation.occurredAt]
      )
      await client.query(
        `INSERT INTO "QuestionVersion" (
          "id", "questionId", "versionNumber", "level", "subject",
          "questionType", "passage", "questionText", "correctOptionId",
          "explanationKo", "explanationJa", "difficulty",
          "contentFingerprint", "createdByUserId", "createdByActorId",
          "createdByRoleSnapshot", "createdByLabelSnapshot",
          "createdAt", "updatedAt"
        ) VALUES (
          $1, $2, 2, $3, $4, $5, $6, $7, $8,
          'SYSTEM_SEED aggregate v2 정상 lifecycle', NULL, $9, repeat('0', 64),
          $10, $10, 'ADMIN', 'ACTIVE_ADMIN', $11, $11
        )`,
        [
          versionId,
          seed.questionId,
          seed.level,
          seed.subject,
          seed.questionType,
          seed.passage,
          `SYSTEM_SEED v2 ${versionId}`,
          optionIds[0],
          seed.difficulty,
          authorId,
          operation.occurredAt
        ]
      )
      for (const [index, optionId] of optionIds.entries()) {
        await client.query(
          `INSERT INTO "QuestionOption" (
            "id", "questionVersionId", "label", "text", "ordinal"
          ) VALUES ($1, $2, $3, $4, $5)`,
          [
            optionId,
            versionId,
            String(index + 1),
            `SYSTEM_SEED v2 option ${index + 1}`,
            index + 1
          ]
        )
      }
      await client.query(
        `INSERT INTO "QuestionVersionTag" (
          "id", "questionVersionId", "tagId", "labelSnapshot",
          "normalizedNameSnapshot"
        ) VALUES ($1, $2, $3, $4, $5)`,
        [
          randomUUID(),
          versionId,
          selectedTag.id,
          selectedTag.label,
          selectedTag.normalizedName
        ]
      )
      await insertAudit({
        actorUserId: authorId,
        afterRowVersion: 1,
        afterState: 'DRAFT',
        beforeRowVersion: null,
        beforeState: null,
        changedFields: [
          'VERSION_STATUS',
          ...EXPECTED_CHANGED_FIELDS.filter(
            (field) => field !== 'LIFECYCLE_STATUS'
          )
        ],
        command: 'QUESTION_VERSION_CREATE',
        occurredAt: operation.occurredAt,
        operationId: operation.operationId,
        requestId: createRequestId,
        targetId: versionId
      })
      await finishInTest(client, [operation.operationId])
      await client.query('COMMIT')
    } catch (error: unknown) {
      await client.query('ROLLBACK')
      throw error
    }

    const transition = async (input: {
      action: 'APPROVED' | 'REQUESTED'
      actorId: string
      command: 'APPROVAL' | 'REVIEW_REQUEST'
      counterpartUserId?: string
      fromState: 'DRAFT' | 'IN_REVIEW'
      fromVersion: number
      sessionToken: string
      toState: 'APPROVED' | 'IN_REVIEW'
    }): Promise<void> => {
      const requestId = randomUUID()
      await client.query('BEGIN')
      try {
        await client.query(`SET LOCAL ROLE "nihongo_app"`)
        const operation = await beginAdminOperation(client, {
          command: input.command,
          referencedUserIds: [
            input.actorId,
            ...(input.counterpartUserId ? [input.counterpartUserId] : [])
          ].toSorted(),
          requestId,
          sessionToken: input.sessionToken,
          targetManifest: {
            questions: [
              { id: seed.questionId, rowVersion: 2, state: 'ACTIVE' }
            ],
            reports: [],
            tags: [],
            versions: [
              {
                id: versionId,
                rowVersion: input.fromVersion,
                state: input.fromState
              }
            ]
          }
        })
        await client.query(
          `UPDATE "QuestionVersion"
           SET "status" = $2::"QuestionVersionStatus",
               "rowVersion" = $3, "updatedAt" = $4
           WHERE "id" = $1`,
          [
            versionId,
            input.toState,
            input.fromVersion + 1,
            operation.occurredAt
          ]
        )
        await insertReview({
          action: input.action,
          actorUserId: input.actorId,
          ...(input.counterpartUserId
            ? { counterpartUserId: input.counterpartUserId }
            : {}),
          fromState: input.fromState,
          occurredAt: operation.occurredAt,
          operationId: operation.operationId,
          requestId,
          toState: input.toState
        })
        await insertAudit({
          actorUserId: input.actorId,
          afterRowVersion: input.fromVersion + 1,
          afterState: input.toState,
          beforeRowVersion: input.fromVersion,
          beforeState: input.fromState,
          changedFields: ['VERSION_STATUS'],
          command: input.command,
          occurredAt: operation.occurredAt,
          operationId: operation.operationId,
          requestId,
          targetId: versionId
        })
        await finishInTest(client, [operation.operationId])
        await client.query('COMMIT')
      } catch (error: unknown) {
        await client.query('ROLLBACK')
        throw error
      }
    }
    await transition({
      action: 'REQUESTED',
      actorId: authorId,
      command: 'REVIEW_REQUEST',
      fromState: 'DRAFT',
      fromVersion: 1,
      sessionToken: authorSessionToken,
      toState: 'IN_REVIEW'
    })
    reviewerSessionToken = await completeAdminSsoFresh(
      reviewerId,
      reviewerSessionToken
    )
    await transition({
      action: 'APPROVED',
      actorId: reviewerId,
      command: 'APPROVAL',
      counterpartUserId: authorId,
      fromState: 'IN_REVIEW',
      fromVersion: 2,
      sessionToken: reviewerSessionToken,
      toState: 'APPROVED'
    })

    authorSessionToken = await completeAdminSsoFresh(
      authorId,
      authorSessionToken
    )
    const publicationRequestId = randomUUID()
    await client.query('BEGIN')
    try {
      await client.query(`SET LOCAL ROLE "nihongo_app"`)
      const operation = await beginAdminOperation(client, {
        command: 'PUBLICATION',
        referencedUserIds: [authorId, reviewerId].toSorted(),
        requestId: publicationRequestId,
        sessionToken: authorSessionToken,
        targetManifest: {
          questions: [{ id: seed.questionId, rowVersion: 2, state: 'ACTIVE' }],
          reports: [],
          tags: [],
          versions: [
            { id: seed.versionId, rowVersion: 1, state: 'PUBLISHED' },
            { id: versionId, rowVersion: 3, state: 'APPROVED' }
          ].toSorted((left, right) => left.id.localeCompare(right.id))
        }
      })
      await client.query(
        `UPDATE "Question"
         SET "currentPublishedVersionId" = $2, "rowVersion" = 3,
             "updatedAt" = $3 WHERE "id" = $1`,
        [seed.questionId, versionId, operation.occurredAt]
      )
      await client.query(
        `UPDATE "QuestionVersion"
         SET "status" = 'RETIRED',
             "retirementKind" = 'PUBLISHED_RETIREMENT',
             "retiredAt" = $2, "rowVersion" = 2, "updatedAt" = $2
         WHERE "id" = $1`,
        [seed.versionId, operation.occurredAt]
      )
      await client.query(
        `UPDATE "QuestionVersion"
         SET "status" = 'PUBLISHED', "publishedAt" = $2,
             "rowVersion" = 4, "updatedAt" = $2 WHERE "id" = $1`,
        [versionId, operation.occurredAt]
      )
      await client.query(
        `INSERT INTO "ContentReview" (
          "questionId", "questionVersionId", "action", "fromState",
          "toState", "actorKind", "actorUserId", "actorId", "actorRole",
          "actorLabel", "reason", "operationId", "requestId", "occurredAt"
        ) VALUES (
          $1, $2, 'RETIRED', 'PUBLISHED', 'RETIRED', 'ACCOUNT',
          $3, $3, 'ADMIN', 'ACTIVE_ADMIN', 'PUBLISHED_REPLACEMENT', $4, $5, $6
        )`,
        [
          seed.questionId,
          seed.versionId,
          authorId,
          operation.operationId,
          publicationRequestId,
          operation.occurredAt
        ]
      )
      await insertReview({
        action: 'PUBLISHED',
        actorUserId: authorId,
        counterpartUserId: reviewerId,
        fromState: 'APPROVED',
        occurredAt: operation.occurredAt,
        operationId: operation.operationId,
        requestId: publicationRequestId,
        toState: 'PUBLISHED'
      })
      await insertAudit({
        actorUserId: authorId,
        afterRowVersion: 4,
        afterState: 'PUBLISHED',
        beforeRowVersion: 3,
        beforeState: 'APPROVED',
        changedFields: ['VERSION_STATUS', 'CURRENT_PUBLISHED_VERSION_ID'],
        command: 'PUBLICATION',
        occurredAt: operation.occurredAt,
        operationId: operation.operationId,
        requestId: publicationRequestId,
        targetId: versionId
      })
      await finishInTest(client, [operation.operationId])
      await client.query('COMMIT')
    } catch (error: unknown) {
      await client.query('ROLLBACK')
      throw error
    }

    expect(
      (
        await client.query<{
          currentPublishedVersionId: string
          newRetirementKind: string | null
          newStatus: string
          oldRetirementKind: string
          oldStatus: string
          rowVersion: number
        }>(
          `SELECT question."currentPublishedVersionId"::text
              AS "currentPublishedVersionId", question."rowVersion",
             old_version."status"::text AS "oldStatus",
             old_version."retirementKind"::text AS "oldRetirementKind",
             new_version."status"::text AS "newStatus",
             new_version."retirementKind"::text AS "newRetirementKind"
           FROM "Question" AS question
           JOIN "QuestionVersion" AS old_version ON old_version."id" = $2
           JOIN "QuestionVersion" AS new_version ON new_version."id" = $3
           WHERE question."id" = $1`,
          [seed.questionId, seed.versionId, versionId]
        )
      ).rows
    ).toEqual([
      {
        currentPublishedVersionId: versionId,
        newRetirementKind: null,
        newStatus: 'PUBLISHED',
        oldRetirementKind: 'PUBLISHED_RETIREMENT',
        oldStatus: 'RETIRED',
        rowVersion: 3
      }
    ])
    await expectFailedTransaction(async () => {
      await client.query(`SET LOCAL session_replication_role = replica`)
      await client.query(
        `UPDATE "QuestionVersion"
         SET "status" = 'RETIRED', "retirementKind" = NULL,
             "retiredAt" = clock_timestamp(), "rowVersion" = 5,
             "updatedAt" = clock_timestamp()
         WHERE "id" = $1`,
        [versionId]
      )
    }, '23514')
    const expectOwnedRetirementRejected = async (input: {
      clearPublishedAt: boolean
      retirementKind: 'PUBLISHED_RETIREMENT' | 'QUESTION_ARCHIVE_ABANDONED'
    }): Promise<void> => {
      await expectFailedTransaction(async () => {
        await client.query(`SET LOCAL ROLE "nihongo_app"`)
        const requestId = randomUUID()
        const operation = await beginAdminOperation(client, {
          command: 'RETIREMENT',
          referencedUserIds: [authorId],
          requestId,
          sessionToken: authorSessionToken,
          targetManifest: {
            questions: [
              { id: seed.questionId, rowVersion: 3, state: 'ACTIVE' }
            ],
            reports: [],
            tags: [],
            versions: [{ id: versionId, rowVersion: 4, state: 'PUBLISHED' }]
          }
        })
        await client.query(
          `UPDATE "Question"
           SET "currentPublishedVersionId" = NULL, "rowVersion" = 4,
               "updatedAt" = $2 WHERE "id" = $1`,
          [seed.questionId, operation.occurredAt]
        )
        await client.query(
          `UPDATE "QuestionVersion"
           SET "status" = 'RETIRED',
               "retirementKind" = $2::"RetirementKind",
               "publishedAt" = CASE WHEN $3 THEN NULL ELSE "publishedAt" END,
               "retiredAt" = $4, "rowVersion" = 5, "updatedAt" = $4
           WHERE "id" = $1`,
          [
            versionId,
            input.retirementKind,
            input.clearPublishedAt,
            operation.occurredAt
          ]
        )
      }, '23514')
    }
    await expectOwnedRetirementRejected({
      clearPublishedAt: false,
      retirementKind: 'QUESTION_ARCHIVE_ABANDONED'
    })
    await expectOwnedRetirementRejected({
      clearPublishedAt: true,
      retirementKind: 'PUBLISHED_RETIREMENT'
    })
    for (const actorId of [authorId, reviewerId]) {
      await withExecutionRole('nihongo_app', () =>
        bridgedQuery(client, `SELECT "phase7_erase_user"($1, 'TEST')`, [
          actorId
        ])
      )
    }
  }, 60_000)

  it('Tag/QVT 전역 mutex가 역순 insert와 delete→insert/rename 교차를 직렬화한다', async () => {
    const firstActorId = randomUUID()
    const secondActorId = randomUUID()
    const firstSessionId = randomUUID()
    const secondSessionId = randomUUID()
    let firstSessionToken = `phase7-tag-first-${randomUUID()}`
    let secondSessionToken = `phase7-tag-second-${randomUUID()}`
    await insertCredentialUser({ id: firstActorId, role: 'ADMIN' })
    await insertCredentialUser({ id: secondActorId, role: 'ADMIN' })
    await insertGoogleFixtureAccount(firstActorId)
    await insertGoogleFixtureAccount(secondActorId)
    await withExecutionRole('nihongo_app', () =>
      ownedSessionSql(
        client,
        `SELECT * FROM "phase7_issue_v1_session"(
          $1, 1, 'ADMIN', 'ACTIVE', $2, $3,
          '127.0.0.1', 'phase7-tag-first', false
        )`,
        [firstActorId, firstSessionId, firstSessionToken]
      )
    )
    await withExecutionRole('nihongo_app', () =>
      ownedSessionSql(
        client,
        `SELECT * FROM "phase7_issue_v1_session"(
          $1, 1, 'ADMIN', 'ACTIVE', $2, $3,
          '127.0.0.1', 'phase7-tag-second', false
        )`,
        [secondActorId, secondSessionId, secondSessionToken]
      )
    )

    const tags = await client.query<{
      id: string
      label: string
      normalizedName: string
    }>(
      `SELECT tag."id", tag."label", tag."normalizedName"
       FROM "Tag" AS tag
       JOIN "TagApplicability" AS applicability
         ON applicability."tagId" = tag."id"
       WHERE applicability."level" = 'N5'
         AND applicability."subject" = 'GRAMMAR'
         AND applicability."questionType" = 'GRAMMAR_SELECT'
       ORDER BY tag."id"
       LIMIT 3`
    )
    const [tagA, tagB, tagC] = tags.rows
    if (!tagA || !tagB || !tagC) {
      throw new Error('Tag mutex fixtures are unavailable.')
    }

    type OperationFixture = {
      actorUserId: string
      occurredAt: Date
      operationId: string
      optionIds: string[]
      questionId: string
      requestId: string
      versionId: string
    }
    const stageQuestionCreate = async (
      targetClient: Client,
      rawSessionToken: string,
      actorUserId: string,
      discriminator: string
    ): Promise<OperationFixture> => {
      const questionId = randomUUID()
      const versionId = randomUUID()
      const optionIds = Array.from({ length: 4 }, () => randomUUID())
      const requestId = randomUUID()
      const operationRow = await beginAdminOperation(targetClient, {
        command: 'QUESTION_CREATE',
        referencedUserIds: [actorUserId],
        requestId,
        sessionToken: rawSessionToken,
        targetManifest: {
          questions: [],
          reports: [],
          tags: [tagA.id, tagB.id].toSorted(),
          versions: []
        }
      })
      if (!operationRow || !optionIds[0]) {
        throw new Error('Tag mutex operation is unavailable.')
      }
      await targetClient.query(
        `INSERT INTO "Question" (
          "id", "createdByUserId", "createdByActorId",
          "createdByRoleSnapshot", "createdByLabelSnapshot",
          "createdAt", "updatedAt"
        ) VALUES ($1, $2, $2, 'ADMIN', 'ACTIVE_ADMIN', $3, $3)`,
        [questionId, operationRow.actorUserId, operationRow.occurredAt]
      )
      await targetClient.query(
        `INSERT INTO "QuestionVersion" (
          "id", "questionId", "versionNumber", "level", "subject",
          "questionType", "questionText", "correctOptionId",
          "explanationKo", "difficulty", "contentFingerprint",
          "createdByUserId", "createdByActorId", "createdByRoleSnapshot",
          "createdByLabelSnapshot", "createdAt", "updatedAt"
        ) VALUES (
          $1, $2, 1, 'N5', 'GRAMMAR', 'GRAMMAR_SELECT', $3, $4,
          'Tag mutex snapshot verification', 'EASY', repeat('0', 64),
          $5, $5, 'ADMIN', 'ACTIVE_ADMIN', $6, $6
        )`,
        [
          versionId,
          questionId,
          `Tag mutex ${discriminator} ${versionId}`,
          optionIds[0],
          operationRow.actorUserId,
          operationRow.occurredAt
        ]
      )
      for (const [index, optionId] of optionIds.entries()) {
        await targetClient.query(
          `INSERT INTO "QuestionOption" (
            "id", "questionVersionId", "label", "text", "ordinal"
          ) VALUES ($1, $2, $3, $4, $5)`,
          [
            optionId,
            versionId,
            String(index + 1),
            `Tag mutex ${discriminator} option ${index + 1}`,
            index + 1
          ]
        )
      }
      return {
        ...operationRow,
        optionIds,
        questionId,
        requestId,
        versionId
      }
    }
    const insertVersionTag = async (
      targetClient: Client,
      versionId: string,
      tag: { id: string; label: string; normalizedName: string }
    ): Promise<string> => {
      const assignmentId = randomUUID()
      await targetClient.query(
        `INSERT INTO "QuestionVersionTag" (
          "id", "questionVersionId", "tagId", "labelSnapshot",
          "normalizedNameSnapshot"
        ) VALUES ($1, $2, $3, $4, $5)`,
        [assignmentId, versionId, tag.id, tag.label, tag.normalizedName]
      )
      return assignmentId
    }
    const finishQuestionCreate = async (
      targetClient: Client,
      fixture: OperationFixture
    ): Promise<void> => {
      await targetClient.query(
        `UPDATE "QuestionVersion" SET "questionText" = "questionText"
         WHERE "id" = $1`,
        [fixture.versionId]
      )
      const changedFields = JSON.stringify(EXPECTED_CHANGED_FIELDS)
      await targetClient.query(
        `INSERT INTO "AdminAuditLog" (
          "command", "targetType", "targetId", "actorKind",
          "actorUserId", "actorId", "actorRole", "actorLabel",
          "beforeState", "afterState", "beforeRowVersion",
          "afterRowVersion", "changedFields", "metadata", "contentDigest",
          "operationId", "requestId", "environment", "occurredAt"
        ) VALUES (
          'QUESTION_CREATE', 'QUESTION', $1, 'ACCOUNT', $2, $2, 'ADMIN',
          'ACTIVE_ADMIN', NULL, 'ACTIVE', NULL, 1, $3::jsonb,
          '{"kind":"NONE_V1"}'::jsonb,
          pg_temp."phase7_admin_audit_content_digest"(
            $4, 'QUESTION_CREATE', 'QUESTION', $1, NULL, 'ACTIVE',
            NULL, 1, $3::jsonb, '{"kind":"NONE_V1"}'::jsonb
          ), $4, $5, 'TEST', $6
        )`,
        [
          fixture.questionId,
          fixture.actorUserId,
          changedFields,
          fixture.operationId,
          fixture.requestId,
          fixture.occurredAt
        ]
      )
      await finishInTest(targetClient, [fixture.operationId])
    }

    const concurrentClient = new Client({
      connectionString: connectionUrl.toString(),
      options: createPostgresStartupOptions(schema)
    })
    let firstTransactionOpen = false
    let secondTransactionOpen = false
    let blockedStage: Promise<OperationFixture> | undefined
    let blockedRenameArm:
      | Promise<{ actorUserId: string; occurredAt: Date; operationId: string }>
      | undefined
    let firstFixture: OperationFixture | undefined
    let secondFixture: OperationFixture | undefined
    await concurrentClient.connect()
    await installAuditDigestSql(concurrentClient)
    try {
      const concurrentBackend = await concurrentClient.query<{ pid: number }>(
        `SELECT pg_backend_pid() AS pid`
      )
      const concurrentBackendPid = concurrentBackend.rows[0]?.pid
      if (!concurrentBackendPid) {
        throw new Error('Tag mutex backend PID is unavailable.')
      }

      await client.query('BEGIN')
      firstTransactionOpen = true
      await client.query(`SET LOCAL ROLE "nihongo_app"`)
      firstFixture = await stageQuestionCreate(
        client,
        firstSessionToken,
        firstActorId,
        'B-then-A'
      )
      await concurrentClient.query('BEGIN')
      secondTransactionOpen = true
      await concurrentClient.query(`SET LOCAL ROLE "nihongo_app"`)
      blockedStage = stageQuestionCreate(
        concurrentClient,
        secondSessionToken,
        secondActorId,
        'A-then-B'
      )
      void blockedStage.catch(() => undefined)

      await insertVersionTag(client, firstFixture.versionId, tagB)
      await client.query('RESET ROLE')
      let reverseInsertWaitObserved = false
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const activity = await client.query<{ waitEventType: string | null }>(
          `SELECT wait_event_type AS "waitEventType"
           FROM pg_stat_activity WHERE pid = $1`,
          [concurrentBackendPid]
        )
        if (activity.rows[0]?.waitEventType === 'Lock') {
          reverseInsertWaitObserved = true
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(reverseInsertWaitObserved).toBe(true)
      await client.query(`SET LOCAL ROLE "nihongo_app"`)
      await insertVersionTag(client, firstFixture.versionId, tagA)
      await finishQuestionCreate(client, firstFixture)
      await client.query('COMMIT')
      firstTransactionOpen = false

      let retrySecondCreate = false
      try {
        secondFixture = await blockedStage
        blockedStage = undefined
        await insertVersionTag(concurrentClient, secondFixture.versionId, tagA)
        await insertVersionTag(concurrentClient, secondFixture.versionId, tagB)
        await finishQuestionCreate(concurrentClient, secondFixture)
        await concurrentClient.query('COMMIT')
        secondTransactionOpen = false
      } catch (error: unknown) {
        blockedStage = undefined
        expect(error).toMatchObject({ code: '40001' })
        await concurrentClient.query('ROLLBACK')
        secondTransactionOpen = false
        retrySecondCreate = true
      }

      if (retrySecondCreate) {
        await concurrentClient.query('BEGIN')
        secondTransactionOpen = true
        await concurrentClient.query(`SET LOCAL ROLE "nihongo_app"`)
        secondFixture = await stageQuestionCreate(
          concurrentClient,
          secondSessionToken,
          secondActorId,
          'A-then-B-retry'
        )
        await insertVersionTag(concurrentClient, secondFixture.versionId, tagA)
        await insertVersionTag(concurrentClient, secondFixture.versionId, tagB)
        await finishQuestionCreate(concurrentClient, secondFixture)
        await concurrentClient.query('COMMIT')
        secondTransactionOpen = false
      }
      if (!secondFixture) {
        throw new Error('Second Tag mutex fixture is unavailable.')
      }

      const insertedSnapshots = await client.query<{
        labelSnapshot: string
        normalizedNameSnapshot: string
        questionVersionId: string
        tagId: string
      }>(
        `SELECT assignment."questionVersionId", assignment."tagId",
           assignment."labelSnapshot", assignment."normalizedNameSnapshot"
         FROM "QuestionVersionTag" AS assignment
         WHERE assignment."questionVersionId" = ANY($1::uuid[])
         ORDER BY assignment."questionVersionId", assignment."tagId"`,
        [[firstFixture.versionId, secondFixture.versionId]]
      )
      expect(insertedSnapshots.rows).toHaveLength(4)
      for (const snapshot of insertedSnapshots.rows) {
        const expectedTag = snapshot.tagId === tagA.id ? tagA : tagB
        expect(snapshot).toMatchObject({
          labelSnapshot: expectedTag.label,
          normalizedNameSnapshot: expectedTag.normalizedName
        })
      }

      // Prove that the statement triggers themselves share the global Tag/QVT
      // mutex. REVIEW_REQUEST operations use disjoint targets and an empty tag
      // manifest, so neither arm call can acquire the tag-manifest mutex for us.
      const primaryBackend = await client.query<{ pid: number }>(
        `SELECT pg_backend_pid() AS pid`
      )
      const primaryBackendPid = primaryBackend.rows[0]?.pid
      if (!primaryBackendPid) {
        throw new Error('Primary Tag mutex backend PID is unavailable.')
      }
      const qvtProbePrimaryRequestId = randomUUID()
      const qvtProbeSecondaryRequestId = randomUUID()
      let qvtProbePrimaryOperationId = ''
      let qvtProbeSecondaryOperationId = ''
      let qvtProbePrimaryOpen = false
      let qvtProbeSecondaryOpen = false
      let blockedTagUpdate: Promise<unknown> | undefined
      let blockedTagUpdateError: unknown
      try {
        await client.query('BEGIN')
        qvtProbePrimaryOpen = true
        await client.query(`SET LOCAL ROLE "nihongo_app"`)
        const primaryProbe = await beginAdminOperation(client, {
          command: 'REVIEW_REQUEST',
          referencedUserIds: [firstActorId],
          requestId: qvtProbePrimaryRequestId,
          sessionToken: firstSessionToken,
          targetManifest: {
            questions: [
              { id: firstFixture.questionId, rowVersion: 1, state: 'ACTIVE' }
            ],
            reports: [],
            tags: [],
            versions: [
              { id: firstFixture.versionId, rowVersion: 1, state: 'DRAFT' }
            ]
          }
        })
        qvtProbePrimaryOperationId = primaryProbe.operationId

        await concurrentClient.query('BEGIN')
        qvtProbeSecondaryOpen = true
        await concurrentClient.query(`SET LOCAL ROLE "nihongo_app"`)
        const secondaryProbe = await beginAdminOperation(concurrentClient, {
          command: 'REVIEW_REQUEST',
          referencedUserIds: [secondActorId],
          requestId: qvtProbeSecondaryRequestId,
          sessionToken: secondSessionToken,
          targetManifest: {
            questions: [
              { id: secondFixture.questionId, rowVersion: 1, state: 'ACTIVE' }
            ],
            reports: [],
            tags: [],
            versions: [
              { id: secondFixture.versionId, rowVersion: 1, state: 'DRAFT' }
            ]
          }
        })
        qvtProbeSecondaryOperationId = secondaryProbe.operationId

        await client.query(
          `DELETE FROM "QuestionVersionTag"
           WHERE "questionVersionId" = $1 AND "tagId" = $2`,
          [firstFixture.versionId, tagA.id]
        )
        await concurrentClient.query('RESET ROLE')
        blockedTagUpdate = concurrentClient
          .query(`UPDATE "Tag" SET "label" = "label" WHERE "id" = $1`, [
            tagC.id
          ])
          .catch((error: unknown) => {
            blockedTagUpdateError = error
          })

        await client.query('RESET ROLE')
        let statementTriggerWaitObserved = false
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const activity = await client.query<{
            blockingPids: number[]
            waitEventType: string | null
          }>(
            `SELECT pg_blocking_pids($1) AS "blockingPids",
               wait_event_type AS "waitEventType"
             FROM pg_stat_activity WHERE pid = $1`,
            [concurrentBackendPid]
          )
          if (
            activity.rows[0]?.waitEventType === 'Lock' &&
            activity.rows[0]?.blockingPids.length === 1 &&
            activity.rows[0]?.blockingPids[0] === primaryBackendPid
          ) {
            statementTriggerWaitObserved = true
            break
          }
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
        expect(statementTriggerWaitObserved).toBe(true)
      } finally {
        // Release the statement-trigger blocker before awaiting its waiter.
        if (qvtProbePrimaryOpen) {
          await client.query('ROLLBACK').catch(() => undefined)
          qvtProbePrimaryOpen = false
        }
        await blockedTagUpdate?.catch(() => undefined)
        if (qvtProbeSecondaryOpen) {
          await concurrentClient.query('ROLLBACK').catch(() => undefined)
          qvtProbeSecondaryOpen = false
        }
      }
      expect(blockedTagUpdateError).toBeUndefined()
      expect(qvtProbePrimaryOperationId).not.toBe('')
      expect(qvtProbeSecondaryOperationId).not.toBe('')
      expect(
        (
          await client.query<{
            auditCount: number
            intentCount: number
            label: string
            normalizedName: string
            versionTagCount: number
          }>(
            `SELECT tag."label", tag."normalizedName",
               (SELECT COUNT(*)::int FROM "QuestionVersionTag"
                WHERE "questionVersionId" = ANY($1::uuid[]))
                 AS "versionTagCount",
               (SELECT COUNT(*)::int FROM "OperationIntent"
                WHERE "operationId" = ANY($2::uuid[])) AS "intentCount",
               (SELECT COUNT(*)::int FROM "AdminAuditLog"
                WHERE "operationId" = ANY($2::uuid[])) AS "auditCount"
             FROM "Tag" AS tag WHERE tag."id" = $3`,
            [
              [firstFixture.versionId, secondFixture.versionId],
              [qvtProbePrimaryOperationId, qvtProbeSecondaryOperationId],
              tagC.id
            ]
          )
        ).rows
      ).toEqual([
        {
          auditCount: 0,
          intentCount: 0,
          label: tagC.label,
          normalizedName: tagC.normalizedName,
          versionTagCount: 4
        }
      ])

      const updateRequestId = randomUUID()
      const firstVersionId = firstFixture.versionId
      await client.query('BEGIN')
      firstTransactionOpen = true
      await client.query(`SET LOCAL ROLE "nihongo_app"`)
      const updateOperationRow = await beginAdminOperation(client, {
        command: 'QUESTION_VERSION_UPDATE',
        referencedUserIds: [firstActorId],
        requestId: updateRequestId,
        sessionToken: firstSessionToken,
        targetManifest: {
          questions: [
            { id: firstFixture.questionId, rowVersion: 1, state: 'ACTIVE' }
          ],
          reports: [],
          tags: [tagB.id, tagC.id].toSorted(),
          versions: [{ id: firstVersionId, rowVersion: 1, state: 'DRAFT' }]
        }
      })
      await client.query(
        `DELETE FROM "QuestionVersionTag"
         WHERE "questionVersionId" = $1 AND "tagId" = $2`,
        [firstVersionId, tagA.id]
      )

      const renameRequestId = randomUUID()
      await concurrentClient.query('BEGIN')
      secondTransactionOpen = true
      await concurrentClient.query(`SET LOCAL ROLE "nihongo_app"`)
      blockedRenameArm = beginAdminOperation(concurrentClient, {
        command: 'QUESTION_VERSION_UPDATE',
        referencedUserIds: [secondActorId],
        requestId: renameRequestId,
        sessionToken: secondSessionToken,
        targetManifest: {
          questions: [
            { id: secondFixture.questionId, rowVersion: 1, state: 'ACTIVE' }
          ],
          reports: [],
          tags: [tagC.id],
          versions: [
            { id: secondFixture.versionId, rowVersion: 1, state: 'DRAFT' }
          ]
        }
      })
      void blockedRenameArm.catch(() => undefined)
      await client.query('RESET ROLE')
      let renameWaitObserved = false
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const activity = await client.query<{ waitEventType: string | null }>(
          `SELECT wait_event_type AS "waitEventType"
           FROM pg_stat_activity WHERE pid = $1`,
          [concurrentBackendPid]
        )
        if (activity.rows[0]?.waitEventType === 'Lock') {
          renameWaitObserved = true
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(renameWaitObserved).toBe(true)
      await client.query(`SET LOCAL ROLE "nihongo_app"`)
      await insertVersionTag(client, firstFixture.versionId, tagC)
      await client.query(
        `UPDATE "QuestionVersion"
         SET "questionText" = "questionText", "rowVersion" = "rowVersion" + 1,
             "updatedAt" = $2
         WHERE "id" = $1`,
        [firstFixture.versionId, updateOperationRow.occurredAt]
      )
      await client.query('RESET ROLE')
      // P4 removed the DB delta capture; these are the values the update writes.
      const updateDeltaRow = {
        afterRowVersion: 2,
        afterState: 'DRAFT',
        beforeRowVersion: 1,
        beforeState: 'DRAFT',
        changedFields: ['TAGS']
      }
      await client.query(`SET LOCAL ROLE "nihongo_app"`)
      const updateChangedFields = JSON.stringify(updateDeltaRow.changedFields)
      await client.query(
        `INSERT INTO "AdminAuditLog" (
          "command", "targetType", "targetId", "actorKind",
          "actorUserId", "actorId", "actorRole", "actorLabel",
          "beforeState", "afterState", "beforeRowVersion",
          "afterRowVersion", "changedFields", "metadata", "contentDigest",
          "operationId", "requestId", "environment", "occurredAt"
        ) VALUES (
          'QUESTION_VERSION_UPDATE', 'QUESTION_VERSION', $1, 'ACCOUNT',
          $2, $2, 'ADMIN', 'ACTIVE_ADMIN', $3::TEXT, $4::TEXT, $5, $6,
          $7::jsonb,
          '{"kind":"NONE_V1"}'::jsonb,
          pg_temp."phase7_admin_audit_content_digest"(
            $8, 'QUESTION_VERSION_UPDATE', 'QUESTION_VERSION', $1,
            $3::TEXT, $4::TEXT, $5, $6, $7::jsonb,
            '{"kind":"NONE_V1"}'::jsonb
          ), $8, $9, 'TEST', $10
        )`,
        [
          firstFixture.versionId,
          updateOperationRow.actorUserId,
          updateDeltaRow.beforeState,
          updateDeltaRow.afterState,
          updateDeltaRow.beforeRowVersion,
          updateDeltaRow.afterRowVersion,
          updateChangedFields,
          updateOperationRow.operationId,
          updateRequestId,
          updateOperationRow.occurredAt
        ]
      )
      await finishInTest(client, [updateOperationRow.operationId])
      await client.query('COMMIT')
      firstTransactionOpen = false

      try {
        await blockedRenameArm
        blockedRenameArm = undefined
      } catch (error: unknown) {
        blockedRenameArm = undefined
        expect(error).toMatchObject({ code: '40001' })
      } finally {
        await concurrentClient.query('ROLLBACK')
        secondTransactionOpen = false
      }

      expect(
        (
          await client.query<{
            labelSnapshot: string
            liveLabel: string
            liveNormalizedName: string
            normalizedNameSnapshot: string
          }>(
            `SELECT tag."label" AS "liveLabel",
               tag."normalizedName" AS "liveNormalizedName",
               assignment."labelSnapshot", assignment."normalizedNameSnapshot"
             FROM "Tag" AS tag
             JOIN "QuestionVersionTag" AS assignment
               ON assignment."tagId" = tag."id"
             WHERE tag."id" = $1 AND assignment."questionVersionId" = $2`,
            [tagC.id, firstFixture.versionId]
          )
        ).rows
      ).toEqual([
        {
          labelSnapshot: tagC.label,
          liveLabel: tagC.label,
          liveNormalizedName: tagC.normalizedName,
          normalizedNameSnapshot: tagC.normalizedName
        }
      ])
    } finally {
      if (firstTransactionOpen) {
        await client.query('ROLLBACK').catch(() => undefined)
      }
      await blockedStage?.catch(() => undefined)
      await blockedRenameArm?.catch(() => undefined)
      if (secondTransactionOpen) {
        await concurrentClient.query('ROLLBACK').catch(() => undefined)
      }
      await concurrentClient.end().catch(() => undefined)
    }

    if (!firstFixture) {
      throw new Error('Tag manifest mismatch fixture is unavailable.')
    }
    // P4 removed the DB manifest/delta verifier, so the API builds the
    // manifest from the request and no raw manifest mismatch probe remains.

    if (!secondFixture) {
      throw new Error('Reciprocal review fixture is unavailable.')
    }
    type LifecycleTransition = {
      action: 'APPROVED' | 'REQUESTED'
      actorUserId: string
      counterpartUserId?: string
      fromRowVersion: number
      fromState: 'DRAFT' | 'IN_REVIEW'
      operation: {
        actorUserId: string
        occurredAt: Date
        operationId: string
      }
      requestId: string
      target: OperationFixture
      toState: 'APPROVED' | 'IN_REVIEW'
    }
    const finishLifecycleTransition = async (
      targetClient: Client,
      transition: LifecycleTransition
    ): Promise<void> => {
      const toRowVersion = transition.fromRowVersion + 1
      await targetClient.query(
        `UPDATE "QuestionVersion"
         SET "status" = $2::"QuestionVersionStatus", "rowVersion" = $3,
             "updatedAt" = $4 WHERE "id" = $1`,
        [
          transition.target.versionId,
          transition.toState,
          toRowVersion,
          transition.operation.occurredAt
        ]
      )
      await targetClient.query(
        `INSERT INTO "ContentReview" (
          "questionId", "questionVersionId", "action", "fromState",
          "toState", "actorKind", "actorUserId", "actorId", "actorRole",
          "actorLabel", "counterpartUserId", "counterpartActorId",
          "counterpartRole", "counterpartLabel", "operationId", "requestId",
          "occurredAt"
        ) VALUES (
          $1, $2, $3::"ContentReviewAction", $4::"QuestionVersionStatus",
          $5::"QuestionVersionStatus", 'ACCOUNT', $6, $6, 'ADMIN',
          'ACTIVE_ADMIN', $7, $7,
          CASE WHEN $7::uuid IS NULL THEN NULL ELSE 'ADMIN'::"UserRole" END,
          CASE WHEN $7::uuid IS NULL THEN NULL
            ELSE 'ACTIVE_ADMIN'::"AccountActorLabel" END,
          $8, $9, $10
        )`,
        [
          transition.target.questionId,
          transition.target.versionId,
          transition.action,
          transition.fromState,
          transition.toState,
          transition.actorUserId,
          transition.counterpartUserId ?? null,
          transition.operation.operationId,
          transition.requestId,
          transition.operation.occurredAt
        ]
      )
      const changedFields = JSON.stringify(['VERSION_STATUS'])
      await targetClient.query(
        `INSERT INTO "AdminAuditLog" (
          "command", "targetType", "targetId", "actorKind",
          "actorUserId", "actorId", "actorRole", "actorLabel",
          "beforeState", "afterState", "beforeRowVersion",
          "afterRowVersion", "changedFields", "metadata", "contentDigest",
          "operationId", "requestId", "environment", "occurredAt"
        ) VALUES (
          $1::"AdminAuditCommand", 'QUESTION_VERSION', $2, 'ACCOUNT',
          $3, $3, 'ADMIN', 'ACTIVE_ADMIN', $4::TEXT, $5::TEXT, $6, $7,
          $8::jsonb,
          '{"kind":"NONE_V1"}'::jsonb,
          pg_temp."phase7_admin_audit_content_digest"(
            $9, $1::"AdminAuditCommand", 'QUESTION_VERSION', $2,
            $4::TEXT, $5::TEXT, $6, $7, $8::jsonb,
            '{"kind":"NONE_V1"}'::jsonb
          ), $9, $10, 'TEST', $11
        )`,
        [
          transition.action === 'REQUESTED' ? 'REVIEW_REQUEST' : 'APPROVAL',
          transition.target.versionId,
          transition.actorUserId,
          transition.fromState,
          transition.toState,
          transition.fromRowVersion,
          toRowVersion,
          changedFields,
          transition.operation.operationId,
          transition.requestId,
          transition.operation.occurredAt
        ]
      )
      await finishInTest(targetClient, [transition.operation.operationId])
    }
    const commitReviewRequest = async (
      target: OperationFixture,
      actorUserId: string,
      sessionToken: string,
      fromRowVersion: number
    ): Promise<void> => {
      const requestId = randomUUID()
      await client.query('BEGIN')
      try {
        await client.query(`SET LOCAL ROLE "nihongo_app"`)
        const operation = await beginAdminOperation(client, {
          command: 'REVIEW_REQUEST',
          referencedUserIds: [actorUserId],
          requestId,
          sessionToken,
          targetManifest: {
            questions: [
              { id: target.questionId, rowVersion: 1, state: 'ACTIVE' }
            ],
            reports: [],
            tags: [],
            versions: [
              {
                id: target.versionId,
                rowVersion: fromRowVersion,
                state: 'DRAFT'
              }
            ]
          }
        })
        await finishLifecycleTransition(client, {
          action: 'REQUESTED',
          actorUserId,
          fromRowVersion,
          fromState: 'DRAFT',
          operation,
          requestId,
          target,
          toState: 'IN_REVIEW'
        })
        await client.query('COMMIT')
      } catch (error: unknown) {
        await client.query('ROLLBACK')
        throw error
      }
    }
    await commitReviewRequest(firstFixture, firstActorId, firstSessionToken, 2)
    await commitReviewRequest(
      secondFixture,
      secondActorId,
      secondSessionToken,
      1
    )

    firstSessionToken = await completeAdminSsoFresh(
      firstActorId,
      firstSessionToken
    )
    secondSessionToken = await completeAdminSsoFresh(
      secondActorId,
      secondSessionToken
    )
    const reciprocalClient = new Client({
      connectionString: connectionUrl.toString(),
      options: createPostgresStartupOptions(schema)
    })
    let primaryApprovalOpen = false
    let reciprocalApprovalOpen = false
    let reciprocalBegin: ReturnType<typeof beginAdminOperation> | undefined
    await reciprocalClient.connect()
    await installAuditDigestSql(reciprocalClient)
    try {
      const reciprocalBackend = await reciprocalClient.query<{ pid: number }>(
        `SELECT pg_backend_pid() AS pid`
      )
      const reciprocalBackendPid = reciprocalBackend.rows[0]?.pid
      if (!reciprocalBackendPid) {
        throw new Error('Reciprocal approval backend is unavailable.')
      }
      const firstApprovalRequestId = randomUUID()
      await client.query('BEGIN')
      primaryApprovalOpen = true
      await client.query(`SET LOCAL ROLE "nihongo_app"`)
      const firstApproval = await beginAdminOperation(client, {
        command: 'APPROVAL',
        referencedUserIds: [firstActorId, secondActorId].toSorted(),
        requestId: firstApprovalRequestId,
        sessionToken: secondSessionToken,
        targetManifest: {
          questions: [
            { id: firstFixture.questionId, rowVersion: 1, state: 'ACTIVE' }
          ],
          reports: [],
          tags: [],
          versions: [
            { id: firstFixture.versionId, rowVersion: 3, state: 'IN_REVIEW' }
          ]
        }
      })

      const secondApprovalRequestId = randomUUID()
      await reciprocalClient.query('BEGIN')
      reciprocalApprovalOpen = true
      await reciprocalClient.query(`SET LOCAL ROLE "nihongo_app"`)
      reciprocalBegin = beginAdminOperation(reciprocalClient, {
        command: 'APPROVAL',
        referencedUserIds: [firstActorId, secondActorId].toSorted(),
        requestId: secondApprovalRequestId,
        sessionToken: firstSessionToken,
        targetManifest: {
          questions: [
            { id: secondFixture.questionId, rowVersion: 1, state: 'ACTIVE' }
          ],
          reports: [],
          tags: [],
          versions: [
            { id: secondFixture.versionId, rowVersion: 2, state: 'IN_REVIEW' }
          ]
        }
      })
      void reciprocalBegin.catch(() => undefined)
      await client.query('RESET ROLE')
      let reciprocalWaitObserved = false
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const activity = await client.query<{ waitEventType: string | null }>(
          `SELECT wait_event_type AS "waitEventType"
           FROM pg_stat_activity WHERE pid = $1`,
          [reciprocalBackendPid]
        )
        if (activity.rows[0]?.waitEventType === 'Lock') {
          reciprocalWaitObserved = true
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(reciprocalWaitObserved).toBe(true)
      await client.query(`SET LOCAL ROLE "nihongo_app"`)
      await finishLifecycleTransition(client, {
        action: 'APPROVED',
        actorUserId: secondActorId,
        counterpartUserId: firstActorId,
        fromRowVersion: 3,
        fromState: 'IN_REVIEW',
        operation: firstApproval,
        requestId: firstApprovalRequestId,
        target: firstFixture,
        toState: 'APPROVED'
      })
      await client.query('COMMIT')
      primaryApprovalOpen = false

      const secondApproval = await reciprocalBegin
      reciprocalBegin = undefined
      await finishLifecycleTransition(reciprocalClient, {
        action: 'APPROVED',
        actorUserId: firstActorId,
        counterpartUserId: secondActorId,
        fromRowVersion: 2,
        fromState: 'IN_REVIEW',
        operation: secondApproval,
        requestId: secondApprovalRequestId,
        target: secondFixture,
        toState: 'APPROVED'
      })
      await reciprocalClient.query('COMMIT')
      reciprocalApprovalOpen = false
    } finally {
      if (primaryApprovalOpen) {
        await client.query('ROLLBACK').catch(() => undefined)
      }
      await reciprocalBegin?.catch(() => undefined)
      if (reciprocalApprovalOpen) {
        await reciprocalClient.query('ROLLBACK').catch(() => undefined)
      }
      await reciprocalClient.end()
    }
    expect(
      (
        await client.query<{
          firstRowVersion: number
          firstStatus: string
          secondRowVersion: number
          secondStatus: string
        }>(
          `SELECT first_version."status"::text AS "firstStatus",
             first_version."rowVersion" AS "firstRowVersion",
             second_version."status"::text AS "secondStatus",
             second_version."rowVersion" AS "secondRowVersion"
           FROM "QuestionVersion" AS first_version
           CROSS JOIN "QuestionVersion" AS second_version
           WHERE first_version."id" = $1 AND second_version."id" = $2`,
          [firstFixture.versionId, secondFixture.versionId]
        )
      ).rows
    ).toEqual([
      {
        firstRowVersion: 4,
        firstStatus: 'APPROVED',
        secondRowVersion: 3,
        secondStatus: 'APPROVED'
      }
    ])

    // The authority-change target must not own an open candidate. Retire the
    // reciprocal fixture through the real archive workflow while preserving
    // the first fixture's reviewer evidence for the lock-ordering scenario.
    const archiveRequestId = randomUUID()
    await client.query('BEGIN')
    try {
      await client.query(`SET LOCAL ROLE "nihongo_app"`)
      const archiveOperation = await beginAdminOperation(client, {
        command: 'QUESTION_ARCHIVE',
        referencedUserIds: [firstActorId, secondActorId].toSorted(),
        requestId: archiveRequestId,
        sessionToken: firstSessionToken,
        targetManifest: {
          questions: [
            { id: secondFixture.questionId, rowVersion: 1, state: 'ACTIVE' }
          ],
          reports: [],
          tags: [],
          versions: [
            { id: secondFixture.versionId, rowVersion: 3, state: 'APPROVED' }
          ]
        }
      })
      await client.query(
        `UPDATE "Question"
         SET "lifecycleStatus" = 'ARCHIVED', "archivedAt" = $2,
             "rowVersion" = 2, "updatedAt" = $2
         WHERE "id" = $1`,
        [secondFixture.questionId, archiveOperation.occurredAt]
      )
      await client.query(
        `UPDATE "QuestionVersion"
         SET "status" = 'RETIRED',
             "retirementKind" = 'QUESTION_ARCHIVE_ABANDONED',
             "retiredAt" = $2, "rowVersion" = 4, "updatedAt" = $2
         WHERE "id" = $1`,
        [secondFixture.versionId, archiveOperation.occurredAt]
      )
      await client.query(
        `INSERT INTO "ContentReview" (
          "questionId", "questionVersionId", "action", "fromState",
          "toState", "actorKind", "actorUserId", "actorId", "actorRole",
          "actorLabel", "counterpartUserId", "counterpartActorId",
          "counterpartRole", "counterpartLabel", "reason", "operationId",
          "requestId", "occurredAt"
        ) VALUES (
          $1, $2, 'ARCHIVE_ABANDONED', 'APPROVED', 'RETIRED', 'ACCOUNT',
          $3, $3, 'ADMIN', 'ACTIVE_ADMIN', $4, $4, 'ADMIN', 'ACTIVE_ADMIN',
          'QUESTION_ARCHIVE', $5, $6, $7
        )`,
        [
          secondFixture.questionId,
          secondFixture.versionId,
          archiveOperation.actorUserId,
          secondActorId,
          archiveOperation.operationId,
          archiveRequestId,
          archiveOperation.occurredAt
        ]
      )
      const archiveMetadata = JSON.stringify({
        abandonedCandidateCount: 1,
        kind: 'QUESTION_ARCHIVE_V1',
        retiredPublishedCount: 0
      })
      await client.query(
        `INSERT INTO "AdminAuditLog" (
          "command", "targetType", "targetId", "actorKind",
          "actorUserId", "actorId", "actorRole", "actorLabel",
          "beforeState", "afterState", "beforeRowVersion",
          "afterRowVersion", "changedFields", "metadata", "contentDigest",
          "operationId", "requestId", "environment", "occurredAt"
        ) VALUES (
          'QUESTION_ARCHIVE', 'QUESTION', $1, 'ACCOUNT', $2, $2,
          'ADMIN', 'ACTIVE_ADMIN', 'ACTIVE', 'ARCHIVED', 1, 2,
          '["LIFECYCLE_STATUS","VERSION_STATUS"]'::jsonb, $3::jsonb,
          pg_temp."phase7_admin_audit_content_digest"(
            $4, 'QUESTION_ARCHIVE', 'QUESTION', $1,
            'ACTIVE', 'ARCHIVED', 1, 2,
            '["LIFECYCLE_STATUS","VERSION_STATUS"]'::jsonb, $3::jsonb
          ), $4, $5, 'TEST', $6
        )`,
        [
          secondFixture.questionId,
          archiveOperation.actorUserId,
          archiveMetadata,
          archiveOperation.operationId,
          archiveRequestId,
          archiveOperation.occurredAt
        ]
      )
      await finishInTest(client, [archiveOperation.operationId])
      await client.query('COMMIT')
    } catch (error: unknown) {
      await client.query('ROLLBACK')
      throw error
    }

    let freshFirstSessionToken = `phase7-tag-authority-${randomUUID()}`
    await withExecutionRole('nihongo_app', () =>
      ownedSessionSql(
        client,
        `SELECT * FROM "phase7_issue_v1_session"(
          $1, 1, 'ADMIN', 'ACTIVE', $2, $3,
          '127.0.0.1', 'phase7-tag-authority', false
        )`,
        [firstActorId, randomUUID(), freshFirstSessionToken]
      )
    )
    freshFirstSessionToken = await completeAdminSsoFresh(
      firstActorId,
      freshFirstSessionToken
    )
    const authorityClient = new Client({
      connectionString: connectionUrl.toString(),
      options: createPostgresStartupOptions(schema)
    })
    let publicationLockOpen = false
    let authorityChange: Promise<unknown> | undefined
    await authorityClient.connect()
    try {
      // #504 P7 PR5a: the TEST-only authority change runs as nihongo_app.
      await authorityClient.query(`SET ROLE "nihongo_app"`)
      const authorityBackend = await authorityClient.query<{ pid: number }>(
        `SELECT pg_backend_pid() AS pid`
      )
      const authorityBackendPid = authorityBackend.rows[0]?.pid
      if (!authorityBackendPid) {
        throw new Error('Authority-change backend is unavailable.')
      }
      await client.query('BEGIN')
      publicationLockOpen = true
      await client.query(`SET LOCAL ROLE "nihongo_app"`)
      await beginAdminOperation(client, {
        command: 'PUBLICATION',
        referencedUserIds: [firstActorId, secondActorId].toSorted(),
        requestId: randomUUID(),
        sessionToken: freshFirstSessionToken,
        targetManifest: {
          questions: [
            { id: firstFixture.questionId, rowVersion: 1, state: 'ACTIVE' }
          ],
          reports: [],
          tags: [],
          versions: [
            { id: firstFixture.versionId, rowVersion: 4, state: 'APPROVED' }
          ]
        }
      })
      authorityChange = bridgedQuery(
        authorityClient,
        `SELECT "phase7_change_user_authority"(
          $1, $2, 1, 'USER', 'ACTIVE', 'TEST'
        ) AS "newGeneration"`,
        [freshFirstSessionToken, secondActorId]
      )
      void authorityChange.catch(() => undefined)
      await client.query('RESET ROLE')
      let authorityWaitObserved = false
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const activity = await client.query<{ waitEventType: string | null }>(
          `SELECT wait_event_type AS "waitEventType"
           FROM pg_stat_activity WHERE pid = $1`,
          [authorityBackendPid]
        )
        if (activity.rows[0]?.waitEventType === 'Lock') {
          authorityWaitObserved = true
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(authorityWaitObserved).toBe(true)
      await client.query('ROLLBACK')
      publicationLockOpen = false
      await expect(authorityChange).resolves.toMatchObject({
        rows: [{ newGeneration: 2 }]
      })
      authorityChange = undefined
    } finally {
      if (publicationLockOpen) {
        await client.query('ROLLBACK').catch(() => undefined)
      }
      await authorityChange?.catch(() => undefined)
      await authorityClient.query('RESET ROLE').catch(() => undefined)
      await authorityClient.end()
    }

    const postAuthorityPublicationRequestId = randomUUID()
    let postAuthorityPublicationOperationId = ''
    await client.query('BEGIN')
    try {
      await client.query(`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`)
      await client.query(`SET LOCAL ROLE "nihongo_app"`)
      const begun = await beginInTest(client, [
        'PUBLICATION',
        freshFirstSessionToken,
        postAuthorityPublicationRequestId,
        [firstActorId, secondActorId].toSorted()
      ])
      const operation = begun.rows[0]
      if (!operation) {
        throw new Error('Post-authority publication operation is unavailable.')
      }
      postAuthorityPublicationOperationId = operation.operationId
      const occurredAt = await armInTest(
        client,
        {
          ...operation,
          command: 'PUBLICATION',
          referencedUserIds: [firstActorId, secondActorId].toSorted()
        },
        {
          questions: [
            { id: firstFixture.questionId, rowVersion: 1, state: 'ACTIVE' }
          ],
          reports: [],
          tags: [],
          versions: [
            { id: firstFixture.versionId, rowVersion: 4, state: 'APPROVED' }
          ]
        }
      )
      if (!occurredAt) {
        throw new Error('Post-authority publication time is unavailable.')
      }
      await client.query(
        `UPDATE "QuestionVersion"
         SET "status" = 'PUBLISHED', "publishedAt" = $2,
             "rowVersion" = 5, "updatedAt" = $2 WHERE "id" = $1`,
        [firstFixture.versionId, occurredAt]
      )
      await client.query(
        `UPDATE "Question"
         SET "currentPublishedVersionId" = $2, "rowVersion" = 2,
             "updatedAt" = $3 WHERE "id" = $1`,
        [firstFixture.questionId, firstFixture.versionId, occurredAt]
      )
      await client.query(
        `INSERT INTO "ContentReview" (
          "questionId", "questionVersionId", "action", "fromState",
          "toState", "actorKind", "actorUserId", "actorId", "actorRole",
          "actorLabel", "counterpartUserId", "counterpartActorId",
          "counterpartRole", "counterpartLabel", "operationId", "requestId",
          "occurredAt"
        ) VALUES (
          $1, $2, 'PUBLISHED', 'APPROVED', 'PUBLISHED', 'ACCOUNT',
          $3, $3, 'ADMIN', 'ACTIVE_ADMIN', $4, $4, 'ADMIN', 'ACTIVE_ADMIN',
          $5, $6, $7
        )`,
        [
          firstFixture.questionId,
          firstFixture.versionId,
          operation.actorUserId,
          secondActorId,
          operation.operationId,
          postAuthorityPublicationRequestId,
          occurredAt
        ]
      )
      await client.query(
        `INSERT INTO "AdminAuditLog" (
          "command", "targetType", "targetId", "actorKind",
          "actorUserId", "actorId", "actorRole", "actorLabel",
          "beforeState", "afterState", "beforeRowVersion",
          "afterRowVersion", "changedFields", "metadata", "contentDigest",
          "operationId", "requestId", "environment", "occurredAt"
        ) VALUES (
          'PUBLICATION', 'QUESTION_VERSION', $1, 'ACCOUNT', $2, $2,
          'ADMIN', 'ACTIVE_ADMIN', 'APPROVED', 'PUBLISHED', 4, 5,
          '["VERSION_STATUS","CURRENT_PUBLISHED_VERSION_ID"]'::jsonb,
          '{"kind":"NONE_V1"}'::jsonb,
          pg_temp."phase7_admin_audit_content_digest"(
            $3, 'PUBLICATION', 'QUESTION_VERSION', $1,
            'APPROVED', 'PUBLISHED', 4, 5,
            '["VERSION_STATUS","CURRENT_PUBLISHED_VERSION_ID"]'::jsonb,
            '{"kind":"NONE_V1"}'::jsonb
          ), $3, $4, 'TEST', $5
        )`,
        [
          firstFixture.versionId,
          operation.actorUserId,
          operation.operationId,
          postAuthorityPublicationRequestId,
          occurredAt
        ]
      )
      await finishInTest(client, [operation.operationId])
      await client.query('COMMIT')
    } catch (error: unknown) {
      await client.query('ROLLBACK')
      throw error
    }
    expect(postAuthorityPublicationOperationId).not.toBe('')
    expect(
      (
        await client.query<{
          auditCount: number
          counterpartLabel: string
          counterpartRole: string
          currentPublishedVersionId: string | null
          intentCount: number
          reviewerGeneration: number
          reviewerRole: string
          rowVersion: number
          status: string
        }>(
          `SELECT version."status"::text AS status, version."rowVersion",
             question."currentPublishedVersionId",
             reviewer."role"::text AS "reviewerRole",
             reviewer."authorityGeneration" AS "reviewerGeneration",
             published_review."counterpartRole"::text AS "counterpartRole",
             published_review."counterpartLabel"::text AS "counterpartLabel",
             (SELECT COUNT(*)::int FROM "AdminAuditLog"
              WHERE "operationId" = $4) AS "auditCount",
             (SELECT COUNT(*)::int FROM "OperationIntent"
              WHERE "operationId" = $4) AS "intentCount"
           FROM "QuestionVersion" AS version
           JOIN "Question" AS question ON question."id" = version."questionId"
           JOIN "User" AS reviewer ON reviewer."id" = $3
           JOIN "ContentReview" AS published_review
             ON published_review."questionVersionId" = version."id"
            AND published_review."action" = 'PUBLISHED'
           WHERE version."id" = $1 AND question."id" = $2`,
          [
            firstFixture.versionId,
            firstFixture.questionId,
            secondActorId,
            postAuthorityPublicationOperationId
          ]
        )
      ).rows
    ).toEqual([
      {
        auditCount: 1,
        counterpartLabel: 'ACTIVE_ADMIN',
        counterpartRole: 'ADMIN',
        currentPublishedVersionId: firstFixture.versionId,
        intentCount: 0,
        reviewerGeneration: 2,
        reviewerRole: 'USER',
        rowVersion: 5,
        status: 'PUBLISHED'
      }
    ])

    for (const actorId of [firstActorId, secondActorId]) {
      await withExecutionRole('nihongo_app', () =>
        bridgedQuery(client, `SELECT "phase7_erase_user"($1, 'TEST')`, [
          actorId
        ])
      )
    }
  }, 90_000)

  it('admin command별 isolation matrix와 실패 write 0을 고정한다', async () => {
    const sessionId = randomUUID()
    let sessionToken = `phase7-repeatable-read-${randomUUID()}`
    const requestIds: string[] = []
    await insertCredentialUser({ id: repeatableReadActorId, role: 'ADMIN' })
    await insertGoogleFixtureAccount(repeatableReadActorId)
    await expect(
      withExecutionRole('nihongo_app', () =>
        ownedSessionSql(
          client,
          `SELECT * FROM "phase7_issue_v1_session"(
            $1, 1, 'ADMIN', 'ACTIVE', $2, $3,
            '127.0.0.1', 'phase7-repeatable-read', false
          )`,
          [repeatableReadActorId, sessionId, sessionToken]
        )
      )
    ).resolves.toMatchObject({ rows: [{ id: sessionId }] })

    sessionToken = await completeAdminSsoFresh(
      repeatableReadActorId,
      sessionToken
    )

    const attemptBegin = async (
      isolation: 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE',
      command:
        | 'EXPORT'
        | 'IMPORT_APPLY'
        | 'PUBLICATION'
        | 'QUESTION_CREATE'
        | 'QUESTION_VERSION_CREATE'
        | 'QUESTION_VERSION_UPDATE'
        | 'REPORT_TRIAGE',
      succeeds: boolean
    ): Promise<void> => {
      const requestId = randomUUID()
      requestIds.push(requestId)
      await client.query(`BEGIN ISOLATION LEVEL ${isolation}`)
      try {
        await client.query(`SET LOCAL ROLE "nihongo_app"`)
        const operation = beginInTest(client, [
          command,
          sessionToken,
          requestId,
          [repeatableReadActorId]
        ])
        if (succeeds) {
          await expect(operation).resolves.toMatchObject({ rowCount: 1 })
        } else {
          await expect(operation).rejects.toMatchObject({ code: '25001' })
        }
      } finally {
        await client.query('ROLLBACK')
      }
    }
    await attemptBegin('READ COMMITTED', 'QUESTION_CREATE', false)
    await attemptBegin('REPEATABLE READ', 'QUESTION_CREATE', false)
    await attemptBegin('SERIALIZABLE', 'QUESTION_CREATE', true)
    await attemptBegin('READ COMMITTED', 'QUESTION_VERSION_CREATE', false)
    await attemptBegin('SERIALIZABLE', 'QUESTION_VERSION_CREATE', true)
    await attemptBegin('READ COMMITTED', 'QUESTION_VERSION_UPDATE', false)
    await attemptBegin('SERIALIZABLE', 'QUESTION_VERSION_UPDATE', true)
    await attemptBegin('READ COMMITTED', 'PUBLICATION', false)
    await attemptBegin('SERIALIZABLE', 'PUBLICATION', true)
    await attemptBegin('READ COMMITTED', 'IMPORT_APPLY', false)
    await attemptBegin('SERIALIZABLE', 'IMPORT_APPLY', true)
    await attemptBegin('READ COMMITTED', 'EXPORT', false)
    await attemptBegin('REPEATABLE READ', 'EXPORT', true)
    await attemptBegin('SERIALIZABLE', 'EXPORT', false)
    await attemptBegin('READ COMMITTED', 'REPORT_TRIAGE', true)
    await attemptBegin('REPEATABLE READ', 'REPORT_TRIAGE', false)
    await attemptBegin('SERIALIZABLE', 'REPORT_TRIAGE', false)

    const [firstSeed, secondSeed] = buildAllQuestionSeeds()
    const manifestTag = firstSeed?.tags[0]
    if (!firstSeed || !secondSeed || !manifestTag) {
      throw new Error('Target manifest fixtures are unavailable.')
    }
    const expectArmRejected = async (input: {
      code: string
      command: 'QUESTION_CREATE' | 'QUESTION_VERSION_UPDATE'
      manifest: AdminTargetManifest
    }): Promise<void> => {
      const requestId = randomUUID()
      requestIds.push(requestId)
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE')
      try {
        await client.query(`SET LOCAL ROLE "nihongo_app"`)
        const begun = await beginInTest(client, [
          input.command,
          sessionToken,
          requestId,
          [repeatableReadActorId]
        ])
        const operation = begun.rows[0]
        if (!operation) {
          throw new Error('Manifest-negative operation is unavailable.')
        }
        await expect(
          armInTest(
            client,
            {
              ...operation,
              command: input.command,
              referencedUserIds: [repeatableReadActorId]
            },
            input.manifest
          )
        ).rejects.toMatchObject({ code: input.code })
      } finally {
        await client.query('ROLLBACK')
      }
    }
    const closedEmptyManifest = {
      questions: [],
      reports: [],
      tags: [],
      versions: []
    } satisfies AdminTargetManifest
    const emptyReferenceRequestId = randomUUID()
    requestIds.push(emptyReferenceRequestId)
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE')
    try {
      await client.query(`SET LOCAL ROLE "nihongo_app"`)
      await expect(
        beginInTest(client, [
          'QUESTION_CREATE',
          sessionToken,
          emptyReferenceRequestId,
          []
        ])
      ).rejects.toMatchObject({ code: '22023' })
    } finally {
      await client.query('ROLLBACK')
    }
    // The API builds a typed manifest, so the malformed-JSON shape probes of
    // the former SQL arm are gone; count and duplicate rules stay below.
    await expectArmRejected({
      code: '22023',
      command: 'QUESTION_CREATE',
      manifest: closedEmptyManifest
    })
    await expectArmRejected({
      code: '22023',
      command: 'QUESTION_CREATE',
      manifest: {
        ...closedEmptyManifest,
        tags: [manifestTag.id, manifestTag.id]
      }
    })
    await expectArmRejected({
      code: '40001',
      command: 'QUESTION_VERSION_UPDATE',
      manifest: {
        questions: [
          { id: firstSeed.questionId, rowVersion: 2, state: 'ACTIVE' }
        ],
        reports: [],
        tags: [manifestTag.id],
        versions: [
          { id: firstSeed.versionId, rowVersion: 1, state: 'PUBLISHED' }
        ]
      }
    })
    await expectArmRejected({
      code: '40001',
      command: 'QUESTION_VERSION_UPDATE',
      manifest: {
        questions: [
          { id: firstSeed.questionId, rowVersion: 1, state: 'ARCHIVED' }
        ],
        reports: [],
        tags: [manifestTag.id],
        versions: [
          { id: firstSeed.versionId, rowVersion: 1, state: 'PUBLISHED' }
        ]
      }
    })
    await expectArmRejected({
      code: '40001',
      command: 'QUESTION_VERSION_UPDATE',
      manifest: {
        questions: [
          { id: firstSeed.questionId, rowVersion: 1, state: 'ACTIVE' }
        ],
        reports: [],
        tags: [manifestTag.id],
        versions: [
          { id: secondSeed.versionId, rowVersion: 1, state: 'PUBLISHED' }
        ]
      }
    })
    await expectArmRejected({
      code: '22023',
      command: 'QUESTION_VERSION_UPDATE',
      manifest: {
        questions: [
          { id: firstSeed.questionId, rowVersion: 1, state: 'ACTIVE' }
        ],
        reports: [],
        tags: [],
        versions: [
          { id: firstSeed.versionId, rowVersion: 1, state: 'PUBLISHED' },
          { id: firstSeed.versionId, rowVersion: 1, state: 'PUBLISHED' }
        ]
      }
    })

    const exportQuestionId = randomUUID()
    const exportVersionIds = Array.from({ length: 513 }, () => randomUUID())
    const exportRequestId = randomUUID()
    requestIds.push(exportRequestId)
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
    try {
      await client.query(`SET LOCAL session_replication_role = replica`)
      await client.query(
        `INSERT INTO "Question" (
          "id", "createdByLabelSnapshot", "createdAt", "updatedAt"
        ) VALUES ($1, 'SYSTEM_SEED', clock_timestamp(), clock_timestamp())`,
        [exportQuestionId]
      )
      await client.query(
        `INSERT INTO "QuestionVersion" (
          "id", "questionId", "versionNumber", "status", "level", "subject",
          "questionType", "questionText", "correctOptionId",
          "explanationKo", "difficulty", "contentFingerprint",
          "createdByLabelSnapshot", "retirementKind", "retiredAt",
          "createdAt", "updatedAt"
        )
        SELECT fixture.id, $1, fixture.ordinality::int,
          'RETIRED', 'N5', 'VOCABULARY', 'KANJI_READING',
          'Phase 7 513-version EXPORT ' || fixture.ordinality,
          '00000000-0000-0000-0000-000000000000'::uuid,
          '513-version export manifest fixture', 'EASY', repeat('0', 64),
          'SYSTEM_SEED', 'QUESTION_ARCHIVE_ABANDONED', clock_timestamp(),
          clock_timestamp(), clock_timestamp()
        FROM unnest($2::uuid[]) WITH ORDINALITY AS fixture(id, ordinality)`,
        [exportQuestionId, exportVersionIds]
      )
      await client.query(`SET LOCAL session_replication_role = origin`)
      await client.query(`SET LOCAL ROLE "nihongo_app"`)
      const begun = await beginInTest(client, [
        'EXPORT',
        sessionToken,
        exportRequestId,
        [repeatableReadActorId]
      ])
      const exportOperation = begun.rows[0]
      if (!exportOperation) {
        throw new Error('Phase 7 513-version EXPORT operation is unavailable.')
      }
      const exportManifest = {
        questions: [{ id: exportQuestionId, rowVersion: 1, state: 'ACTIVE' }],
        reports: [],
        tags: [],
        versions: exportVersionIds.map((id) => ({
          id,
          rowVersion: 1,
          state: 'RETIRED'
        }))
      } satisfies AdminTargetManifest
      await expect(
        armInTest(
          client,
          {
            ...exportOperation,
            command: 'EXPORT',
            referencedUserIds: [repeatableReadActorId]
          },
          exportManifest
        )
      ).resolves.toBeInstanceOf(Date)
      // The API arm keeps the manifest in memory; the intent row no longer
      // stores it (#504 P4).
    } finally {
      await client.query('ROLLBACK')
    }

    const importTagIds = Array.from({ length: 257 }, () => randomUUID())
    const importRequestId = randomUUID()
    requestIds.push(importRequestId)
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE')
    try {
      await client.query(
        `INSERT INTO "Tag" (
          "id", "label", "normalizedName", "createdAt", "updatedAt"
        )
        SELECT fixture.id,
          'Import Tag ' || fixture.ordinality,
          'phase7-import-' || replace(fixture.id::text, '-', ''),
          clock_timestamp(), clock_timestamp()
        FROM unnest($1::uuid[]) WITH ORDINALITY AS fixture(id, ordinality)`,
        [importTagIds]
      )
      await client.query(`SET LOCAL ROLE "nihongo_app"`)
      const begun = await beginInTest(client, [
        'IMPORT_APPLY',
        sessionToken,
        importRequestId,
        [repeatableReadActorId]
      ])
      const importOperation = begun.rows[0]
      if (!importOperation) {
        throw new Error('Phase 7 257-Tag IMPORT operation is unavailable.')
      }
      await expect(
        armInTest(
          client,
          {
            ...importOperation,
            command: 'IMPORT_APPLY',
            referencedUserIds: [repeatableReadActorId]
          },
          {
            questions: [],
            reports: [],
            tags: importTagIds.toSorted(),
            versions: []
          }
        )
      ).resolves.toBeInstanceOf(Date)
    } finally {
      await client.query('ROLLBACK')
    }
    expect(
      (
        await client.query<{ auditCount: number; intentCount: number }>(
          `SELECT
             (SELECT COUNT(*)::int FROM "OperationIntent"
              WHERE "requestId" = ANY($1::uuid[])) AS "intentCount",
             (SELECT COUNT(*)::int FROM "AdminAuditLog"
              WHERE "requestId" = ANY($1::uuid[])) AS "auditCount"`,
          [requestIds]
        )
      ).rows
    ).toEqual([{ auditCount: 0, intentCount: 0 }])
    await expect(
      withExecutionRole('nihongo_app', () =>
        bridgedQuery(
          client,
          `SELECT "phase7_erase_user"($1, 'TEST') AS erased`,
          [repeatableReadActorId]
        )
      )
    ).resolves.toMatchObject({ rows: [{ erased: true }] })
  })

  it('owned ADMIN create/auth와 author erasure를 atomic evidence/tombstone으로 보존한다', async () => {
    const actorId = randomUUID()
    const questionId = randomUUID()
    const versionId = randomUUID()
    const optionIds = Array.from({ length: 4 }, () => randomUUID())
    const sessionId = randomUUID()
    const sessionToken = `phase7-session-${randomUUID()}`
    let operationSessionId: string = randomUUID()
    let operationSessionToken = `phase7-operation-${randomUUID()}`
    const wrongAuthorId = randomUUID()
    const wrongAuthorSessionId = randomUUID()
    const wrongAuthorSessionToken = `phase7-wrong-author-${randomUUID()}`
    const spoofSessionId = randomUUID()
    const spoofSessionToken = `phase7-spoof-${randomUUID()}`
    const wrongRoleSessionId = randomUUID()
    const wrongRoleSessionToken = `phase7-wrong-role-${randomUUID()}`
    await insertCredentialUser({ id: actorId, role: 'ADMIN' })
    await insertGoogleFixtureAccount(actorId)
    await insertCredentialUser({ id: wrongAuthorId, role: 'ADMIN' })

    await expectFailedTransaction(async () => {
      await client.query(`SET LOCAL app.phase7_auth_issue = 'on'`)
      await client.query(`SET LOCAL app.phase7_auth_remember = 'true'`)
      await client.query(
        `INSERT INTO "Session" (
            "id", "expiresAt", "token", "createdAt", "updatedAt",
            "userId", "authorityGeneration", "issuerProtocolVersion"
          ) VALUES (
            $1, clock_timestamp() + INTERVAL '1 day', $2,
            clock_timestamp(), clock_timestamp(), $3, 1, 'PHASE7_V1'
          )`,
        [spoofSessionId, spoofSessionToken, actorId]
      )
    }, '42501')
    expect(
      (
        await client.query<{
          sessionCount: number
          trustedExecutionCount: number
        }>(
          `SELECT
            (SELECT COUNT(*)::int FROM "Session"
              WHERE "id" = $1 OR "token" = $2) AS "sessionCount",
            0 /* #504 P7 PR5b dropped Phase7TrustedExecution */
              AS "trustedExecutionCount"`,
          [spoofSessionId, spoofSessionToken]
        )
      ).rows
    ).toEqual([{ sessionCount: 0, trustedExecutionCount: 0 }])
    expect(
      (
        await client.query<{ sessionCount: number }>(
          `SELECT COUNT(*)::int AS "sessionCount" FROM "Session"
           WHERE "id" = $1 OR "token" = $2`,
          [wrongRoleSessionId, wrongRoleSessionToken]
        )
      ).rows
    ).toEqual([{ sessionCount: 0 }])

    const issued = await withExecutionRole('nihongo_app', () =>
      ownedSessionSql(
        client,
        `SELECT * FROM "phase7_issue_v1_session"(
          $1, 1, 'ADMIN', 'ACTIVE', $2, $3, $4, $5, true
        )`,
        [actorId, sessionId, sessionToken, '127.0.0.1', 'phase7-integration']
      )
    )
    expect(issued.rows).toHaveLength(1)
    expect(issued.rows[0]).toMatchObject({
      authorityGeneration: 1,
      id: sessionId
    })
    expect(
      issued.rows[0]!.expiresAt.getTime() - issued.rows[0]!.createdAt.getTime()
    ).toBe(7 * 24 * 60 * 60 * 1_000)
    await expect(
      withExecutionRole('nihongo_app', () =>
        ownedSessionSql(
          client,
          `SELECT "phase7_owned_sign_out"($1) AS signed_out`,
          [sessionToken]
        )
      )
    ).resolves.toMatchObject({ rows: [{ signed_out: true }] })

    const afterSignOut = await client.query<{ sessionCount: number }>(
      `SELECT COUNT(*)::int AS "sessionCount" FROM "Session" WHERE "id" = $1`,
      [sessionId]
    )
    expect(afterSignOut.rows).toEqual([{ sessionCount: 0 }])
    const operationSession = await withExecutionRole('nihongo_app', () =>
      ownedSessionSql(
        client,
        `SELECT * FROM "phase7_issue_v1_session"(
            $1, 1, 'ADMIN', 'ACTIVE', $2, $3,
            '127.0.0.1', 'phase7-operation', false
          )`,
        [actorId, operationSessionId, operationSessionToken]
      )
    )
    expect(operationSession.rows).toMatchObject([
      { authorityGeneration: 1, id: operationSessionId }
    ])
    await expect(
      withExecutionRole('nihongo_app', () =>
        ownedSessionSql(
          client,
          `SELECT * FROM "phase7_issue_v1_session"(
            $1, 1, 'ADMIN', 'ACTIVE', $2, $3,
            '127.0.0.1', 'phase7-wrong-author', false
          )`,
          [wrongAuthorId, wrongAuthorSessionId, wrongAuthorSessionToken]
        )
      )
    ).resolves.toMatchObject({
      rows: [{ authorityGeneration: 1, id: wrongAuthorSessionId }]
    })

    const tag = await client.query<{
      id: string
      label: string
      normalizedName: string
    }>(
      `SELECT tag."id", tag."label", tag."normalizedName"
       FROM "Tag" AS tag
       JOIN "TagApplicability" AS applicability
         ON applicability."tagId" = tag."id"
       WHERE applicability."level" = 'N5'
         AND applicability."subject" = 'VOCABULARY'
         AND applicability."questionType" = 'KANJI_READING'
       ORDER BY tag."id"
       LIMIT 1`
    )
    const selectedTag = tag.rows[0]
    if (!selectedTag || optionIds.some((id) => !id)) {
      throw new Error('Authored question fixture is unavailable.')
    }

    await client.query('BEGIN')
    try {
      await client.query(`SET LOCAL ROLE "nihongo_app"`)
      const requestId = randomUUID()
      const operationRow = await beginAdminOperation(client, {
        command: 'QUESTION_CREATE',
        referencedUserIds: [actorId],
        requestId,
        sessionToken: operationSessionToken,
        targetManifest: {
          questions: [],
          reports: [],
          tags: [selectedTag.id],
          versions: []
        }
      })
      expect(operationRow.actorUserId).toBe(actorId)

      await client.query(
        `INSERT INTO "Question" (
          "id", "createdByUserId", "createdByActorId",
          "createdByRoleSnapshot", "createdByLabelSnapshot",
          "createdAt", "updatedAt"
        ) VALUES ($1, $2, $2, 'ADMIN', 'ACTIVE_ADMIN',
          $3, $3)`,
        [questionId, actorId, operationRow.occurredAt]
      )
      await client.query(
        `INSERT INTO "QuestionVersion" (
          "id", "questionId", "versionNumber", "level", "subject",
          "questionType", "questionText", "correctOptionId",
          "explanationKo", "difficulty", "contentFingerprint",
          "createdByUserId", "createdByActorId", "createdByRoleSnapshot",
          "createdByLabelSnapshot", "createdAt", "updatedAt"
        ) VALUES (
          $1, $2, 1, 'N5', 'VOCABULARY', 'KANJI_READING', $3, $4,
          'author erasure candidate 검증', 'EASY', repeat('0', 64),
          $5, $5, 'ADMIN', 'ACTIVE_ADMIN', $6, $6
        )`,
        [
          versionId,
          questionId,
          `Authored ${questionId}`,
          optionIds[0],
          actorId,
          operationRow.occurredAt
        ]
      )
      for (const [index, optionId] of optionIds.entries()) {
        await client.query(
          `INSERT INTO "QuestionOption" (
            "id", "questionVersionId", "label", "text", "ordinal"
          ) VALUES ($1, $2, $3, $4, $5)`,
          [
            optionId,
            versionId,
            String(index + 1),
            `Authored option ${index + 1} ${questionId}`,
            index + 1
          ]
        )
      }
      await client.query(
        `INSERT INTO "QuestionVersionTag" (
          "id", "questionVersionId", "tagId", "labelSnapshot",
          "normalizedNameSnapshot"
        ) VALUES ($1, $2, $3, $4, $5)`,
        [
          randomUUID(),
          versionId,
          selectedTag.id,
          selectedTag.label,
          selectedTag.normalizedName
        ]
      )
      await client.query(
        `INSERT INTO "AdminAuditLog" (
          "command", "targetType", "targetId", "actorKind",
          "actorUserId", "actorId", "actorRole", "actorLabel",
          "beforeState", "afterState", "beforeRowVersion",
          "afterRowVersion", "changedFields", "metadata", "contentDigest",
          "operationId", "requestId", "environment", "occurredAt"
        ) VALUES (
          'QUESTION_CREATE', 'QUESTION', $1, 'ACCOUNT', $2, $2, 'ADMIN',
          'ACTIVE_ADMIN', NULL, 'ACTIVE', NULL, 1, $3::jsonb,
          '{"kind":"NONE_V1"}'::jsonb,
          pg_temp."phase7_admin_audit_content_digest"(
            $4, 'QUESTION_CREATE', 'QUESTION', $1, NULL, 'ACTIVE',
            NULL, 1, $3::jsonb, '{"kind":"NONE_V1"}'::jsonb
          ), $4, $5,
          'TEST', $6
        )`,
        [
          questionId,
          actorId,
          JSON.stringify(EXPECTED_CHANGED_FIELDS),
          operationRow.operationId,
          requestId,
          operationRow.occurredAt
        ]
      )
      await finishInTest(client, [operationRow.operationId])
      await client.query('COMMIT')
    } catch (error: unknown) {
      await client.query('ROLLBACK')
      throw error
    }

    // Author and update-timestamp checks moved to the API (#504 P4).

    const previousOperationSessionId = operationSessionId
    operationSessionToken = await completeAdminSsoFresh(
      actorId,
      operationSessionToken
    )
    const replacementSession = await client.query<{ id: string }>(
      `SELECT "id" FROM "Session" WHERE "token" = $1 AND "userId" = $2`,
      [operationSessionToken, actorId]
    )
    expect(replacementSession.rows).toHaveLength(1)
    operationSessionId = replacementSession.rows[0]!.id
    expect(operationSessionId).not.toBe(previousOperationSessionId)

    const legacySeed = buildAllQuestionSeeds()[0]
    if (!legacySeed)
      throw new Error('Legacy retirement fixture is unavailable.')
    // The API writes the retirement reason; the DB evidence check is gone (#504 P4).

    const missingCapabilityReportId = randomUUID()
    await expectFailedTransaction(async () => {
      await client.query(`SET LOCAL ROLE "nihongo_migration"`)
      await client.query(`DELETE FROM "DatabaseCapability"`)
      await client.query(`RESET ROLE`)
      await client.query(`SET LOCAL ROLE "nihongo_app"`)
      await bridgedQuery(
        client,
        `SELECT * FROM "phase7_create_question_report"(
          $1, $2, $3, $4, 'TYPO_OR_GRAMMAR', $5
        )`,
        [
          operationSessionToken,
          missingCapabilityReportId,
          legacySeed.questionId,
          legacySeed.versionId,
          'Capability-negative report'
        ]
      )
    }, '42501')
    expect(
      (
        await client.query<{ count: number }>(
          `SELECT COUNT(*)::int AS count
           FROM "QuestionReport" WHERE "id" = $1`,
          [missingCapabilityReportId]
        )
      ).rows
    ).toEqual([{ count: 0 }])

    const reportId = randomUUID()
    await expect(
      withExecutionRole('nihongo_app', () =>
        bridgedQuery(
          client,
          `SELECT * FROM "phase7_create_question_report"(
            $1, $2, $3, $4, 'TYPO_OR_GRAMMAR', $5
          )`,
          [
            operationSessionToken,
            reportId,
            legacySeed.questionId,
            legacySeed.versionId,
            'Owned report'
          ]
        )
      )
    ).resolves.toMatchObject({ rows: [{ id: reportId, rowVersion: 1 }] })

    const delayedReportSessionId = randomUUID()
    const delayedReportSessionToken = `phase7-delayed-report-${randomUUID()}`
    const delayedReportId = randomUUID()
    await expect(
      withExecutionRole('nihongo_app', () =>
        ownedSessionSql(
          client,
          `SELECT * FROM "phase7_issue_v1_session"(
            $1, 1, 'ADMIN', 'ACTIVE', $2, $3,
            '127.0.0.1', 'phase7-delayed-report', false
          )`,
          [wrongAuthorId, delayedReportSessionId, delayedReportSessionToken]
        )
      )
    ).resolves.toMatchObject({ rows: [{ id: delayedReportSessionId }] })
    await client.query(`SET session_replication_role = replica`)
    try {
      await client.query(
        `UPDATE "Session"
         SET "expiresAt" = clock_timestamp() + INTERVAL '400 milliseconds'
         WHERE "id" = $1`,
        [delayedReportSessionId]
      )
    } finally {
      await client.query(`SET session_replication_role = origin`)
    }

    const delayedClient = new Client({
      connectionString: connectionUrl.toString(),
      options: createPostgresStartupOptions(schema)
    })
    let delayedTransactionOpen = false
    let delayedReportPromise: Promise<unknown> | undefined
    await delayedClient.connect()
    await installAuditDigestSql(delayedClient)
    try {
      const delayedBackend = await delayedClient.query<{ pid: number }>(
        `SELECT pg_backend_pid() AS pid`
      )
      const delayedBackendPid = delayedBackend.rows[0]?.pid
      if (!delayedBackendPid) {
        throw new Error('Delayed report backend PID is unavailable.')
      }
      await client.query('BEGIN')
      delayedTransactionOpen = true
      await client.query(`SELECT 1 FROM "User" WHERE "id" = $1 FOR UPDATE`, [
        wrongAuthorId
      ])
      await delayedClient.query(`SET ROLE "nihongo_app"`)
      delayedReportPromise = bridgedQuery(
        delayedClient,
        `SELECT * FROM "phase7_create_question_report"(
          $1, $2, $3, $4, 'TYPO_OR_GRAMMAR', $5
        )`,
        [
          delayedReportSessionToken,
          delayedReportId,
          legacySeed.questionId,
          legacySeed.versionId,
          'Delayed-lock report'
        ]
      )
      let lockObserved = false
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const activity = await client.query<{ waitEventType: string | null }>(
          `SELECT wait_event_type AS "waitEventType"
           FROM pg_stat_activity WHERE pid = $1`,
          [delayedBackendPid]
        )
        if (activity.rows[0]?.waitEventType === 'Lock') {
          lockObserved = true
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(lockObserved).toBe(true)
      await client.query(`SELECT pg_sleep(0.7)`)
      await client.query('COMMIT')
      delayedTransactionOpen = false
      await expect(delayedReportPromise).rejects.toMatchObject({
        code: '42501'
      })
    } finally {
      if (delayedTransactionOpen) await client.query('ROLLBACK')
      await delayedReportPromise?.catch(() => undefined)
      await delayedClient.query('RESET ROLE').catch(() => undefined)
      await delayedClient.end()
    }
    expect(
      (
        await client.query<{
          reportCount: number
          trustedExecutionCount: number
        }>(
          `SELECT
            (SELECT COUNT(*)::int FROM "QuestionReport" WHERE "id" = $1)
              AS "reportCount",
            0 /* #504 P7 PR5b dropped Phase7TrustedExecution */
              AS "trustedExecutionCount"`,
          [delayedReportId]
        )
      ).rows
    ).toEqual([{ reportCount: 0, trustedExecutionCount: 0 }])

    await expect(
      withExecutionRole('nihongo_app', () =>
        bridgedQuery(
          client,
          `SELECT "phase7_erase_user"($1, 'TEST') AS erased`,
          [wrongAuthorId]
        )
      )
    ).resolves.toMatchObject({ rows: [{ erased: true }] })

    // A raw creator rewrite under a spoofed erasure flag was refused by the
    // dropped QuestionVersion trigger; the API never writes it (#504 P4).

    await expectFailedTransaction(async () => {
      await client.query(`SET LOCAL app.phase7_erasure_mode = 'on'`)
      await client.query('DELETE FROM "User" WHERE "id" = $1', [actorId])
    }, '42501')
    // #504 P7 PR4a: a role other than nihongo_app cannot write the erasure
    // tombstones; the evidence trigger refuses the first one.
    await expect(
      bridgedQuery(client, `SELECT "phase7_erase_user"($1, 'TEST')`, [actorId])
    ).rejects.toMatchObject({ code: '23514' })
    expect(
      (
        await client.query<{
          operationIntentCount: number
          trustedExecutionCount: number
          userCount: number
        }>(
          `SELECT
            (SELECT COUNT(*)::int FROM "User" WHERE "id" = $1)
              AS "userCount",
            (SELECT COUNT(*)::int FROM "OperationIntent")
              AS "operationIntentCount",
            0 /* #504 P7 PR5b dropped Phase7TrustedExecution */
              AS "trustedExecutionCount"`,
          [actorId]
        )
      ).rows
    ).toEqual([
      { operationIntentCount: 0, trustedExecutionCount: 0, userCount: 1 }
    ])
    await expect(
      withExecutionRole('nihongo_app', () =>
        bridgedQuery(
          client,
          `SELECT "phase7_erase_user"($1, 'TEST') AS erased`,
          [actorId]
        )
      )
    ).resolves.toMatchObject({ rows: [{ erased: true }] })
    const erased = await client.query<{
      auditCount: number
      operationIntentCount: number
      questionActorId: string
      questionLabel: string
      questionRowVersion: number
      reviewCount: number
      retirementKind: string
      trustedExecutionCount: number
      userCount: number
      versionActorId: string
      versionLabel: string
      versionRowVersion: number
      versionStatus: string
    }>(
      `SELECT
        question."createdByActorId"::text AS "questionActorId",
        question."createdByLabelSnapshot"::text AS "questionLabel",
        question."rowVersion" AS "questionRowVersion",
        version."createdByActorId"::text AS "versionActorId",
        version."createdByLabelSnapshot"::text AS "versionLabel",
        version."rowVersion" AS "versionRowVersion",
        version."status"::text AS "versionStatus",
        version."retirementKind"::text AS "retirementKind",
        (SELECT COUNT(*)::int FROM "User" WHERE "id" = $1) AS "userCount",
        (SELECT COUNT(*)::int FROM "OperationIntent")
          AS "operationIntentCount",
        0 /* #504 P7 PR5b dropped Phase7TrustedExecution */
          AS "trustedExecutionCount",
        (SELECT COUNT(*)::int FROM "ContentReview"
          WHERE "questionVersionId" = $3
            AND "action" = 'AUTHOR_ERASURE_ABANDONED') AS "reviewCount",
        (SELECT COUNT(*)::int FROM "AdminAuditLog"
          WHERE "command" = 'AUTHOR_ERASURE_ABANDON'
            AND "operationId" IN (
              SELECT "operationId" FROM "ContentReview"
              WHERE "questionVersionId" = $3
                AND "action" = 'AUTHOR_ERASURE_ABANDONED'
            )) AS "auditCount"
       FROM "Question" AS question
       JOIN "QuestionVersion" AS version ON version."questionId" = question."id"
       WHERE question."id" = $2 AND version."id" = $3`,
      [actorId, questionId, versionId]
    )
    expect(erased.rows).toEqual([
      {
        auditCount: 2,
        operationIntentCount: 0,
        questionActorId: actorId,
        questionLabel: 'DELETED_ADMIN',
        questionRowVersion: 2,
        retirementKind: 'AUTHOR_ERASURE_ABANDONED',
        reviewCount: 1,
        trustedExecutionCount: 0,
        userCount: 0,
        versionActorId: actorId,
        versionLabel: 'DELETED_ADMIN',
        versionRowVersion: 2,
        versionStatus: 'RETIRED'
      }
    ])
    expect(
      (
        await client.query<{
          description: string | null
          reporterLabel: string
          reporterUserId: string | null
          rowVersion: number
        }>(
          `SELECT "reporterUserId"::text AS "reporterUserId",
             "reporterLabel"::text AS "reporterLabel", "description",
             "rowVersion"
           FROM "QuestionReport" WHERE "id" = $1`,
          [reportId]
        )
      ).rows
    ).toEqual([
      {
        description: null,
        reporterLabel: 'DELETED_ADMIN',
        reporterUserId: null,
        rowVersion: 2
      }
    ])

    await expect(
      client.query(
        'DELETE FROM "ContentReview" WHERE "questionVersionId" = $1',
        [versionId]
      )
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('QuestionReport triage는 self-assignee만 허용하고 erasure 경합을 교착 없이 직렬화한다', async () => {
    const actorId = randomUUID()
    const injectedAssigneeId = randomUUID()
    const sessionId = randomUUID()
    let sessionToken = `phase7-report-triage-${randomUUID()}`
    const reportId = randomUUID()
    const seed = buildAllQuestionSeeds()[0]
    if (!seed) throw new Error('Report triage target is unavailable.')
    await insertCredentialUser({ id: actorId, role: 'ADMIN' })
    await insertGoogleFixtureAccount(actorId)
    await insertCredentialUser({ id: injectedAssigneeId, role: 'ADMIN' })
    await withExecutionRole('nihongo_app', () =>
      ownedSessionSql(
        client,
        `SELECT * FROM "phase7_issue_v1_session"(
          $1, 1, 'ADMIN', 'ACTIVE', $2, $3,
          '127.0.0.1', 'phase7-report-triage', false
        )`,
        [actorId, sessionId, sessionToken]
      )
    )
    await withExecutionRole('nihongo_app', () =>
      bridgedQuery(
        client,
        `SELECT * FROM "phase7_create_question_report"(
          $1, $2, $3, $4, 'ANSWER_ERROR', $5
        )`,
        [
          sessionToken,
          reportId,
          seed.questionId,
          seed.versionId,
          'Self-triage integration report'
        ]
      )
    )

    const erasureClient = new Client({
      connectionString: connectionUrl.toString(),
      options: createPostgresStartupOptions(schema)
    })
    let triageTransactionOpen = false
    let erasurePromise: Promise<unknown> | undefined
    await erasureClient.connect()
    try {
      const erasureBackend = await erasureClient.query<{ pid: number }>(
        `SELECT pg_backend_pid() AS pid`
      )
      const erasureBackendPid = erasureBackend.rows[0]?.pid
      if (!erasureBackendPid) {
        throw new Error('Report erasure backend is unavailable.')
      }
      await erasureClient.query(`SET ROLE "nihongo_app"`)

      await client.query('BEGIN')
      triageTransactionOpen = true
      await client.query(`SET LOCAL ROLE "nihongo_app"`)
      const requestId = randomUUID()
      const begun = await beginInTest(client, [
        'REPORT_TRIAGE',
        sessionToken,
        requestId,
        [actorId, injectedAssigneeId].toSorted()
      ])
      const triageOperation = begun.rows[0]
      if (!triageOperation) {
        throw new Error('Injected-assignee operation is unavailable.')
      }
      erasurePromise = bridgedQuery(
        erasureClient,
        `SELECT "phase7_erase_user"($1, 'TEST') AS erased`,
        [injectedAssigneeId]
      )
      void erasurePromise.catch(() => undefined)
      await client.query('RESET ROLE')
      let lockObserved = false
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const activity = await client.query<{ waitEventType: string | null }>(
          `SELECT wait_event_type AS "waitEventType"
           FROM pg_stat_activity WHERE pid = $1`,
          [erasureBackendPid]
        )
        if (activity.rows[0]?.waitEventType === 'Lock') {
          lockObserved = true
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(lockObserved).toBe(true)
      await client.query(`SET LOCAL ROLE "nihongo_app"`)
      await expect(
        armInTest(
          client,
          {
            ...triageOperation,
            command: 'REPORT_TRIAGE',
            referencedUserIds: [actorId, injectedAssigneeId].toSorted()
          },
          {
            questions: [
              { id: seed.questionId, rowVersion: 1, state: 'ACTIVE' }
            ],
            reports: [{ id: reportId, rowVersion: 1, state: 'OPEN' }],
            tags: [],
            versions: [
              { id: seed.versionId, rowVersion: 1, state: 'PUBLISHED' }
            ]
          }
        )
      ).rejects.toMatchObject({ code: '42501' })
      await client.query('ROLLBACK')
      triageTransactionOpen = false
      await expect(erasurePromise).resolves.toMatchObject({
        rows: [{ erased: true }]
      })
      erasurePromise = undefined
    } finally {
      if (triageTransactionOpen) await client.query('ROLLBACK')
      await erasurePromise?.catch(() => undefined)
      await erasureClient.query('RESET ROLE').catch(() => undefined)
      await erasureClient.end()
    }
    expect(
      (
        await client.query<{
          auditCount: number
          status: string
          userCount: number
        }>(
          `SELECT report."status"::text AS status,
             (SELECT COUNT(*)::int FROM "User" WHERE "id" = $2)
               AS "userCount",
             (SELECT COUNT(*)::int FROM "AdminAuditLog"
              WHERE "targetId" = $1 AND "command" = 'REPORT_TRIAGE')
               AS "auditCount"
           FROM "QuestionReport" AS report WHERE report."id" = $1`,
          [reportId, injectedAssigneeId]
        )
      ).rows
    ).toEqual([{ auditCount: 0, status: 'OPEN', userCount: 0 }])

    await client.query('BEGIN')
    try {
      await client.query(`SET LOCAL ROLE "nihongo_app"`)
      const requestId = randomUUID()
      const operation = await beginAdminOperation(client, {
        command: 'REPORT_TRIAGE',
        referencedUserIds: [actorId],
        requestId,
        sessionToken,
        targetManifest: {
          questions: [{ id: seed.questionId, rowVersion: 1, state: 'ACTIVE' }],
          reports: [{ id: reportId, rowVersion: 1, state: 'OPEN' }],
          tags: [],
          versions: [{ id: seed.versionId, rowVersion: 1, state: 'PUBLISHED' }]
        }
      })
      await client.query(
        `UPDATE "QuestionReport"
         SET "status" = 'TRIAGED', "assigneeUserId" = $2,
             "assigneeActorId" = $2, "assigneeRole" = 'ADMIN',
             "assigneeLabel" = 'ACTIVE_ADMIN',
             "rowVersion" = "rowVersion" + 1, "updatedAt" = $3
         WHERE "id" = $1`,
        [reportId, actorId, operation.occurredAt]
      )
      await client.query(
        `INSERT INTO "AdminAuditLog" (
          "command", "targetType", "targetId", "actorKind",
          "actorUserId", "actorId", "actorRole", "actorLabel",
          "beforeState", "afterState", "beforeRowVersion",
          "afterRowVersion", "changedFields", "metadata", "contentDigest",
          "operationId", "requestId", "environment", "occurredAt"
        ) VALUES (
          'REPORT_TRIAGE', 'QUESTION_REPORT', $1, 'ACCOUNT',
          $2, $2, 'ADMIN', 'ACTIVE_ADMIN', 'OPEN', 'TRIAGED', 1, 2,
          '["ASSIGNEE","REPORT_STATUS"]'::jsonb,
          '{"kind":"NONE_V1"}'::jsonb,
          pg_temp."phase7_admin_audit_content_digest"(
            $3, 'REPORT_TRIAGE', 'QUESTION_REPORT', $1,
            'OPEN', 'TRIAGED', 1, 2,
            '["ASSIGNEE","REPORT_STATUS"]'::jsonb,
            '{"kind":"NONE_V1"}'::jsonb
          ), $3, $4, 'TEST', $5
        )`,
        [
          reportId,
          actorId,
          operation.operationId,
          requestId,
          operation.occurredAt
        ]
      )
      await finishInTest(client, [operation.operationId])
      await client.query('COMMIT')
    } catch (error: unknown) {
      await client.query('ROLLBACK')
      throw error
    }
    expect(
      (
        await client.query<{
          assigneeUserId: string
          auditCount: number
          rowVersion: number
          status: string
        }>(
          `SELECT "status"::text AS status, "assigneeUserId"::text
             AS "assigneeUserId", "rowVersion",
             (SELECT COUNT(*)::int FROM "AdminAuditLog"
              WHERE "targetId" = $1 AND "command" = 'REPORT_TRIAGE')
               AS "auditCount"
           FROM "QuestionReport" WHERE "id" = $1`,
          [reportId]
        )
      ).rows
    ).toEqual([
      {
        assigneeUserId: actorId,
        auditCount: 1,
        rowVersion: 2,
        status: 'TRIAGED'
      }
    ])
    sessionToken = await completeAdminSsoFresh(actorId, sessionToken)
    const resolutionRequestId = randomUUID()
    await client.query('BEGIN')
    try {
      await client.query(`SET LOCAL ROLE "nihongo_app"`)
      const operation = await beginAdminOperation(client, {
        command: 'REPORT_RESOLUTION',
        referencedUserIds: [actorId],
        requestId: resolutionRequestId,
        sessionToken,
        targetManifest: {
          questions: [{ id: seed.questionId, rowVersion: 1, state: 'ACTIVE' }],
          reports: [{ id: reportId, rowVersion: 2, state: 'TRIAGED' }],
          tags: [],
          versions: [{ id: seed.versionId, rowVersion: 1, state: 'PUBLISHED' }]
        }
      })
      await client.query(
        `UPDATE "QuestionReport"
         SET "status" = 'RESOLVED', "resolutionOutcome" = 'RESOLVED',
             "resolutionReason" = 'ANSWER_CORRECTED',
             "resolvedAt" = $2, "rowVersion" = 3, "updatedAt" = $2
         WHERE "id" = $1`,
        [reportId, operation.occurredAt]
      )
      await client.query(
        `INSERT INTO "AdminAuditLog" (
          "command", "targetType", "targetId", "actorKind",
          "actorUserId", "actorId", "actorRole", "actorLabel",
          "beforeState", "afterState", "beforeRowVersion",
          "afterRowVersion", "changedFields", "metadata", "contentDigest",
          "operationId", "requestId", "environment", "occurredAt"
        ) VALUES (
          'REPORT_RESOLUTION', 'QUESTION_REPORT', $1, 'ACCOUNT',
          $2, $2, 'ADMIN', 'ACTIVE_ADMIN', 'TRIAGED', 'RESOLVED', 2, 3,
          '["RESOLUTION","REPORT_STATUS"]'::jsonb,
          '{"kind":"NONE_V1"}'::jsonb,
          pg_temp."phase7_admin_audit_content_digest"(
            $3, 'REPORT_RESOLUTION', 'QUESTION_REPORT', $1,
            'TRIAGED', 'RESOLVED', 2, 3,
            '["RESOLUTION","REPORT_STATUS"]'::jsonb,
            '{"kind":"NONE_V1"}'::jsonb
          ), $3, $4, 'TEST', $5
        )`,
        [
          reportId,
          actorId,
          operation.operationId,
          resolutionRequestId,
          operation.occurredAt
        ]
      )
      await finishInTest(client, [operation.operationId])
      await client.query('COMMIT')
    } catch (error: unknown) {
      await client.query('ROLLBACK')
      throw error
    }
    expect(
      (
        await client.query<{
          assigneeActorId: string
          assigneeUserId: string
          auditCount: number
          resolutionOutcome: string
          resolutionReason: string
          rowVersion: number
          status: string
        }>(
          `SELECT "status"::text, "assigneeUserId"::text,
             "assigneeActorId"::text, "resolutionOutcome"::text,
             "resolutionReason", "rowVersion",
             (SELECT COUNT(*)::int FROM "AdminAuditLog"
              WHERE "targetId" = $1 AND "command" = 'REPORT_RESOLUTION')
               AS "auditCount"
           FROM "QuestionReport" WHERE "id" = $1`,
          [reportId]
        )
      ).rows
    ).toEqual([
      {
        assigneeActorId: actorId,
        assigneeUserId: actorId,
        auditCount: 1,
        resolutionOutcome: 'RESOLVED',
        resolutionReason: 'ANSWER_CORRECTED',
        rowVersion: 3,
        status: 'RESOLVED'
      }
    ])
    await withExecutionRole('nihongo_app', () =>
      bridgedQuery(client, `SELECT "phase7_erase_user"($1, 'TEST')`, [actorId])
    )
  }, 60_000)

  it('180일 경과 terminal report description만 bounded worker facade로 redaction한다', async () => {
    const actorId = randomUUID()
    const sessionId = randomUUID()
    const sessionToken = `phase7-report-redaction-${randomUUID()}`
    const matureReportId = randomUUID()
    const prematureReportId = randomUUID()
    const openReportId = randomUUID()
    const remediationVersionId = randomUUID()
    const remediationOptionIds = Array.from({ length: 4 }, () => randomUUID())
    const seed = buildAllQuestionSeeds()[0]
    const remediationTag = seed?.tags[0]
    if (!seed || !remediationTag || !remediationOptionIds[0])
      throw new Error('Report redaction target is unavailable.')
    await client.query(`SET session_replication_role = replica`)
    try {
      await client.query(
        `INSERT INTO "QuestionVersion" (
          "id", "questionId", "versionNumber", "status", "level", "subject",
          "questionType", "questionText", "correctOptionId",
          "explanationKo", "difficulty", "sourceType", "rowVersion",
          "createdByLabelSnapshot", "retirementKind", "contentFingerprint",
          "createdAt", "updatedAt", "publishedAt", "retiredAt"
        ) VALUES (
          $1, $2, 2, 'RETIRED', $3, $4, $5, $6, $7,
          'report remediation lineage fixture', $8, 'ORIGINAL', 2,
          'SYSTEM_SEED', 'PUBLISHED_RETIREMENT', repeat('0', 64),
          clock_timestamp() - INTERVAL '300 days',
          clock_timestamp() - INTERVAL '250 days',
          clock_timestamp() - INTERVAL '290 days',
          clock_timestamp() - INTERVAL '250 days'
        )`,
        [
          remediationVersionId,
          seed.questionId,
          seed.level,
          seed.subject,
          seed.questionType,
          `Remediation v2 ${remediationVersionId}`,
          remediationOptionIds[0],
          seed.difficulty
        ]
      )
      for (const [index, optionId] of remediationOptionIds.entries()) {
        await client.query(
          `INSERT INTO "QuestionOption" (
            "id", "questionVersionId", "label", "text", "ordinal"
          ) VALUES ($1, $2, $3, $4, $5)`,
          [
            optionId,
            remediationVersionId,
            String(index + 1),
            `Remediation option ${index + 1}`,
            index + 1
          ]
        )
      }
      await client.query(
        `INSERT INTO "QuestionVersionTag" (
          "id", "questionVersionId", "tagId", "labelSnapshot",
          "normalizedNameSnapshot"
        ) VALUES ($1, $2, $3, $4, $5)`,
        [
          randomUUID(),
          remediationVersionId,
          remediationTag.id,
          remediationTag.label,
          remediationTag.normalizedName
        ]
      )
      await client.query(
        `UPDATE "QuestionVersion"
         SET "contentFingerprint" = "question_version_fingerprint"("id")
         WHERE "id" = $1`,
        [remediationVersionId]
      )
    } finally {
      await client.query(`SET session_replication_role = origin`)
    }
    await insertCredentialUser({ id: actorId, role: 'ADMIN' })
    await withExecutionRole('nihongo_app', () =>
      ownedSessionSql(
        client,
        `SELECT * FROM "phase7_issue_v1_session"(
          $1, 1, 'ADMIN', 'ACTIVE', $2, $3,
          '127.0.0.1', 'phase7-report-redaction', false
        )`,
        [actorId, sessionId, sessionToken]
      )
    )
    for (const [reportId, reason, description] of [
      [matureReportId, 'ANSWER_ERROR', 'Mature report description'],
      [prematureReportId, 'EXPLANATION_ERROR', 'Premature report description'],
      [openReportId, 'TYPO_OR_GRAMMAR', 'Open report description']
    ] as const) {
      await withExecutionRole('nihongo_app', () =>
        bridgedQuery(
          client,
          `SELECT * FROM "phase7_create_question_report"(
            $1, $2, $3, $4, $5, $6
          )`,
          [
            sessionToken,
            reportId,
            seed.questionId,
            seed.versionId,
            reason,
            description
          ]
        )
      )
    }

    await client.query(`SET session_replication_role = replica`)
    try {
      await client.query(
        `UPDATE "QuestionReport"
         SET "status" = 'RESOLVED',
             "assigneeUserId" = $2, "assigneeActorId" = $2,
             "assigneeRole" = 'ADMIN', "assigneeLabel" = 'ACTIVE_ADMIN',
             "resolutionOutcome" = 'RESOLVED',
             "resolutionReason" = 'MATURE_RETENTION_FIXTURE',
             "remediationVersionId" = $3,
             "createdAt" = clock_timestamp() - INTERVAL '200 days',
             "resolvedAt" = clock_timestamp() - INTERVAL '181 days',
             "updatedAt" = clock_timestamp() - INTERVAL '181 days',
             "rowVersion" = 2
         WHERE "id" = $1`,
        [matureReportId, actorId, remediationVersionId]
      )
      await client.query(
        `UPDATE "QuestionReport"
         SET "status" = 'RESOLVED',
             "assigneeUserId" = $2, "assigneeActorId" = $2,
             "assigneeRole" = 'ADMIN', "assigneeLabel" = 'ACTIVE_ADMIN',
             "resolutionOutcome" = 'RESOLVED',
             "resolutionReason" = 'PREMATURE_RETENTION_FIXTURE',
             "createdAt" = clock_timestamp() - INTERVAL '10 days',
             "resolvedAt" = clock_timestamp() - INTERVAL '1 day',
             "updatedAt" = clock_timestamp() - INTERVAL '1 day',
             "rowVersion" = 2
         WHERE "id" = $1`,
        [prematureReportId, actorId]
      )
    } finally {
      await client.query(`SET session_replication_role = origin`)
    }

    const before = await client.query<{
      description: string
      descriptionDigest: string
      id: string
      remediationVersionId: string | null
      resolutionOutcome: string | null
      resolutionReason: string | null
      resolvedAt: Date | null
      rowVersion: number
      status: string
      updatedAt: Date
    }>(
      `SELECT "id"::text, "description", "descriptionDigest",
         "status"::text, "resolutionOutcome"::text, "resolutionReason",
         "remediationVersionId"::text, "resolvedAt", "rowVersion", "updatedAt"
       FROM "QuestionReport" WHERE "id" = ANY($1::uuid[])
       ORDER BY "id"`,
      [[matureReportId, prematureReportId, openReportId]]
    )
    const beforeById = new Map(before.rows.map((row) => [row.id, row]))
    const matureBefore = beforeById.get(matureReportId)
    const prematureBefore = beforeById.get(prematureReportId)
    const openBefore = beforeById.get(openReportId)
    if (!matureBefore || !prematureBefore || !openBefore) {
      throw new Error('Report redaction snapshots are unavailable.')
    }

    await expect(
      withExecutionRole('nihongo_app', () =>
        bridgedQuery(
          client,
          `SELECT "phase7_redact_expired_report_descriptions"(0, 'TEST')`
        )
      )
    ).rejects.toMatchObject({ code: '22023' })

    await expect(
      withExecutionRole('nihongo_app', () =>
        bridgedQuery(
          client,
          `SELECT "phase7_redact_expired_report_descriptions"(
            100, 'TEST'
          ) AS redacted`
        )
      )
    ).resolves.toMatchObject({ rows: [{ redacted: 1 }] })
    await expect(
      withExecutionRole('nihongo_app', () =>
        bridgedQuery(
          client,
          `SELECT "phase7_redact_expired_report_descriptions"(
            100, 'TEST'
          ) AS redacted`
        )
      )
    ).resolves.toMatchObject({ rows: [{ redacted: 0 }] })

    const after = await client.query<{
      description: string | null
      descriptionDigest: string
      id: string
      remediationVersionId: string | null
      resolutionOutcome: string | null
      resolutionReason: string | null
      resolvedAt: Date | null
      rowVersion: number
      status: string
      trustedExecutionCount: number
      updatedAt: Date
    }>(
      `SELECT report."id"::text, report."description",
         report."descriptionDigest", report."status"::text,
         report."resolutionOutcome"::text, report."resolutionReason",
         report."remediationVersionId"::text, report."resolvedAt",
         report."rowVersion", report."updatedAt",
         0 /* #504 P7 PR5b dropped Phase7TrustedExecution */
           AS "trustedExecutionCount"
       FROM "QuestionReport" AS report
       WHERE report."id" = ANY($1::uuid[]) ORDER BY report."id"`,
      [[matureReportId, prematureReportId, openReportId]]
    )
    const afterById = new Map(after.rows.map((row) => [row.id, row]))
    expect(afterById.get(matureReportId)).toMatchObject({
      description: null,
      descriptionDigest: matureBefore.descriptionDigest,
      remediationVersionId,
      resolutionOutcome: matureBefore.resolutionOutcome,
      resolutionReason: matureBefore.resolutionReason,
      resolvedAt: matureBefore.resolvedAt,
      rowVersion: matureBefore.rowVersion + 1,
      status: matureBefore.status,
      trustedExecutionCount: 0
    })
    expect(afterById.get(matureReportId)?.updatedAt.getTime()).toBeGreaterThan(
      matureBefore.updatedAt.getTime()
    )
    expect(afterById.get(prematureReportId)).toMatchObject({
      ...prematureBefore,
      trustedExecutionCount: 0
    })
    expect(afterById.get(openReportId)).toMatchObject({
      ...openBefore,
      trustedExecutionCount: 0
    })
    await withExecutionRole('nihongo_app', () =>
      bridgedQuery(client, `SELECT "phase7_erase_user"($1, 'TEST')`, [actorId])
    )
  }, 60_000)

  it('QUESTION_ARCHIVE는 모든 open candidate 상태를 exact abandonment evidence로 종료한다', async () => {
    const actorId = randomUUID()
    const sessionId = randomUUID()
    let sessionToken = `phase7-archive-${randomUUID()}`
    const tag = await client.query<{
      id: string
      label: string
      normalizedName: string
    }>(
      `SELECT tag."id", tag."label", tag."normalizedName"
       FROM "Tag" AS tag
       JOIN "TagApplicability" AS applicability
         ON applicability."tagId" = tag."id"
       WHERE applicability."level" = 'N5'
         AND applicability."subject" = 'VOCABULARY'
         AND applicability."questionType" = 'KANJI_READING'
       ORDER BY tag."id" LIMIT 1`
    )
    const selectedTag = tag.rows[0]
    if (!selectedTag) throw new Error('Archive tag is unavailable.')
    await insertCredentialUser({ id: actorId, role: 'ADMIN' })
    await insertGoogleFixtureAccount(actorId)
    await withExecutionRole('nihongo_app', () =>
      ownedSessionSql(
        client,
        `SELECT * FROM "phase7_issue_v1_session"(
          $1, 1, 'ADMIN', 'ACTIVE', $2, $3,
          '127.0.0.1', 'phase7-archive', false
        )`,
        [actorId, sessionId, sessionToken]
      )
    )

    type OpenArchiveCandidateState =
      | 'APPROVED'
      | 'CHANGES_REQUESTED'
      | 'DRAFT'
      | 'IN_REVIEW'
    type ArchiveCandidate = {
      questionId: string
      state: OpenArchiveCandidateState
      versionId: string
    }
    const states: Array<OpenArchiveCandidateState | 'RETIRED'> = [
      'DRAFT',
      'IN_REVIEW',
      'CHANGES_REQUESTED',
      'APPROVED',
      'RETIRED',
      'DRAFT'
    ]
    const candidates: ArchiveCandidate[] = []
    let emptyManifestTarget:
      | { questionId: string; versionId: string }
      | undefined
    for (const state of states) {
      const questionId = randomUUID()
      const versionId = randomUUID()
      const optionIds = Array.from({ length: 4 }, () => randomUUID())
      const requestId = randomUUID()
      await client.query('BEGIN')
      try {
        await client.query(`SET LOCAL ROLE "nihongo_app"`)
        const operation = await beginAdminOperation(client, {
          command: 'QUESTION_CREATE',
          referencedUserIds: [actorId],
          requestId,
          sessionToken,
          targetManifest: {
            questions: [],
            reports: [],
            tags: [selectedTag.id],
            versions: []
          }
        })
        await client.query(
          `INSERT INTO "Question" (
            "id", "createdByUserId", "createdByActorId",
            "createdByRoleSnapshot", "createdByLabelSnapshot",
            "createdAt", "updatedAt"
          ) VALUES ($1, $2, $2, 'ADMIN', 'ACTIVE_ADMIN', $3, $3)`,
          [questionId, actorId, operation.occurredAt]
        )
        await client.query(
          `INSERT INTO "QuestionVersion" (
            "id", "questionId", "versionNumber", "level", "subject",
            "questionType", "questionText", "correctOptionId",
            "explanationKo", "difficulty", "contentFingerprint",
            "createdByUserId", "createdByActorId", "createdByRoleSnapshot",
            "createdByLabelSnapshot", "createdAt", "updatedAt"
          ) VALUES (
            $1, $2, 1, 'N5', 'VOCABULARY', 'KANJI_READING', $3, $4,
            'QUESTION_ARCHIVE 상태별 검증', 'EASY', repeat('0', 64),
            $5, $5, 'ADMIN', 'ACTIVE_ADMIN', $6, $6
          )`,
          [
            versionId,
            questionId,
            `Archive ${state} ${questionId}`,
            optionIds[0],
            actorId,
            operation.occurredAt
          ]
        )
        for (const [index, optionId] of optionIds.entries()) {
          await client.query(
            `INSERT INTO "QuestionOption" (
              "id", "questionVersionId", "label", "text", "ordinal"
            ) VALUES ($1, $2, $3, $4, $5)`,
            [
              optionId,
              versionId,
              String(index + 1),
              `Archive ${state} option ${index + 1}`,
              index + 1
            ]
          )
        }
        await client.query(
          `INSERT INTO "QuestionVersionTag" (
            "id", "questionVersionId", "tagId", "labelSnapshot",
            "normalizedNameSnapshot"
          ) VALUES ($1, $2, $3, $4, $5)`,
          [
            randomUUID(),
            versionId,
            selectedTag.id,
            selectedTag.label,
            selectedTag.normalizedName
          ]
        )
        await client.query(
          `INSERT INTO "AdminAuditLog" (
            "command", "targetType", "targetId", "actorKind",
            "actorUserId", "actorId", "actorRole", "actorLabel",
            "beforeState", "afterState", "beforeRowVersion",
            "afterRowVersion", "changedFields", "metadata", "contentDigest",
            "operationId", "requestId", "environment", "occurredAt"
          ) VALUES (
            'QUESTION_CREATE', 'QUESTION', $1, 'ACCOUNT', $2, $2,
            'ADMIN', 'ACTIVE_ADMIN', NULL, 'ACTIVE', NULL, 1, $3::jsonb,
            '{"kind":"NONE_V1"}'::jsonb,
            pg_temp."phase7_admin_audit_content_digest"(
              $4, 'QUESTION_CREATE', 'QUESTION', $1, NULL, 'ACTIVE',
              NULL, 1, $3::jsonb, '{"kind":"NONE_V1"}'::jsonb
            ), $4, $5, 'TEST', $6
          )`,
          [
            questionId,
            actorId,
            JSON.stringify(EXPECTED_CHANGED_FIELDS),
            operation.operationId,
            requestId,
            operation.occurredAt
          ]
        )
        await finishInTest(client, [operation.operationId])
        await client.query('COMMIT')
      } catch (error: unknown) {
        await client.query('ROLLBACK')
        throw error
      }
      if (state === 'RETIRED') {
        emptyManifestTarget = { questionId, versionId }
      } else {
        candidates.push({ questionId, state, versionId })
      }
    }

    if (!emptyManifestTarget) {
      throw new Error('Archive 0/0 fixture is missing.')
    }

    await client.query(`SET session_replication_role = replica`)
    try {
      for (const candidate of candidates) {
        await client.query(
          `UPDATE "QuestionVersion" SET "status" = $2::"QuestionVersionStatus"
           WHERE "id" = $1`,
          [candidate.versionId, candidate.state]
        )
      }
      await client.query(
        `UPDATE "QuestionVersion"
         SET "status" = 'RETIRED',
             "retirementKind" = 'PUBLISHED_RETIREMENT',
             "publishedAt" = clock_timestamp() - INTERVAL '1 second',
             "retiredAt" = clock_timestamp(), "rowVersion" = 2,
             "updatedAt" = clock_timestamp()
         WHERE "id" = $1`,
        [emptyManifestTarget.versionId]
      )
    } finally {
      await client.query(`SET session_replication_role = origin`)
    }

    sessionToken = await completeAdminSsoFresh(actorId, sessionToken)

    const archiveCandidates = candidates.slice(0, -1)
    const concurrentCandidate = candidates.at(-1)
    const firstCandidate = archiveCandidates[0]
    const secondCandidate = archiveCandidates[1]
    if (!firstCandidate || !secondCandidate || !concurrentCandidate) {
      throw new Error('Archive guard fixtures are missing.')
    }

    const readArchiveGuardState = async () =>
      (
        await client.query<{
          currentPublishedVersionId: string | null
          lifecycleStatus: string
          questionId: string
          questionRowVersion: number
          versionId: string
          versionRowVersion: number
          versionStatus: string
        }>(
          `SELECT question."id"::text AS "questionId",
             question."lifecycleStatus"::text AS "lifecycleStatus",
             question."rowVersion" AS "questionRowVersion",
             question."currentPublishedVersionId"::text
               AS "currentPublishedVersionId",
             version."id"::text AS "versionId",
             version."status"::text AS "versionStatus",
             version."rowVersion" AS "versionRowVersion"
           FROM "Question" AS question
           JOIN "QuestionVersion" AS version
             ON version."questionId" = question."id"
           WHERE question."id" = ANY($1::uuid[])
           ORDER BY question."id", version."id"`,
          [
            [
              emptyManifestTarget.questionId,
              firstCandidate.questionId,
              secondCandidate.questionId
            ]
          ]
        )
      ).rows
    const archiveGuardStateBefore = await readArchiveGuardState()
    const rejectedArmRequestIds: string[] = []
    const expectArchiveArmRejected = async (
      targetManifest: AdminTargetManifest,
      code: '23514' | '40001'
    ): Promise<void> => {
      const requestId = randomUUID()
      rejectedArmRequestIds.push(requestId)
      await expectFailedTransaction(async () => {
        await client.query(`SET LOCAL ROLE "nihongo_app"`)
        await beginAdminOperation(client, {
          command: 'QUESTION_ARCHIVE',
          referencedUserIds: [actorId],
          requestId,
          sessionToken,
          targetManifest
        })
      }, code)
    }
    const questionManifest = (
      questionId: string,
      rowVersion = 1
    ): AdminTargetManifestItem => ({
      id: questionId,
      rowVersion,
      state: 'ACTIVE'
    })
    const versionManifest = (
      candidate: ArchiveCandidate
    ): AdminTargetManifestItem => ({
      id: candidate.versionId,
      rowVersion: 1,
      state: candidate.state
    })

    await expectArchiveArmRejected(
      {
        questions: [questionManifest(firstCandidate.questionId)],
        reports: [],
        tags: [],
        versions: []
      },
      '23514'
    )
    await expectArchiveArmRejected(
      {
        questions: [questionManifest(emptyManifestTarget.questionId)],
        reports: [],
        tags: [],
        versions: [
          {
            id: emptyManifestTarget.versionId,
            rowVersion: 2,
            state: 'RETIRED'
          }
        ]
      },
      '23514'
    )
    await expectArchiveArmRejected(
      {
        questions: [questionManifest(firstCandidate.questionId)],
        reports: [],
        tags: [],
        versions: [
          versionManifest(firstCandidate),
          versionManifest(secondCandidate)
        ]
      },
      '40001'
    )
    await expectArchiveArmRejected(
      {
        questions: [questionManifest(firstCandidate.questionId, 2)],
        reports: [],
        tags: [],
        versions: [versionManifest(firstCandidate)]
      },
      '40001'
    )
    expect(await readArchiveGuardState()).toEqual(archiveGuardStateBefore)
    expect(
      (
        await client.query<{ count: number }>(
          `SELECT COUNT(*)::int AS count
           FROM (
             SELECT intent."requestId" FROM "OperationIntent" AS intent
             UNION ALL
             SELECT review."requestId" FROM "ContentReview" AS review
             UNION ALL
             SELECT audit."requestId" FROM "AdminAuditLog" AS audit
           ) AS evidence
           WHERE evidence."requestId" = ANY($1::uuid[])`,
          [rejectedArmRequestIds]
        )
      ).rows[0]?.count
    ).toBe(0)

    // P4 removed the DB manifest verifier and evidence cardinality checks;
    // the API command tests cover the archive evidence now.
    expect(await readArchiveGuardState()).toEqual(archiveGuardStateBefore)

    const emptyArchiveRequestId = randomUUID()
    let emptyArchiveOperationId: string | undefined
    await client.query('BEGIN')
    try {
      await client.query(`SET LOCAL ROLE "nihongo_app"`)
      const operation = await beginAdminOperation(client, {
        command: 'QUESTION_ARCHIVE',
        referencedUserIds: [actorId],
        requestId: emptyArchiveRequestId,
        sessionToken,
        targetManifest: {
          questions: [
            {
              id: emptyManifestTarget.questionId,
              rowVersion: 1,
              state: 'ACTIVE'
            }
          ],
          reports: [],
          tags: [],
          versions: []
        }
      })
      emptyArchiveOperationId = operation.operationId
      await client.query(
        `UPDATE "Question"
         SET "lifecycleStatus" = 'ARCHIVED', "archivedAt" = $2,
             "rowVersion" = 2, "updatedAt" = $2
         WHERE "id" = $1`,
        [emptyManifestTarget.questionId, operation.occurredAt]
      )
      const metadata = {
        abandonedCandidateCount: 0,
        kind: 'QUESTION_ARCHIVE_V1',
        retiredPublishedCount: 0
      }
      await client.query(
        `INSERT INTO "AdminAuditLog" (
          "command", "targetType", "targetId", "actorKind",
          "actorUserId", "actorId", "actorRole", "actorLabel",
          "beforeState", "afterState", "beforeRowVersion",
          "afterRowVersion", "changedFields", "metadata", "contentDigest",
          "operationId", "requestId", "environment", "occurredAt"
        ) VALUES (
          'QUESTION_ARCHIVE', 'QUESTION', $1, 'ACCOUNT', $2, $2,
          'ADMIN', 'ACTIVE_ADMIN', 'ACTIVE', 'ARCHIVED', 1, 2,
          '["LIFECYCLE_STATUS"]'::jsonb, $3::jsonb,
          pg_temp."phase7_admin_audit_content_digest"(
            $4, 'QUESTION_ARCHIVE', 'QUESTION', $1,
            'ACTIVE', 'ARCHIVED', 1, 2,
            '["LIFECYCLE_STATUS"]'::jsonb, $3::jsonb
          ), $4, $5, 'TEST', $6
        )`,
        [
          emptyManifestTarget.questionId,
          actorId,
          JSON.stringify(metadata),
          operation.operationId,
          emptyArchiveRequestId,
          operation.occurredAt
        ]
      )
      await finishInTest(client, [operation.operationId])
      await client.query('COMMIT')
    } catch (error: unknown) {
      await client.query('ROLLBACK')
      throw error
    }
    if (!emptyArchiveOperationId) {
      throw new Error('Archive 0/0 operation is missing.')
    }
    expect(
      (
        await client.query<{
          auditCount: number
          changedFields: string[]
          contentDigestValid: boolean
          currentPublishedVersionId: string | null
          intentCount: number
          lifecycleStatus: string
          metadata: {
            abandonedCandidateCount: number
            kind: string
            retiredPublishedCount: number
          }
          reviewCount: number
          rowVersion: number
          versionRowVersion: number
          versionStatus: string
        }>(
          `SELECT question."lifecycleStatus"::text AS "lifecycleStatus",
             question."rowVersion", question."currentPublishedVersionId"::text
               AS "currentPublishedVersionId",
             version."status"::text AS "versionStatus",
             version."rowVersion" AS "versionRowVersion",
             audit."changedFields", audit."metadata",
             audit."contentDigest" = pg_temp."phase7_admin_audit_content_digest"(
               audit."operationId", audit."command", audit."targetType",
               audit."targetId", audit."beforeState", audit."afterState",
               audit."beforeRowVersion", audit."afterRowVersion",
               audit."changedFields", audit."metadata"
             ) AS "contentDigestValid",
             (SELECT COUNT(*)::int FROM "AdminAuditLog"
              WHERE "operationId" = $3) AS "auditCount",
             (SELECT COUNT(*)::int FROM "ContentReview"
              WHERE "operationId" = $3) AS "reviewCount",
             (SELECT COUNT(*)::int FROM "OperationIntent"
              WHERE "operationId" = $3) AS "intentCount"
           FROM "Question" AS question
           JOIN "QuestionVersion" AS version ON version."id" = $2
           JOIN "AdminAuditLog" AS audit ON audit."operationId" = $3
           WHERE question."id" = $1`,
          [
            emptyManifestTarget.questionId,
            emptyManifestTarget.versionId,
            emptyArchiveOperationId
          ]
        )
      ).rows
    ).toEqual([
      {
        auditCount: 1,
        changedFields: ['LIFECYCLE_STATUS'],
        contentDigestValid: true,
        currentPublishedVersionId: null,
        intentCount: 0,
        lifecycleStatus: 'ARCHIVED',
        metadata: {
          abandonedCandidateCount: 0,
          kind: 'QUESTION_ARCHIVE_V1',
          retiredPublishedCount: 0
        },
        reviewCount: 0,
        rowVersion: 2,
        versionRowVersion: 2,
        versionStatus: 'RETIRED'
      }
    ])

    // Raw status rewrites to RETIRED are now refused by the API command
    // path, not by a DB trigger (#504 P4).

    for (const candidate of archiveCandidates) {
      const requestId = randomUUID()
      await client.query('BEGIN')
      try {
        await client.query(`SET LOCAL ROLE "nihongo_app"`)
        const operation = await beginAdminOperation(client, {
          command: 'QUESTION_ARCHIVE',
          referencedUserIds: [actorId],
          requestId,
          sessionToken,
          targetManifest: {
            questions: [
              { id: candidate.questionId, rowVersion: 1, state: 'ACTIVE' }
            ],
            reports: [],
            tags: [],
            versions: [
              { id: candidate.versionId, rowVersion: 1, state: candidate.state }
            ]
          }
        })
        await client.query(
          `UPDATE "Question"
           SET "lifecycleStatus" = 'ARCHIVED', "archivedAt" = $2,
               "rowVersion" = 2, "updatedAt" = $2
           WHERE "id" = $1`,
          [candidate.questionId, operation.occurredAt]
        )
        await client.query(
          `UPDATE "QuestionVersion"
           SET "status" = 'RETIRED',
               "retirementKind" = 'QUESTION_ARCHIVE_ABANDONED',
               "retiredAt" = $2, "rowVersion" = 2, "updatedAt" = $2
           WHERE "id" = $1`,
          [candidate.versionId, operation.occurredAt]
        )
        await client.query(
          `INSERT INTO "ContentReview" (
            "questionId", "questionVersionId", "action", "fromState",
            "toState", "actorKind", "actorUserId", "actorId", "actorRole",
            "actorLabel", "counterpartUserId", "counterpartActorId",
            "counterpartRole", "counterpartLabel", "reason", "operationId",
            "requestId", "occurredAt"
          ) VALUES (
            $1, $2, 'ARCHIVE_ABANDONED', $3::"QuestionVersionStatus",
            'RETIRED', 'ACCOUNT', $4, $4, 'ADMIN', 'ACTIVE_ADMIN',
            $4, $4, 'ADMIN', 'ACTIVE_ADMIN', 'QUESTION_ARCHIVE', $5, $6, $7
          )`,
          [
            candidate.questionId,
            candidate.versionId,
            candidate.state,
            actorId,
            operation.operationId,
            requestId,
            operation.occurredAt
          ]
        )
        const metadata = {
          abandonedCandidateCount: 1,
          kind: 'QUESTION_ARCHIVE_V1',
          retiredPublishedCount: 0
        }
        await client.query(
          `INSERT INTO "AdminAuditLog" (
            "command", "targetType", "targetId", "actorKind",
            "actorUserId", "actorId", "actorRole", "actorLabel",
            "beforeState", "afterState", "beforeRowVersion",
            "afterRowVersion", "changedFields", "metadata", "contentDigest",
            "operationId", "requestId", "environment", "occurredAt"
          ) VALUES (
            'QUESTION_ARCHIVE', 'QUESTION', $1, 'ACCOUNT', $2, $2,
            'ADMIN', 'ACTIVE_ADMIN', 'ACTIVE', 'ARCHIVED', 1, 2,
            '["LIFECYCLE_STATUS","VERSION_STATUS"]'::jsonb, $3::jsonb,
            pg_temp."phase7_admin_audit_content_digest"(
              $4, 'QUESTION_ARCHIVE', 'QUESTION', $1,
              'ACTIVE', 'ARCHIVED', 1, 2,
              '["LIFECYCLE_STATUS","VERSION_STATUS"]'::jsonb, $3::jsonb
            ), $4, $5, 'TEST', $6
          )`,
          [
            candidate.questionId,
            actorId,
            JSON.stringify(metadata),
            operation.operationId,
            requestId,
            operation.occurredAt
          ]
        )
        await finishInTest(client, [operation.operationId])
        await client.query('COMMIT')
      } catch (error: unknown) {
        await client.query('ROLLBACK')
        throw error
      }
    }
    expect(
      (
        await client.query<{
          action: string
          lifecycleStatus: string
          reason: string
          retirementKind: string
          state: string
        }>(
          `SELECT question."lifecycleStatus"::text AS "lifecycleStatus",
             version."status"::text AS state,
             version."retirementKind"::text AS "retirementKind",
             review."action"::text AS action, review."reason"
           FROM "Question" AS question
           JOIN "QuestionVersion" AS version ON version."questionId" = question."id"
           JOIN "ContentReview" AS review
             ON review."questionVersionId" = version."id"
            AND review."action" = 'ARCHIVE_ABANDONED'
           WHERE question."id" = ANY($1::uuid[])
           ORDER BY review."fromState"::text`,
          [archiveCandidates.map(({ questionId }) => questionId)]
        )
      ).rows
    ).toHaveLength(4)

    const concurrentRequestIds = [randomUUID(), randomUUID()] as const
    const concurrentClients = [
      new Client({
        connectionString: connectionUrl.toString(),
        options: createPostgresStartupOptions(schema)
      }),
      new Client({
        connectionString: connectionUrl.toString(),
        options: createPostgresStartupOptions(schema)
      })
    ] as const
    const archiveConcurrentCandidate = async (
      databaseClient: Client,
      requestId: string
    ): Promise<string> => {
      await databaseClient.query('BEGIN')
      try {
        await databaseClient.query(`SET LOCAL ROLE "nihongo_app"`)
        const operation = await beginAdminOperation(databaseClient, {
          command: 'QUESTION_ARCHIVE',
          referencedUserIds: [actorId],
          requestId,
          sessionToken,
          targetManifest: {
            questions: [
              {
                id: concurrentCandidate.questionId,
                rowVersion: 1,
                state: 'ACTIVE'
              }
            ],
            reports: [],
            tags: [],
            versions: [versionManifest(concurrentCandidate)]
          }
        })
        await databaseClient.query(
          `UPDATE "Question"
           SET "lifecycleStatus" = 'ARCHIVED', "archivedAt" = $2,
               "rowVersion" = 2, "updatedAt" = $2
           WHERE "id" = $1`,
          [concurrentCandidate.questionId, operation.occurredAt]
        )
        await databaseClient.query(
          `UPDATE "QuestionVersion"
           SET "status" = 'RETIRED',
               "retirementKind" = 'QUESTION_ARCHIVE_ABANDONED',
               "retiredAt" = $2, "rowVersion" = 2, "updatedAt" = $2
           WHERE "id" = $1`,
          [concurrentCandidate.versionId, operation.occurredAt]
        )
        await databaseClient.query(
          `INSERT INTO "ContentReview" (
             "questionId", "questionVersionId", "action", "fromState",
             "toState", "actorKind", "actorUserId", "actorId", "actorRole",
             "actorLabel", "counterpartUserId", "counterpartActorId",
             "counterpartRole", "counterpartLabel", "reason", "operationId",
             "requestId", "occurredAt"
           ) VALUES (
             $1, $2, 'ARCHIVE_ABANDONED', 'DRAFT', 'RETIRED', 'ACCOUNT',
             $3, $3, 'ADMIN', 'ACTIVE_ADMIN', $3, $3, 'ADMIN',
             'ACTIVE_ADMIN', 'QUESTION_ARCHIVE', $4, $5, $6
           )`,
          [
            concurrentCandidate.questionId,
            concurrentCandidate.versionId,
            actorId,
            operation.operationId,
            requestId,
            operation.occurredAt
          ]
        )
        const metadata = {
          abandonedCandidateCount: 1,
          kind: 'QUESTION_ARCHIVE_V1',
          retiredPublishedCount: 0
        }
        await databaseClient.query(
          `INSERT INTO "AdminAuditLog" (
             "command", "targetType", "targetId", "actorKind",
             "actorUserId", "actorId", "actorRole", "actorLabel",
             "beforeState", "afterState", "beforeRowVersion",
             "afterRowVersion", "changedFields", "metadata", "contentDigest",
             "operationId", "requestId", "environment", "occurredAt"
           ) VALUES (
             'QUESTION_ARCHIVE', 'QUESTION', $1, 'ACCOUNT', $2, $2,
             'ADMIN', 'ACTIVE_ADMIN', 'ACTIVE', 'ARCHIVED', 1, 2,
             '["LIFECYCLE_STATUS","VERSION_STATUS"]'::jsonb, $3::jsonb,
             pg_temp."phase7_admin_audit_content_digest"(
               $4, 'QUESTION_ARCHIVE', 'QUESTION', $1,
               'ACTIVE', 'ARCHIVED', 1, 2,
               '["LIFECYCLE_STATUS","VERSION_STATUS"]'::jsonb, $3::jsonb
             ), $4, $5, 'TEST', $6
           )`,
          [
            concurrentCandidate.questionId,
            actorId,
            JSON.stringify(metadata),
            operation.operationId,
            requestId,
            operation.occurredAt
          ]
        )
        await finishInTest(databaseClient, [operation.operationId])
        await databaseClient.query('COMMIT')
        return operation.operationId
      } catch (error: unknown) {
        await databaseClient.query('ROLLBACK').catch(() => undefined)
        throw error
      }
    }

    let concurrentOutcomes: PromiseSettledResult<string>[]
    try {
      await Promise.all(
        concurrentClients.map((databaseClient) => databaseClient.connect())
      )
      await Promise.all(concurrentClients.map(installAuditDigestSql))
      concurrentOutcomes = await Promise.allSettled(
        concurrentClients.map((databaseClient, index) =>
          archiveConcurrentCandidate(
            databaseClient,
            concurrentRequestIds[index] ?? ''
          )
        )
      )
    } finally {
      await Promise.all(
        concurrentClients.map((databaseClient) =>
          databaseClient.end().catch(() => undefined)
        )
      )
    }
    const concurrentWinnerIndex = concurrentOutcomes.findIndex(
      ({ status }) => status === 'fulfilled'
    )
    const concurrentLoserIndex = concurrentOutcomes.findIndex(
      ({ status }) => status === 'rejected'
    )
    expect(
      concurrentOutcomes.filter(({ status }) => status === 'fulfilled')
    ).toHaveLength(1)
    expect(
      concurrentOutcomes.filter(({ status }) => status === 'rejected')
    ).toHaveLength(1)
    if (concurrentWinnerIndex < 0 || concurrentLoserIndex < 0) {
      throw new Error('Archive concurrency outcome is unavailable.')
    }
    const concurrentLoser = concurrentOutcomes[concurrentLoserIndex]
    if (concurrentLoser?.status !== 'rejected') {
      throw new Error('Archive concurrency loser is malformed.')
    }
    expect(concurrentLoser.reason).toMatchObject({ code: '40001' })
    expect(
      (
        await client.query<{
          auditChangedFields: string[]
          auditCount: number
          auditDigestValid: boolean
          auditMetadata: {
            abandonedCandidateCount: number
            kind: string
            retiredPublishedCount: number
          }
          currentPublishedVersionId: string | null
          lifecycleStatus: string
          loserAuditCount: number
          loserIntentCount: number
          loserReviewCount: number
          questionRowVersion: number
          retirementKind: string | null
          reviewAction: string
          reviewCount: number
          reviewReason: string | null
          versionRowVersion: number
          versionStatus: string
          winnerIntentCount: number
        }>(
          `SELECT question."lifecycleStatus"::text AS "lifecycleStatus",
             question."currentPublishedVersionId"::text
               AS "currentPublishedVersionId",
             question."rowVersion" AS "questionRowVersion",
             version."status"::text AS "versionStatus",
             version."retirementKind"::text AS "retirementKind",
             version."rowVersion" AS "versionRowVersion",
             review."action"::text AS "reviewAction",
             review."reason" AS "reviewReason",
             audit."changedFields" AS "auditChangedFields",
             audit."metadata" AS "auditMetadata",
             audit."contentDigest" = pg_temp."phase7_admin_audit_content_digest"(
               audit."operationId", audit."command", audit."targetType",
               audit."targetId", audit."beforeState", audit."afterState",
               audit."beforeRowVersion", audit."afterRowVersion",
               audit."changedFields", audit."metadata"
             ) AS "auditDigestValid",
             (SELECT COUNT(*)::int FROM "AdminAuditLog"
              WHERE "requestId" = $3) AS "auditCount",
             (SELECT COUNT(*)::int FROM "ContentReview"
              WHERE "requestId" = $3) AS "reviewCount",
             (SELECT COUNT(*)::int FROM "OperationIntent"
              WHERE "requestId" = $3) AS "winnerIntentCount",
             (SELECT COUNT(*)::int FROM "AdminAuditLog"
              WHERE "requestId" = $4) AS "loserAuditCount",
             (SELECT COUNT(*)::int FROM "ContentReview"
              WHERE "requestId" = $4) AS "loserReviewCount",
             (SELECT COUNT(*)::int FROM "OperationIntent"
              WHERE "requestId" = $4) AS "loserIntentCount"
           FROM "Question" AS question
           JOIN "QuestionVersion" AS version
             ON version."questionId" = question."id"
            AND version."id" = $2
           JOIN "ContentReview" AS review
             ON review."questionVersionId" = version."id"
            AND review."requestId" = $3
           JOIN "AdminAuditLog" AS audit ON audit."requestId" = $3
           WHERE question."id" = $1`,
          [
            concurrentCandidate.questionId,
            concurrentCandidate.versionId,
            concurrentRequestIds[concurrentWinnerIndex],
            concurrentRequestIds[concurrentLoserIndex]
          ]
        )
      ).rows
    ).toEqual([
      {
        auditChangedFields: ['LIFECYCLE_STATUS', 'VERSION_STATUS'],
        auditCount: 1,
        auditDigestValid: true,
        auditMetadata: {
          abandonedCandidateCount: 1,
          kind: 'QUESTION_ARCHIVE_V1',
          retiredPublishedCount: 0
        },
        currentPublishedVersionId: null,
        lifecycleStatus: 'ARCHIVED',
        loserAuditCount: 0,
        loserIntentCount: 0,
        loserReviewCount: 0,
        questionRowVersion: 2,
        retirementKind: 'QUESTION_ARCHIVE_ABANDONED',
        reviewAction: 'ARCHIVE_ABANDONED',
        reviewCount: 1,
        reviewReason: 'QUESTION_ARCHIVE',
        versionRowVersion: 2,
        versionStatus: 'RETIRED',
        winnerIntentCount: 0
      }
    ])
    await withExecutionRole('nihongo_app', () =>
      bridgedQuery(client, `SELECT "phase7_erase_user"($1, 'TEST')`, [actorId])
    )
  }, 60_000)

  it('동일 fingerprint는 SERIALIZABLE 동시 loser와 visible duplicate를 write 0으로 만든다', async () => {
    const firstActorId = randomUUID()
    const secondActorId = randomUUID()
    const firstSessionId = randomUUID()
    const secondSessionId = randomUUID()
    const firstSessionToken = `phase7-duplicate-first-${randomUUID()}`
    const secondSessionToken = `phase7-duplicate-second-${randomUUID()}`
    await insertCredentialUser({ id: firstActorId, role: 'ADMIN' })
    await insertCredentialUser({ id: secondActorId, role: 'ADMIN' })
    await expect(
      withExecutionRole('nihongo_app', () =>
        ownedSessionSql(
          client,
          `SELECT * FROM "phase7_issue_v1_session"(
            $1, 1, 'ADMIN', 'ACTIVE', $2, $3,
            '127.0.0.1', 'phase7-duplicate-first', false
          )`,
          [firstActorId, firstSessionId, firstSessionToken]
        )
      )
    ).resolves.toMatchObject({ rows: [{ id: firstSessionId }] })
    await expect(
      withExecutionRole('nihongo_app', () =>
        ownedSessionSql(
          client,
          `SELECT * FROM "phase7_issue_v1_session"(
            $1, 1, 'ADMIN', 'ACTIVE', $2, $3,
            '127.0.0.1', 'phase7-duplicate-second', false
          )`,
          [secondActorId, secondSessionId, secondSessionToken]
        )
      )
    ).resolves.toMatchObject({ rows: [{ id: secondSessionId }] })

    const tag = await client.query<{
      id: string
      label: string
      normalizedName: string
    }>(
      `SELECT tag."id", tag."label", tag."normalizedName"
       FROM "Tag" AS tag
       JOIN "TagApplicability" AS applicability
         ON applicability."tagId" = tag."id"
       WHERE applicability."level" = 'N5'
         AND applicability."subject" = 'VOCABULARY'
         AND applicability."questionType" = 'KANJI_READING'
       ORDER BY tag."id"
       LIMIT 1`
    )
    const selectedTag = tag.rows[0]
    if (!selectedTag) {
      throw new Error('Concurrent duplicate tag fixture is unavailable.')
    }

    const stageQuestion = async (
      targetClient: Client,
      rawSessionToken: string,
      actorUserId: string,
      onPrepared?: (input: { operationId: string; questionId: string }) => void
    ): Promise<{
      operationId: string
      questionId: string
      versionId: string
    }> => {
      const questionId = randomUUID()
      const versionId = randomUUID()
      const optionIds = Array.from({ length: 4 }, () => randomUUID())
      const requestId = randomUUID()
      const operationRow = await beginAdminOperation(targetClient, {
        command: 'QUESTION_CREATE',
        referencedUserIds: [actorUserId],
        requestId,
        sessionToken: rawSessionToken,
        targetManifest: {
          questions: [],
          reports: [],
          tags: [selectedTag.id],
          versions: []
        }
      })
      if (!operationRow || !optionIds[0]) {
        throw new Error(
          'Concurrent duplicate operation fixture is unavailable.'
        )
      }
      onPrepared?.({
        operationId: operationRow.operationId,
        questionId
      })
      await targetClient.query(
        `INSERT INTO "Question" (
          "id", "createdByUserId", "createdByActorId",
          "createdByRoleSnapshot", "createdByLabelSnapshot",
          "createdAt", "updatedAt"
        ) VALUES ($1, $2, $2, 'ADMIN', 'ACTIVE_ADMIN', $3, $3)`,
        [questionId, operationRow.actorUserId, operationRow.occurredAt]
      )
      await targetClient.query(
        `INSERT INTO "QuestionVersion" (
          "id", "questionId", "versionNumber", "level", "subject",
          "questionType", "questionText", "correctOptionId",
          "explanationKo", "difficulty", "contentFingerprint",
          "createdByUserId", "createdByActorId", "createdByRoleSnapshot",
          "createdByLabelSnapshot", "createdAt", "updatedAt"
        ) VALUES (
          $1, $2, 1, 'N5', 'VOCABULARY', 'KANJI_READING',
          'Concurrent duplicate content', $3,
          '동시 중복 fingerprint 검증', 'EASY', repeat('0', 64),
          $4, $4, 'ADMIN', 'ACTIVE_ADMIN', $5, $5
        )`,
        [
          versionId,
          questionId,
          optionIds[0],
          operationRow.actorUserId,
          operationRow.occurredAt
        ]
      )
      for (const [index, optionId] of optionIds.entries()) {
        await targetClient.query(
          `INSERT INTO "QuestionOption" (
            "id", "questionVersionId", "label", "text", "ordinal"
          ) VALUES ($1, $2, $3, $4, $5)`,
          [
            optionId,
            versionId,
            String(index + 1),
            `Concurrent option ${index + 1}`,
            index + 1
          ]
        )
      }
      await targetClient.query(
        `INSERT INTO "QuestionVersionTag" (
          "id", "questionVersionId", "tagId", "labelSnapshot",
          "normalizedNameSnapshot"
        ) VALUES ($1, $2, $3, $4, $5)`,
        [
          randomUUID(),
          versionId,
          selectedTag.id,
          selectedTag.label,
          selectedTag.normalizedName
        ]
      )
      await targetClient.query(
        `INSERT INTO "AdminAuditLog" (
          "command", "targetType", "targetId", "actorKind",
          "actorUserId", "actorId", "actorRole", "actorLabel",
          "beforeState", "afterState", "beforeRowVersion",
          "afterRowVersion", "changedFields", "metadata", "contentDigest",
          "operationId", "requestId", "environment", "occurredAt"
        ) VALUES (
          'QUESTION_CREATE', 'QUESTION', $1, 'ACCOUNT', $2, $2, 'ADMIN',
          'ACTIVE_ADMIN', NULL, 'ACTIVE', NULL, 1, $3::jsonb,
          '{"kind":"NONE_V1"}'::jsonb,
          pg_temp."phase7_admin_audit_content_digest"(
            $4, 'QUESTION_CREATE', 'QUESTION', $1, NULL, 'ACTIVE',
            NULL, 1, $3::jsonb, '{"kind":"NONE_V1"}'::jsonb
          ), $4, $5, 'TEST', $6
        )`,
        [
          questionId,
          operationRow.actorUserId,
          JSON.stringify(EXPECTED_CHANGED_FIELDS),
          operationRow.operationId,
          requestId,
          operationRow.occurredAt
        ]
      )
      return { operationId: operationRow.operationId, questionId, versionId }
    }

    const duplicateClient = new Client({
      connectionString: connectionUrl.toString(),
      options: createPostgresStartupOptions(schema)
    })
    let firstTransactionOpen = false
    let secondTransactionOpen = false
    let secondStagePromise:
      | Promise<{
          operationId: string
          questionId: string
          versionId: string
        }>
      | undefined
    let loserCompletionPromise: Promise<unknown> | undefined
    let firstQuestionId = ''
    let secondQuestionId: string | null = null
    let firstOperationId = ''
    let secondOperationId: string | null = null
    await duplicateClient.connect()
    await installAuditDigestSql(duplicateClient)
    try {
      const duplicateBackend = await duplicateClient.query<{ pid: number }>(
        `SELECT pg_backend_pid() AS pid`
      )
      const duplicateBackendPid = duplicateBackend.rows[0]?.pid
      if (!duplicateBackendPid) {
        throw new Error('Concurrent duplicate backend PID is unavailable.')
      }
      await client.query('BEGIN')
      firstTransactionOpen = true
      await client.query(`SET LOCAL ROLE "nihongo_app"`)
      const first = await stageQuestion(client, firstSessionToken, firstActorId)
      firstQuestionId = first.questionId
      firstOperationId = first.operationId

      await duplicateClient.query('BEGIN')
      secondTransactionOpen = true
      await duplicateClient.query(`SET LOCAL ROLE "nihongo_app"`)
      secondStagePromise = stageQuestion(
        duplicateClient,
        secondSessionToken,
        secondActorId,
        (prepared) => {
          secondQuestionId = prepared.questionId
          secondOperationId = prepared.operationId
        }
      )
      void secondStagePromise.catch(() => undefined)

      await client.query(`RESET ROLE`)
      let advisoryLockObserved = false
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const activity = await client.query<{ waitEventType: string | null }>(
          `SELECT wait_event_type AS "waitEventType"
           FROM pg_stat_activity WHERE pid = $1`,
          [duplicateBackendPid]
        )
        if (activity.rows[0]?.waitEventType === 'Lock') {
          advisoryLockObserved = true
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(advisoryLockObserved).toBe(true)
      await client.query(`SET LOCAL ROLE "nihongo_app"`)

      await finishInTest(client, [first.operationId])
      await client.query('COMMIT')
      firstTransactionOpen = false

      try {
        const second = await secondStagePromise
        secondStagePromise = undefined
        loserCompletionPromise = finishInTest(duplicateClient, [
          second.operationId
        ]).then(() => duplicateClient.query('COMMIT'))
        await expect(loserCompletionPromise).rejects.toMatchObject({
          code: '40001'
        })
      } catch (error: unknown) {
        secondStagePromise = undefined
        expect(error).toMatchObject({ code: '40001' })
      }
      await duplicateClient.query('ROLLBACK')
      secondTransactionOpen = false
    } finally {
      if (firstTransactionOpen) await client.query('ROLLBACK')
      await secondStagePromise?.catch(() => undefined)
      await loserCompletionPromise?.catch(() => undefined)
      if (secondTransactionOpen) {
        await duplicateClient.query('ROLLBACK').catch(() => undefined)
      }
      await duplicateClient.end()
    }

    let visibleDuplicateOperationId = ''
    let visibleDuplicateQuestionId = ''
    await expectFailedTransaction(async () => {
      await client.query(`SET LOCAL ROLE "nihongo_app"`)
      const visibleDuplicate = await stageQuestion(
        client,
        secondSessionToken,
        secondActorId
      )
      visibleDuplicateOperationId = visibleDuplicate.operationId
      visibleDuplicateQuestionId = visibleDuplicate.questionId
      await finishInTest(client, [visibleDuplicate.operationId])
    }, '23514')
    expect(visibleDuplicateOperationId).not.toBe('')
    expect(visibleDuplicateQuestionId).not.toBe('')
    expect(secondQuestionId === null).toBe(secondOperationId === null)
    expect(
      (
        await client.query<{ auditCount: number; questionCount: number }>(
          `SELECT
             (SELECT COUNT(*)::int FROM "Question" WHERE "id" = $1)
               AS "questionCount",
             (SELECT COUNT(*)::int FROM "AdminAuditLog"
              WHERE "operationId" = $2) AS "auditCount"`,
          [visibleDuplicateQuestionId, visibleDuplicateOperationId]
        )
      ).rows
    ).toEqual([{ auditCount: 0, questionCount: 0 }])

    expect(
      (
        await client.query<{
          auditCount: number
          operationIntentCount: number
          questionCount: number
          trustedExecutionCount: number
        }>(
          `SELECT
            (SELECT COUNT(*)::int FROM "Question"
             WHERE "id" IN ($1, $2)) AS "questionCount",
            (SELECT COUNT(*)::int FROM "AdminAuditLog"
             WHERE "operationId" IN ($3, $4)) AS "auditCount",
            (SELECT COUNT(*)::int FROM "OperationIntent")
              AS "operationIntentCount",
            0 /* #504 P7 PR5b dropped Phase7TrustedExecution */
              AS "trustedExecutionCount"`,
          [
            firstQuestionId,
            secondQuestionId,
            firstOperationId,
            secondOperationId
          ]
        )
      ).rows
    ).toEqual([
      {
        auditCount: 1,
        operationIntentCount: 0,
        questionCount: 1,
        trustedExecutionCount: 0
      }
    ])
    for (const actorId of [firstActorId, secondActorId]) {
      await expect(
        withExecutionRole('nihongo_app', () =>
          bridgedQuery(
            client,
            `SELECT "phase7_erase_user"($1, 'TEST') AS erased`,
            [actorId]
          )
        )
      ).resolves.toMatchObject({ rows: [{ erased: true }] })
    }
  }, 60_000)

  it('서로 분리된 LOGIN wrapper를 실제 startup role로 attestation한다', async () => {
    if (!schema) {
      throw new Error('Integration schema is unavailable.')
    }
    const suffix = randomUUID().replaceAll('-', '').slice(0, 20)
    const applicationLogin = 'nihongo_test_app_login'
    // #504 P8-1: one runtime login; the gateway names go in P8-2.
    const authGatewayLogin = 'nihongo_test_app_login'
    const developmentApplicationLogin = 'nihongo_development_app_login'
    const extraRole = `phase7_extra_${suffix}`
    const wrongSchema = `phase7_wrong_${suffix}_test`
    const ownedDatabase = `phase7_owned_${suffix}_test`
    const identifierPattern = /^[a-z][a-z0-9_]{0,62}$/
    const quoteIdentifier = (value: string): string => {
      if (!identifierPattern.test(value)) {
        throw new Error('Unsafe Phase 7 runtime attestation identifier.')
      }
      return `"${value}"`
    }
    const applicationUrl = environment.DATABASE_URL
    const authGatewayUrl = process.env.PHASE7_AUTH_GATEWAY_FIXTURE_DATABASE_URL
    if (!authGatewayUrl) {
      throw new Error('Auth gateway wrapper URL is required.')
    }
    if (
      decodeURIComponent(new URL(applicationUrl).username) !==
        applicationLogin ||
      decodeURIComponent(new URL(authGatewayUrl).username) !==
        authGatewayLogin ||
      decodeURIComponent(
        new URL(developmentApplicationDatabaseUrl).username
      ) !== developmentApplicationLogin
    ) {
      throw new Error('Runtime wrapper URL identities are not exact.')
    }
    const retargetWrapperUrl = (
      {
        databaseName,
        schemaName = schema
      }: {
        databaseName: string
        schemaName?: string
      },
      source: string
    ): string => {
      if (
        !identifierPattern.test(databaseName) ||
        !identifierPattern.test(schemaName)
      ) {
        throw new Error('Unsafe Phase 7 runtime attestation URL target.')
      }
      const url = new URL(source)
      url.pathname = `/${databaseName}`
      url.searchParams.set('schema', schemaName)
      return url.toString()
    }
    const configuredDatabaseName = decodeURIComponent(
      new URL(applicationUrl).pathname.slice(1)
    )
    let applicationRuntime:
      | ReturnType<typeof createRoleDatabaseRuntime>
      | undefined
    let authGatewayRuntime:
      | ReturnType<typeof createRoleDatabaseRuntime>
      | undefined
    let wrongSchemaRuntime:
      | ReturnType<typeof createRoleDatabaseRuntime>
      | undefined
    let ownedDatabaseApplicationRuntime:
      | ReturnType<typeof createRoleDatabaseRuntime>
      | undefined
    let ownedDatabaseAuthGatewayRuntime:
      | ReturnType<typeof createRoleDatabaseRuntime>
      | undefined
    let ownedDatabaseAdmin: Client | undefined
    let developmentToTestClient: Client | undefined
    let extraRoleCreated = false
    let applicationSuperuser = false
    let applicationHasDirectUserEmailAcl = false
    let applicationGroupHasUserNameAcl = false
    let applicationGroupHasUserRoleUpdateAcl = false
    let applicationHasExtraMembership = false
    let applicationHasDirectQuestionAcl = false
    let applicationConnectRestored = true
    let authGatewayConnectRestored = true
    let publicConnectRestored = true
    let applicationReplicaSettingRestored = true
    let authGatewayDatabaseReplicaSettingRestored = true

    try {
      applicationRuntime = createRoleDatabaseRuntime(
        applicationUrl,
        'nihongo_app'
      )
      authGatewayRuntime = createRoleDatabaseRuntime(
        authGatewayUrl,
        'nihongo_app'
      )
      const endpoints = {
        application: {
          client: applicationRuntime.client,
          connectionString: applicationUrl,
          expectedRole: 'nihongo_app' as const
        }
      }
      await expect(attestRuntimeRoles(endpoints)).resolves.toBeUndefined()
      await expect(
        applicationRuntime.client.$queryRawUnsafe(
          `SELECT "require_runtime_ready"()`
        )
      ).resolves.toHaveLength(1)

      const workerLogin = 'nihongo_test_guest_cleanup_worker_login'
      const developmentWorkerLogin =
        'nihongo_development_guest_cleanup_worker_login'
      const database = quoteIdentifier(configuredDatabaseName)
      const checkWorkerDatabaseAcl = async (
        role: string,
        privilege: string,
        accepted: boolean,
        grantOption = false
      ): Promise<void> => {
        await client.query(
          `GRANT ${privilege} ON DATABASE ${database} TO ${quoteIdentifier(role)}${grantOption ? ' WITH GRANT OPTION' : ''}`
        )
        try {
          const attestation = attestRuntimeRoles(endpoints)
          if (accepted) {
            await expect(attestation).resolves.toBeUndefined()
          } else {
            await expect(attestation).rejects.toThrow(
              'Runtime DB role attestation failed.'
            )
          }
        } finally {
          await client.query(
            `REVOKE ALL PRIVILEGES ON DATABASE ${database} FROM ${quoteIdentifier(role)}`
          )
        }
      }

      await checkWorkerDatabaseAcl(workerLogin, 'CONNECT', true)
      await checkWorkerDatabaseAcl(workerLogin, 'CONNECT', false, true)
      await checkWorkerDatabaseAcl(workerLogin, 'CREATE', false)
      await checkWorkerDatabaseAcl(workerLogin, 'TEMPORARY', false)
      await checkWorkerDatabaseAcl(developmentWorkerLogin, 'CONNECT', false)

      const assertReplicaStartupFailsClosed = async ({
        resetSetting,
        setSetting,
        settingKind
      }: {
        resetSetting: string
        setSetting: string
        settingKind: 'application-role' | 'auth-gateway-database-role'
      }): Promise<void> => {
        const before = await client.query<{
          id: string
          updatedAt: Date
        }>(
          `SELECT "id", "updatedAt" FROM "Question"
           ORDER BY "id" LIMIT 1`
        )
        const target = before.rows[0]
        if (!target) {
          throw new Error('Runtime write-zero fixture is unavailable.')
        }

        await client.query(setSetting)
        if (settingKind === 'application-role') {
          applicationReplicaSettingRestored = false
        } else {
          authGatewayDatabaseReplicaSettingRestored = false
        }

        const replicaApplicationRuntime = createRoleDatabaseRuntime(
          applicationUrl,
          'nihongo_app'
        )
        const replicaAuthGatewayRuntime = createRoleDatabaseRuntime(
          authGatewayUrl,
          'nihongo_app'
        )
        try {
          const guardedServiceMutation = async (): Promise<number> => {
            try {
              await attestRuntimeRoles({
                application: {
                  client: replicaApplicationRuntime.client,
                  connectionString: applicationUrl,
                  expectedRole: 'nihongo_app'
                }
              })
            } catch {
              return 503
            }
            await replicaApplicationRuntime.client.$executeRawUnsafe(
              `UPDATE "Question" SET "updatedAt" = clock_timestamp()
               WHERE "id" = $1`,
              target.id
            )
            return 204
          }

          await expect(guardedServiceMutation()).resolves.toBe(503)
          expect(
            (
              await client.query<{ updatedAt: Date }>(
                `SELECT "updatedAt" FROM "Question" WHERE "id" = $1`,
                [target.id]
              )
            ).rows
          ).toEqual([{ updatedAt: target.updatedAt }])
        } finally {
          await Promise.allSettled([
            replicaApplicationRuntime.disconnect(),
            replicaAuthGatewayRuntime.disconnect()
          ])
          await client.query(resetSetting)
          if (settingKind === 'application-role') {
            applicationReplicaSettingRestored = true
          } else {
            authGatewayDatabaseReplicaSettingRestored = true
          }
        }
      }

      await assertReplicaStartupFailsClosed({
        resetSetting: `ALTER ROLE ${quoteIdentifier(applicationLogin)}
          RESET session_replication_role`,
        setSetting: `ALTER ROLE ${quoteIdentifier(applicationLogin)}
          SET session_replication_role = replica`,
        settingKind: 'application-role'
      })
      // #504 P7 PR1: the auth gateway login is no longer a runtime endpoint.

      await client.query(
        `GRANT CONNECT ON DATABASE ${quoteIdentifier(configuredDatabaseName)}
         TO PUBLIC`
      )
      publicConnectRestored = false
      await expect(attestRuntimeRoles(endpoints)).rejects.toThrow(
        'Runtime DB role attestation failed.'
      )
      await client.query(
        `REVOKE CONNECT ON DATABASE ${quoteIdentifier(configuredDatabaseName)}
         FROM PUBLIC`
      )
      publicConnectRestored = true

      await client.query(
        `REVOKE CONNECT ON DATABASE ${quoteIdentifier(configuredDatabaseName)}
         FROM ${quoteIdentifier(applicationLogin)}`
      )
      applicationConnectRestored = false
      await client.query(
        `GRANT CONNECT ON DATABASE ${quoteIdentifier(configuredDatabaseName)}
         TO ${quoteIdentifier(applicationLogin)} WITH GRANT OPTION`
      )
      await expect(attestRuntimeRoles(endpoints)).rejects.toThrow(
        'Runtime DB role attestation failed.'
      )
      await client.query(
        `REVOKE CONNECT ON DATABASE ${quoteIdentifier(configuredDatabaseName)}
         FROM ${quoteIdentifier(applicationLogin)}`
      )
      await client.query(
        `GRANT CONNECT ON DATABASE ${quoteIdentifier(configuredDatabaseName)}
         TO ${quoteIdentifier(applicationLogin)}`
      )
      applicationConnectRestored = true

      await client.query(
        `ALTER ROLE ${quoteIdentifier(applicationLogin)} SUPERUSER`
      )
      applicationSuperuser = true
      await expect(attestRuntimeRoles(endpoints)).rejects.toThrow(
        'Runtime DB role attestation failed.'
      )
      await client.query(
        `ALTER ROLE ${quoteIdentifier(applicationLogin)} NOSUPERUSER`
      )
      applicationSuperuser = false

      await client.query(
        `CREATE ROLE ${quoteIdentifier(extraRole)}
         NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
         NOREPLICATION NOBYPASSRLS`
      )
      extraRoleCreated = true
      await checkWorkerDatabaseAcl(extraRole, 'CONNECT', false)
      await client.query(
        `GRANT ${quoteIdentifier(extraRole)} TO ${quoteIdentifier(applicationLogin)}`
      )
      applicationHasExtraMembership = true
      await expect(attestRuntimeRoles(endpoints)).rejects.toThrow(
        'Runtime DB role attestation failed.'
      )
      await client.query(
        `REVOKE ${quoteIdentifier(extraRole)} FROM ${quoteIdentifier(applicationLogin)}`
      )
      applicationHasExtraMembership = false

      await client.query(
        `GRANT SELECT ON TABLE ${quoteIdentifier(schema)}."Question"
         TO ${quoteIdentifier(applicationLogin)}`
      )
      applicationHasDirectQuestionAcl = true
      await expect(attestRuntimeRoles(endpoints)).rejects.toThrow(
        'Runtime DB role attestation failed.'
      )
      await client.query(
        `REVOKE ALL PRIVILEGES ON TABLE ${quoteIdentifier(schema)}."Question"
         FROM ${quoteIdentifier(applicationLogin)}`
      )
      applicationHasDirectQuestionAcl = false

      await client.query(
        `GRANT SELECT ("email") ON TABLE ${quoteIdentifier(schema)}."User"
         TO ${quoteIdentifier(applicationLogin)}`
      )
      applicationHasDirectUserEmailAcl = true
      await expect(attestRuntimeRoles(endpoints)).rejects.toThrow(
        'Runtime DB role attestation failed.'
      )
      await client.query(
        `REVOKE SELECT ("email") ON TABLE ${quoteIdentifier(schema)}."User"
         FROM ${quoteIdentifier(applicationLogin)}`
      )
      applicationHasDirectUserEmailAcl = false

      // #504 P2: the app group may read only the member console columns
      // (#504 P7 PR3a adds name and targetLevel for the principal).
      await client.query(
        `GRANT SELECT ("image") ON TABLE ${quoteIdentifier(schema)}."User"
         TO "nihongo_app"`
      )
      applicationGroupHasUserNameAcl = true
      await expect(attestRuntimeRoles(endpoints)).rejects.toThrow(
        'Runtime DB role attestation failed.'
      )
      await client.query(
        `REVOKE SELECT ("image") ON TABLE ${quoteIdentifier(schema)}."User"
         FROM "nihongo_app"`
      )
      applicationGroupHasUserNameAcl = false

      await client.query(
        `GRANT UPDATE ("role") ON TABLE ${quoteIdentifier(schema)}."User"
         TO "nihongo_app"`
      )
      applicationGroupHasUserRoleUpdateAcl = true
      await expect(attestRuntimeRoles(endpoints)).rejects.toThrow(
        'Runtime DB role attestation failed.'
      )
      await client.query(
        `REVOKE UPDATE ("role") ON TABLE ${quoteIdentifier(schema)}."User"
         FROM "nihongo_app"`
      )
      applicationGroupHasUserRoleUpdateAcl = false

      await client.query(
        `CREATE SCHEMA ${quoteIdentifier(wrongSchema)}
         AUTHORIZATION "nihongo_owner"`
      )
      await client.query(
        `GRANT USAGE ON SCHEMA ${quoteIdentifier(wrongSchema)}
         TO "nihongo_app"`
      )
      const wrongSchemaApplicationUrl = retargetWrapperUrl(
        { databaseName: configuredDatabaseName, schemaName: wrongSchema },
        applicationUrl
      )
      wrongSchemaRuntime = createRoleDatabaseRuntime(
        wrongSchemaApplicationUrl,
        'nihongo_app'
      )
      // #504 P7 PR1: the API attests one nihongo_app endpoint, so there is no
      // second endpoint whose schema could disagree.

      await client.query(
        `CREATE DATABASE ${quoteIdentifier(ownedDatabase)}
         OWNER ${quoteIdentifier(applicationLogin)}`
      )
      await client.query(
        `REVOKE CONNECT ON DATABASE ${quoteIdentifier(ownedDatabase)}
         FROM PUBLIC`
      )
      await client.query(
        `GRANT CONNECT ON DATABASE ${quoteIdentifier(ownedDatabase)}
         TO ${quoteIdentifier(applicationLogin)},
            ${quoteIdentifier(authGatewayLogin)}`
      )
      await expect(attestRuntimeRoles(endpoints)).rejects.toThrow(
        'Runtime DB role attestation failed.'
      )

      developmentToTestClient = new Client({
        connectionString: developmentApplicationDatabaseUrl,
        options: createPostgresStartupOptions(schema, 'nihongo_app')
      })
      await expect(developmentToTestClient.connect()).rejects.toMatchObject({
        code: '42501'
      })
      await developmentToTestClient.end().catch(() => undefined)
      developmentToTestClient = undefined

      await client.query(
        `REVOKE CONNECT ON DATABASE ${quoteIdentifier(configuredDatabaseName)}
         FROM ${quoteIdentifier(applicationLogin)},
              ${quoteIdentifier(authGatewayLogin)}`
      )
      applicationConnectRestored = false
      authGatewayConnectRestored = false
      const ownedDatabaseAdminUrl = new URL(connectionUrl)
      ownedDatabaseAdminUrl.pathname = `/${ownedDatabase}`
      ownedDatabaseAdmin = new Client({
        connectionString: ownedDatabaseAdminUrl.toString()
      })
      await ownedDatabaseAdmin.connect()
      await ownedDatabaseAdmin.query(
        `CREATE SCHEMA ${quoteIdentifier(schema)}
         AUTHORIZATION "nihongo_owner"`
      )
      await ownedDatabaseAdmin.query(
        `GRANT USAGE ON SCHEMA ${quoteIdentifier(schema)}
         TO "nihongo_app"`
      )
      const ownedDatabaseApplicationUrl = retargetWrapperUrl(
        { databaseName: ownedDatabase },
        applicationUrl
      )
      const ownedDatabaseAuthGatewayUrl = retargetWrapperUrl(
        { databaseName: ownedDatabase },
        authGatewayUrl
      )
      ownedDatabaseApplicationRuntime = createRoleDatabaseRuntime(
        ownedDatabaseApplicationUrl,
        'nihongo_app'
      )
      ownedDatabaseAuthGatewayRuntime = createRoleDatabaseRuntime(
        ownedDatabaseAuthGatewayUrl,
        'nihongo_app'
      )
      await expect(
        attestRuntimeRoles({
          application: {
            client: ownedDatabaseApplicationRuntime.client,
            connectionString: ownedDatabaseApplicationUrl,
            expectedRole: 'nihongo_app'
          }
        })
      ).rejects.toThrow('Runtime DB role attestation failed.')
    } finally {
      await Promise.allSettled(
        [
          ownedDatabaseApplicationRuntime,
          ownedDatabaseAuthGatewayRuntime,
          wrongSchemaRuntime,
          applicationRuntime,
          authGatewayRuntime
        ].map((runtime) => runtime?.disconnect())
      )
      await developmentToTestClient?.end().catch(() => undefined)
      await ownedDatabaseAdmin?.end().catch(() => undefined)
      await client
        .query(
          `DROP DATABASE IF EXISTS ${quoteIdentifier(ownedDatabase)} WITH (FORCE)`
        )
        .catch(() => undefined)
      await client
        .query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(wrongSchema)} CASCADE`)
        .catch(() => undefined)
      if (applicationHasDirectQuestionAcl) {
        await client
          .query(
            `REVOKE ALL PRIVILEGES ON TABLE ${quoteIdentifier(schema)}."Question"
             FROM ${quoteIdentifier(applicationLogin)}`
          )
          .catch(() => undefined)
      }
      if (applicationGroupHasUserRoleUpdateAcl) {
        await client
          .query(
            `REVOKE UPDATE ("role") ON TABLE ${quoteIdentifier(schema)}."User"
             FROM "nihongo_app"`
          )
          .catch(() => undefined)
      }
      if (applicationGroupHasUserNameAcl) {
        await client
          .query(
            `REVOKE SELECT ("image") ON TABLE ${quoteIdentifier(schema)}."User"
             FROM "nihongo_app"`
          )
          .catch(() => undefined)
      }
      if (applicationHasDirectUserEmailAcl) {
        await client
          .query(
            `REVOKE SELECT ("email") ON TABLE ${quoteIdentifier(schema)}."User"
             FROM ${quoteIdentifier(applicationLogin)}`
          )
          .catch(() => undefined)
      }
      if (!publicConnectRestored) {
        await client
          .query(
            `REVOKE CONNECT ON DATABASE ${quoteIdentifier(configuredDatabaseName)}
             FROM PUBLIC`
          )
          .catch(() => undefined)
      }
      if (!applicationConnectRestored) {
        await client
          .query(
            `REVOKE CONNECT ON DATABASE ${quoteIdentifier(configuredDatabaseName)}
             FROM ${quoteIdentifier(applicationLogin)}`
          )
          .catch(() => undefined)
        await client
          .query(
            `GRANT CONNECT ON DATABASE ${quoteIdentifier(configuredDatabaseName)}
             TO ${quoteIdentifier(applicationLogin)}`
          )
          .catch(() => undefined)
      }
      if (!authGatewayConnectRestored) {
        await client
          .query(
            `REVOKE CONNECT ON DATABASE ${quoteIdentifier(configuredDatabaseName)}
             FROM ${quoteIdentifier(authGatewayLogin)}`
          )
          .catch(() => undefined)
        await client
          .query(
            `GRANT CONNECT ON DATABASE ${quoteIdentifier(configuredDatabaseName)}
             TO ${quoteIdentifier(authGatewayLogin)}`
          )
          .catch(() => undefined)
      }
      if (applicationHasExtraMembership) {
        await client
          .query(
            `REVOKE ${quoteIdentifier(extraRole)} FROM ${quoteIdentifier(applicationLogin)}`
          )
          .catch(() => undefined)
      }
      if (extraRoleCreated) {
        await client
          .query(`DROP ROLE IF EXISTS ${quoteIdentifier(extraRole)}`)
          .catch(() => undefined)
      }
      if (applicationSuperuser) {
        await client
          .query(`ALTER ROLE ${quoteIdentifier(applicationLogin)} NOSUPERUSER`)
          .catch(() => undefined)
      }
      if (!applicationReplicaSettingRestored) {
        await client
          .query(
            `ALTER ROLE ${quoteIdentifier(applicationLogin)}
             RESET session_replication_role`
          )
          .catch(() => undefined)
      }
      if (!authGatewayDatabaseReplicaSettingRestored) {
        await client
          .query(
            `ALTER ROLE ${quoteIdentifier(authGatewayLogin)}
             IN DATABASE ${quoteIdentifier(configuredDatabaseName)}
             RESET session_replication_role`
          )
          .catch(() => undefined)
      }
    }
  }, 60_000)
})
