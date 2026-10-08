import { createHash, randomUUID } from 'node:crypto'
import { canonicalDuplicateIdentity } from '@nihongo/domain/content/validators/v1/duplicates'
import type { PersistedQuestionSemanticV1 } from '@nihongo/domain/content/validators/v1/types'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { buildAllQuestionSeeds } from '../../prisma/seedQuestionCatalog.js'
import type { QuestionAggregateSeed } from '../../prisma/seed-data/buildQuestionSeed.js'
import { parseApiEnvironment } from '../config/env.js'
import { createRoleDatabaseRuntime } from './database.js'
import {
  createPostgresStartupOptions,
  getPostgresSchema
} from './databaseOptions.js'
import { assertSafeAdminCmsDatabase } from './databaseTargetGuard.js'
import { attestPhase7RuntimeRoles } from './phase7RuntimeRoleAttestation.js'

const PHASE7_MIGRATIONS = [
  '20260827100000_phase7_admin_cms_enums',
  '20260827101000_phase7_admin_cms_foundation',
  '20260909120000_phase7_archive_empty_manifest_verifier',
  '20260916120000_phase7_reauthentication_foundation'
] as const
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
const PHASE7_EXECUTION_ROLES = [
  'nihongo_app',
  'nihongo_auth_gateway',
  'nihongo_erasure_worker',
  'nihongo_phase7_migration'
] as const
type Phase7ExecutionRole = (typeof PHASE7_EXECUTION_ROLES)[number]

const environment = parseApiEnvironment(process.env)
assertSafeAdminCmsDatabase({
  adminCmsMode: environment.ADMIN_CMS_MODE,
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})

const schema = getPostgresSchema(environment.DATABASE_URL)
const adminDatabaseUrl = process.env.PHASE7_ADMIN_DATABASE_URL
if (!adminDatabaseUrl) {
  throw new Error('Phase 7 admin integration database URL is required.')
}
if (getPostgresSchema(adminDatabaseUrl) !== schema) {
  throw new Error('Phase 7 admin and runtime schemas must match exactly.')
}
const connectionUrl = new URL(adminDatabaseUrl)
connectionUrl.searchParams.delete('schema')
const client = new Client({
  connectionString: connectionUrl.toString(),
  options: createPostgresStartupOptions(schema)
})
const legacyDatabaseUrl = process.env.PHASE7_LEGACY_DATABASE_URL
if (!legacyDatabaseUrl) {
  throw new Error('Phase 7 legacy compatibility database URL is required.')
}
if (getPostgresSchema(legacyDatabaseUrl) !== schema) {
  throw new Error('Phase 7 legacy and runtime schemas must match exactly.')
}
const developmentApplicationDatabaseUrl =
  process.env.PHASE7_DEVELOPMENT_APP_DATABASE_URL
if (!developmentApplicationDatabaseUrl) {
  throw new Error('Phase 7 development app wrapper URL is required.')
}
const legacyConnectionUrl = new URL(legacyDatabaseUrl)
const legacySchema = getPostgresSchema(legacyDatabaseUrl)
legacyConnectionUrl.searchParams.delete('schema')
const legacyClient = new Client({
  connectionString: legacyConnectionUrl.toString(),
  options: createPostgresStartupOptions(legacySchema)
})
const legacyCompatibilityUserId = randomUUID()
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

const withExecutionRole = async <Result>(
  role: Phase7ExecutionRole,
  action: () => Promise<Result>
): Promise<Result> => {
  if (!PHASE7_EXECUTION_ROLES.includes(role)) {
    throw new Error(`Unexpected Phase 7 execution role: ${role}`)
  }
  await client.query(`SET ROLE "${role}"`)
  let actionError: unknown
  let actionFailed = false
  let resetError: unknown
  let resetFailed = false
  let result: Result | undefined
  try {
    result = await action()
  } catch (error: unknown) {
    actionFailed = true
    actionError = error
  }
  try {
    await client.query('RESET ROLE')
  } catch (error: unknown) {
    resetFailed = true
    resetError = error
  }
  if (actionFailed) throw actionError
  if (resetFailed) throw resetError
  return result as Result
}

interface Phase7AdminTargetManifest {
  readonly questions: readonly Phase7AdminTargetManifestItem[]
  readonly reports: readonly Phase7AdminTargetManifestItem[]
  readonly tags: readonly string[]
  readonly versions: readonly Phase7AdminTargetManifestItem[]
}

interface Phase7AdminTargetManifestItem {
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
    targetManifest: Phase7AdminTargetManifest
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
  const begun = await databaseClient.query<{
    actorUserId: string
    operationId: string
  }>(
    `SELECT * FROM "phase7_begin_admin_operation"(
      $1::"AdminAuditCommand", $2, $3, 'TEST', $4::uuid[]
    )`,
    [
      input.command,
      input.sessionToken,
      input.requestId,
      input.referencedUserIds
    ]
  )
  const operation = begun.rows[0]
  if (!operation) throw new Error('Phase 7 operation was not created.')
  const armed = await databaseClient.query<{ occurredAt: Date }>(
    `SELECT "phase7_arm_admin_operation"($1, $2::jsonb) AS "occurredAt"`,
    [operation.operationId, JSON.stringify(input.targetManifest)]
  )
  const occurredAt = armed.rows[0]?.occurredAt
  if (!occurredAt) throw new Error('Phase 7 operation was not armed.')
  return { ...operation, occurredAt }
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
      ) VALUES ($1, 'Phase 7 DB integration', $2, true, $3, 'ACTIVE', $4, $4)`,
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
    throw new Error('Phase 7 incomplete-content fixture is unavailable.')
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
  await client.connect()
  await legacyClient.connect()
  const endpoint = await client.query<{
    databaseName: string
    serverAddress: string
    serverPort: number
  }>(
    `SELECT current_database() AS "databaseName",
       inet_server_addr()::text AS "serverAddress",
       inet_server_port() AS "serverPort"`
  )
  const target = endpoint.rows[0]
  if (!target) throw new Error('Phase 7 DB endpoint identity is unavailable.')
  await withExecutionRole('nihongo_phase7_migration', () =>
    client.query(
      `SELECT "phase7_register_database_capability"(
        $1, $2::inet, $3, 'TEST'
      )`,
      [target.databaseName, target.serverAddress, target.serverPort]
    )
  )
})

afterAll(async () => {
  await legacyClient.end()
  await client.end()
})

describe('Phase 7 Slice 1 persistence foundation', () => {
  it('31 migration fresh schema와 핵심 DB guard를 exact manifest로 배포한다', async () => {
    const ledger = await client.query<{ migrationName: string }>(
      `SELECT migration_name AS "migrationName"
       FROM "_prisma_migrations"
       WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
       ORDER BY started_at`
    )
    expect(ledger.rows).toHaveLength(31)
    expect(
      ledger.rows.slice(-4).map(({ migrationName }) => migrationName)
    ).toEqual(PHASE7_MIGRATIONS)
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
               'nihongo_phase7_owner', procedure_record.oid, 'EXECUTE'
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
    ).toEqual([
      {
        aclEntryCount: 1,
        appCanExecute: false,
        argumentCount: 1,
        argumentTypes: '2950',
        config: [`search_path=pg_catalog, ${schema}, pg_temp`],
        identityArguments: 'operation_id uuid',
        isSecurityDefiner: true,
        nonOwnerAclCount: 0,
        objectId: expect.stringMatching(/^[1-9][0-9]*$/u),
        ownerCanExecute: true,
        ownerName: 'nihongo_phase7_owner',
        publicCanExecute: false,
        resultType: 'void'
      }
    ])
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
      ).toEqual([{ migrationCount: 31 }])
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
        name: 'phase7_ledger_app_read',
        roles: ['nihongo_app']
      },
      {
        command: 'ALL',
        name: 'phase7_ledger_full_access',
        roles: ['nihongo_phase7_migration']
      },
      {
        command: 'SELECT',
        name: 'phase7_ledger_legacy_read',
        roles: ['nihongo_test_legacy_app_login']
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
      [
        [
          'nihongo_app',
          'nihongo_auth_gateway',
          'nihongo_erasure_worker',
          'nihongo_phase7_migration',
          'nihongo_phase7_owner'
        ]
      ]
    )
    expect(roles.rows.map(({ name }) => name)).toEqual([
      'nihongo_app',
      'nihongo_auth_gateway',
      'nihongo_erasure_worker',
      'nihongo_phase7_migration',
      'nihongo_phase7_owner'
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
      [
        [
          'nihongo_app',
          'nihongo_auth_gateway',
          'nihongo_erasure_worker',
          'nihongo_phase7_migration',
          'nihongo_phase7_owner'
        ]
      ]
    )
    expect(memberships.rows).toEqual([
      {
        memberName: 'nihongo_phase7_migration',
        roleName: 'nihongo_phase7_owner'
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
      [
        [
          'nihongo_app',
          'nihongo_auth_gateway',
          'nihongo_erasure_worker',
          'nihongo_phase7_migration'
        ]
      ]
    )
    expect(schemaPrivileges.rows).toEqual([
      { canCreate: false, canUse: true, name: 'nihongo_app' },
      { canCreate: false, canUse: true, name: 'nihongo_auth_gateway' },
      { canCreate: false, canUse: true, name: 'nihongo_erasure_worker' },
      { canCreate: true, canUse: true, name: 'nihongo_phase7_migration' }
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
    ).toEqual([{ ownerName: 'nihongo_phase7_owner', publicCanCreate: false }])

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
    for (const runtimeRole of [
      'nihongo_app',
      'nihongo_auth_gateway'
    ] as const) {
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
          'AuthIssuerActivation',
          'AuthSessionFamily',
          'AuthSessionRotationFence',
          'ContentReview',
          'Phase7DatabaseCapability',
          'Phase7OperationDelta',
          'Phase7OperationIntent',
          'Phase7TrustedExecution',
          'QuestionReport',
          'TagApplicability'
        ]
      ]
    )
    expect(tables.rows.map(({ name }) => name)).toEqual([
      'AdminAuditLog',
      'AuthIssuerActivation',
      'AuthSessionFamily',
      'AuthSessionRotationFence',
      'ContentReview',
      'Phase7DatabaseCapability',
      'Phase7OperationDelta',
      'Phase7OperationIntent',
      'Phase7TrustedExecution',
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
          'AuthSessionRotationFence_deferred_replacement',
          'QuestionVersion_deferred_full_content',
          'QuestionVersion_deferred_question_aggregate',
          'QuestionVersion_protect_delete',
          'Question_protect_history_delete',
          'QuestionReport_deferred_remediation',
          'User_anonymize_question_creator_before_delete'
        ]
      ]
    )
    expect(triggers.rows.map(({ name }) => name)).toEqual([
      'Account_deferred_credential_totality',
      'AuthSessionRotationFence_deferred_replacement',
      'QuestionReport_deferred_remediation',
      'QuestionVersion_deferred_full_content',
      'QuestionVersion_deferred_question_aggregate',
      'QuestionVersion_protect_delete',
      'Question_protect_history_delete',
      'User_anonymize_question_creator_before_delete'
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
          'phase7_activate_v1_issuer',
          'phase7_arm_admin_operation',
          'phase7_begin_admin_operation',
          'phase7_change_password',
          'phase7_change_password_v1',
          'phase7_change_user_authority',
          'phase7_cleanup_expired_auth_state',
          'phase7_close_trusted_execution',
          'phase7_confirm_v1_session_issuance',
          'phase7_consume_password_reset',
          'phase7_create_question_report',
          'phase7_current_operation_id',
          'phase7_erase_user',
          'phase7_finish_admin_operation',
          'phase7_request_password_reset',
          'phase7_issue_v1_session',
          'phase7_open_trusted_execution',
          'phase7_reauthentication_commit_matches',
          'phase7_reauthenticate_v1_session',
          'phase7_redact_expired_report_descriptions',
          'phase7_refresh_remembered_session',
          'phase7_register_database_capability',
          'phase7_require_runtime_ready',
          'phase7_require_database_capability',
          'phase7_require_caller_role',
          'phase7_resolve_email_verification_subject',
          'phase7_resolve_password_reset_credential',
          'phase7_resolve_session_credential',
          'phase7_resolve_sign_in_credential',
          'phase7_resolve_v1_principal',
          'phase7_sign_up_credential',
          'phase7_owned_sign_out',
          'phase7_operation_references_user',
          'phase7_trusted_erasure_environment',
          'phase7_trusted_execution_active',
          'phase7_trusted_execution_remember',
          'phase7_trusted_execution_target',
          'phase7_verify_email',
          'validate_phase7_question_report_remediation'
        ]
      ]
    )
    expect(publicExecute.rows).toHaveLength(39)
    expect(
      publicExecute.rows.filter(
        ({ ownerName, publicCanExecute }) =>
          ownerName !== 'nihongo_phase7_owner' || publicCanExecute
      )
    ).toEqual([])
    expect(
      publicExecute.rows.find(
        ({ name }) => name === 'phase7_require_caller_role'
      )
    ).toMatchObject({ isSecurityDefiner: false })
    expect(
      publicExecute.rows
        .filter(({ name }) => name !== 'phase7_require_caller_role')
        .every(({ isSecurityDefiner }) => isSecurityDefiner)
    ).toBe(true)

    expect(
      (
        await client.query<{
          appCanExecute: boolean
          authCanExecute: boolean
          erasureCanExecute: boolean
          isSecurityDefiner: boolean
          objectOwnerCanExecute: boolean
          ownerName: string
          publicCanExecute: boolean
        }>(
          `SELECT owner_role.rolname AS "ownerName",
             procedure_record.prosecdef AS "isSecurityDefiner",
             has_function_privilege(
               'nihongo_app', procedure_record.oid, 'EXECUTE'
             ) AS "appCanExecute",
             has_function_privilege(
               'nihongo_auth_gateway', procedure_record.oid, 'EXECUTE'
             ) AS "authCanExecute",
             has_function_privilege(
               'nihongo_erasure_worker', procedure_record.oid, 'EXECUTE'
             ) AS "erasureCanExecute",
             has_function_privilege(
               'nihongo_phase7_owner', procedure_record.oid, 'EXECUTE'
             ) AS "objectOwnerCanExecute",
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
             AND procedure_record.proname =
               'phase7_revoke_legacy_database_connect'
             AND pg_get_function_identity_arguments(procedure_record.oid) = ''`
        )
      ).rows
    ).toEqual([
      {
        appCanExecute: false,
        authCanExecute: false,
        erasureCanExecute: false,
        isSecurityDefiner: true,
        objectOwnerCanExecute: true,
        ownerName: 'nihongo_phase7_migration',
        publicCanExecute: false
      }
    ])

    const legacyActivationStateBefore = await client.query<{
      canConnect: boolean
      legacyIssuerDisabled: boolean
      trustedExecutionCount: number
    }>(
      `SELECT has_database_privilege(
         'nihongo_test_legacy_app_login', current_database(), 'CONNECT'
       ) AS "canConnect",
       (SELECT "legacyIssuerDisabled" FROM "AuthIssuerActivation" WHERE "id" = 1)
         AS "legacyIssuerDisabled",
       (SELECT COUNT(*)::int FROM "Phase7TrustedExecution")
         AS "trustedExecutionCount"`
    )
    await expectFailedTransaction(async () => {
      await client.query(`SELECT "phase7_revoke_legacy_database_connect"()`)
    }, '42501')
    expect(
      (
        await client.query<{
          canConnect: boolean
          legacyIssuerDisabled: boolean
          trustedExecutionCount: number
        }>(
          `SELECT has_database_privilege(
             'nihongo_test_legacy_app_login', current_database(), 'CONNECT'
           ) AS "canConnect",
           (SELECT "legacyIssuerDisabled" FROM "AuthIssuerActivation" WHERE "id" = 1)
             AS "legacyIssuerDisabled",
           (SELECT COUNT(*)::int FROM "Phase7TrustedExecution")
             AS "trustedExecutionCount"`
        )
      ).rows
    ).toEqual(legacyActivationStateBefore.rows)
  })

  it('questionText prefix index의 COLLATE C·text_pattern_ops 계약과 planner 사용을 고정한다', async () => {
    if (!schema) {
      throw new Error('Phase 7 integration schema is unavailable.')
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
        throw new Error('Phase 7 prefix planner fixture is unavailable.')
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
            "phase7_question_version_fingerprint"("id"))
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
        applicabilityCount: 127,
        auditCount: 0,
        fingerprintMismatchCount: 0,
        fingerprintNullCount: 0,
        optionCount: 260,
        questionCount: 65,
        reportCount: 0,
        reviewCount: 0,
        snapshotMismatchCount: 0,
        tagCount: 108,
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
    const spoofedSystemQuestionId = randomUUID()
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
    await expectFailedTransaction(async () => {
      await client.query(
        `UPDATE "QuestionVersion"
           SET "questionText" = 'published mutation', "rowVersion" = "rowVersion" + 1
           WHERE "id" = $1`,
        [seed.versionId]
      )
    }, '42501')
    await expectFailedTransaction(insertIncompleteSystemQuestion, '23514')
    await expectFailedTransaction(async () => {
      await client.query(`SET LOCAL ROLE "nihongo_app"`)
      await client.query(
        `INSERT INTO "Question" (
          "id", "createdByLabelSnapshot", "createdAt", "updatedAt"
        ) VALUES ($1, 'SYSTEM_SEED', clock_timestamp(), clock_timestamp())`,
        [spoofedSystemQuestionId]
      )
    }, '42501')
    await expect(
      client.query(`SELECT 1 FROM "Question" WHERE "id" = $1`, [
        spoofedSystemQuestionId
      ])
    ).resolves.toMatchObject({ rowCount: 0, rows: [] })
  })

  it(
    'V1 activation 전 legacy LOGIN의 Phase 6 readiness·learner CRUD·signout을 보존한다',
    runLegacyCompatibility
  )
  it(
    'V1 issuer activation 뒤 legacy issuance를 write 0으로 차단한다',
    runIssuerActivation,
    60_000
  )

  it('SYSTEM_SEED aggregate에 정상 v2 create→review→approval→publication을 허용한다', async () => {
    const seed = buildAllQuestionSeeds().at(-1)
    if (!seed) throw new Error('Phase 7 SYSTEM_SEED v2 target is unavailable.')
    const selectedTag = seed.tags[0]
    if (!selectedTag) {
      throw new Error('Phase 7 SYSTEM_SEED v2 Tag is unavailable.')
    }
    const authorId = randomUUID()
    const reviewerId = randomUUID()
    const authorSessionId = randomUUID()
    const reviewerSessionId = randomUUID()
    const authorSessionToken = `phase7-seed-v2-author-${randomUUID()}`
    const reviewerSessionToken = `phase7-seed-v2-reviewer-${randomUUID()}`
    const versionId = randomUUID()
    const optionIds = Array.from({ length: 4 }, () => randomUUID())
    if (!optionIds[0]) {
      throw new Error('Phase 7 SYSTEM_SEED v2 options are unavailable.')
    }
    await insertCredentialUser({ id: authorId, role: 'ADMIN' })
    await insertCredentialUser({ id: reviewerId, role: 'ADMIN' })
    await withExecutionRole('nihongo_auth_gateway', () =>
      client.query(
        `SELECT * FROM "phase7_issue_v1_session"(
          $1, 1, 'ADMIN', 'ACTIVE', $2, $3,
          '127.0.0.1', 'phase7-seed-v2-author', false
        )`,
        [authorId, authorSessionId, authorSessionToken]
      )
    )
    await withExecutionRole('nihongo_auth_gateway', () =>
      client.query(
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
          "phase7_admin_audit_content_digest"(
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
          `Phase 7 SYSTEM_SEED v2 ${versionId}`,
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
      await client.query(`SELECT "phase7_finish_admin_operation"($1)`, [
        operation.operationId
      ])
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
        await client.query(`SELECT "phase7_finish_admin_operation"($1)`, [
          operation.operationId
        ])
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
      await client.query(`SELECT "phase7_finish_admin_operation"($1)`, [
        operation.operationId
      ])
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
    await expectFailedTransaction(async () => {
      await client.query(
        `UPDATE "Question" SET "rowVersion" = "rowVersion" + 1,
           "updatedAt" = clock_timestamp() WHERE "id" = $1`,
        [seed.questionId]
      )
    }, '42501')
    for (const actorId of [authorId, reviewerId]) {
      await withExecutionRole('nihongo_erasure_worker', () =>
        client.query(`SELECT "phase7_erase_user"($1, 'TEST')`, [actorId])
      )
    }
  }, 60_000)

  it('Tag/QVT 전역 mutex가 역순 insert와 delete→insert/rename 교차를 직렬화한다', async () => {
    const firstActorId = randomUUID()
    const secondActorId = randomUUID()
    const firstSessionId = randomUUID()
    const secondSessionId = randomUUID()
    const firstSessionToken = `phase7-tag-first-${randomUUID()}`
    const secondSessionToken = `phase7-tag-second-${randomUUID()}`
    await insertCredentialUser({ id: firstActorId, role: 'ADMIN' })
    await insertCredentialUser({ id: secondActorId, role: 'ADMIN' })
    await withExecutionRole('nihongo_auth_gateway', () =>
      client.query(
        `SELECT * FROM "phase7_issue_v1_session"(
          $1, 1, 'ADMIN', 'ACTIVE', $2, $3,
          '127.0.0.1', 'phase7-tag-first', false
        )`,
        [firstActorId, firstSessionId, firstSessionToken]
      )
    )
    await withExecutionRole('nihongo_auth_gateway', () =>
      client.query(
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
      throw new Error('Phase 7 Tag mutex fixtures are unavailable.')
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
        throw new Error('Phase 7 Tag mutex operation is unavailable.')
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
          `Phase 7 Tag mutex ${discriminator} ${versionId}`,
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
          "phase7_admin_audit_content_digest"(
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
      await targetClient.query(`SELECT "phase7_finish_admin_operation"($1)`, [
        fixture.operationId
      ])
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
    try {
      const concurrentBackend = await concurrentClient.query<{ pid: number }>(
        `SELECT pg_backend_pid() AS pid`
      )
      const concurrentBackendPid = concurrentBackend.rows[0]?.pid
      if (!concurrentBackendPid) {
        throw new Error('Phase 7 Tag mutex backend PID is unavailable.')
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
        throw new Error('Phase 7 second Tag mutex fixture is unavailable.')
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
        throw new Error('Phase 7 primary Tag mutex backend PID is unavailable.')
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
            deltaCount: number
            intentCount: number
            label: string
            normalizedName: string
            versionTagCount: number
          }>(
            `SELECT tag."label", tag."normalizedName",
               (SELECT COUNT(*)::int FROM "QuestionVersionTag"
                WHERE "questionVersionId" = ANY($1::uuid[]))
                 AS "versionTagCount",
               (SELECT COUNT(*)::int FROM "Phase7OperationIntent"
                WHERE "operationId" = ANY($2::uuid[])) AS "intentCount",
               (SELECT COUNT(*)::int FROM "Phase7OperationDelta"
                WHERE "operationId" = ANY($2::uuid[])) AS "deltaCount",
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
          deltaCount: 0,
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
      const updateDelta = await client.query<{
        afterRowVersion: number
        afterState: string
        beforeRowVersion: number
        beforeState: string
        changedFields: string[]
      }>(
        `SELECT delta."fromState" AS "beforeState",
           delta."toState" AS "afterState",
           delta."beforeRowVersion", delta."afterRowVersion",
           "phase7_question_version_changed_fields"(
             delta."beforeSnapshot", delta."afterSnapshot"
           ) AS "changedFields"
         FROM "Phase7OperationDelta" AS delta
         WHERE delta."operationId" = $1
           AND delta."entityType" = 'QUESTION_VERSION'
           AND delta."targetId" = $2`,
        [updateOperationRow.operationId, firstFixture.versionId]
      )
      const updateDeltaRow = updateDelta.rows[0]
      expect(updateDeltaRow).toMatchObject({
        afterRowVersion: 2,
        afterState: 'DRAFT',
        beforeRowVersion: 1,
        beforeState: 'DRAFT',
        changedFields: ['TAGS']
      })
      if (!updateDeltaRow) {
        throw new Error('Phase 7 Tag update delta is unavailable.')
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
          "phase7_admin_audit_content_digest"(
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
      await client.query(`SELECT "phase7_finish_admin_operation"($1)`, [
        updateOperationRow.operationId
      ])
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
      throw new Error('Phase 7 Tag manifest mismatch fixture is unavailable.')
    }
    const nonManifestTagRequestId = randomUUID()
    let nonManifestTagOperationId = ''
    await expectFailedTransaction(async () => {
      await client.query(`SET LOCAL ROLE "nihongo_app"`)
      const operation = await beginAdminOperation(client, {
        command: 'QUESTION_VERSION_UPDATE',
        referencedUserIds: [firstActorId],
        requestId: nonManifestTagRequestId,
        sessionToken: firstSessionToken,
        targetManifest: {
          questions: [
            { id: firstFixture.questionId, rowVersion: 1, state: 'ACTIVE' }
          ],
          reports: [],
          tags: [tagB.id, tagC.id].toSorted(),
          versions: [
            { id: firstFixture.versionId, rowVersion: 2, state: 'DRAFT' }
          ]
        }
      })
      nonManifestTagOperationId = operation.operationId
      await insertVersionTag(client, firstFixture.versionId, tagA)
      await client.query(`SELECT "phase7_finish_admin_operation"($1)`, [
        operation.operationId
      ])
    }, '23514')
    expect(nonManifestTagOperationId).not.toBe('')
    expect(
      (
        await client.query<{
          auditCount: number
          extraTagCount: number
          intentCount: number
          rowVersion: number
        }>(
          `SELECT version."rowVersion",
             (SELECT COUNT(*)::int FROM "QuestionVersionTag"
              WHERE "questionVersionId" = $1 AND "tagId" = $2)
                AS "extraTagCount",
             (SELECT COUNT(*)::int FROM "AdminAuditLog"
              WHERE "operationId" = $3) AS "auditCount",
             (SELECT COUNT(*)::int FROM "Phase7OperationIntent"
              WHERE "operationId" = $3) AS "intentCount"
           FROM "QuestionVersion" AS version WHERE version."id" = $1`,
          [firstFixture.versionId, tagA.id, nonManifestTagOperationId]
        )
      ).rows
    ).toEqual([
      { auditCount: 0, extraTagCount: 0, intentCount: 0, rowVersion: 2 }
    ])

    const unusedManifestTagRequestId = randomUUID()
    const unusedManifestTagMutation = `unused-manifest-${randomUUID()}`
    let unusedManifestTagOperationId = ''
    await expectFailedTransaction(async () => {
      await client.query(`SET LOCAL ROLE "nihongo_app"`)
      const operation = await beginAdminOperation(client, {
        command: 'QUESTION_VERSION_UPDATE',
        referencedUserIds: [firstActorId],
        requestId: unusedManifestTagRequestId,
        sessionToken: firstSessionToken,
        targetManifest: {
          questions: [
            { id: firstFixture.questionId, rowVersion: 1, state: 'ACTIVE' }
          ],
          reports: [],
          tags: [tagA.id, tagB.id, tagC.id].toSorted(),
          versions: [
            { id: firstFixture.versionId, rowVersion: 2, state: 'DRAFT' }
          ]
        }
      })
      unusedManifestTagOperationId = operation.operationId
      await client.query(
        `UPDATE "QuestionVersion"
         SET "explanationKo" = COALESCE("explanationKo", '') || $3,
             "rowVersion" = 3, "updatedAt" = $2
         WHERE "id" = $1`,
        [
          firstFixture.versionId,
          operation.occurredAt,
          unusedManifestTagMutation
        ]
      )
      await client.query('RESET ROLE')
      const delta = await client.query<{
        afterRowVersion: number
        afterState: string
        beforeRowVersion: number
        beforeState: string
        changedFields: string[]
      }>(
        `SELECT delta."fromState" AS "beforeState",
           delta."toState" AS "afterState",
           delta."beforeRowVersion", delta."afterRowVersion",
           "phase7_question_version_changed_fields"(
             delta."beforeSnapshot", delta."afterSnapshot"
           ) AS "changedFields"
         FROM "Phase7OperationDelta" AS delta
         WHERE delta."operationId" = $1
           AND delta."entityType" = 'QUESTION_VERSION'
           AND delta."targetId" = $2`,
        [operation.operationId, firstFixture.versionId]
      )
      const deltaRow = delta.rows[0]
      if (!deltaRow) {
        throw new Error('Phase 7 Tag mismatch delta is unavailable.')
      }
      await client.query(`SET LOCAL ROLE "nihongo_app"`)
      expect(deltaRow).toMatchObject({
        afterRowVersion: 3,
        afterState: 'DRAFT',
        beforeRowVersion: 2,
        beforeState: 'DRAFT',
        changedFields: ['EXPLANATION_KO']
      })
      const changedFields = JSON.stringify(deltaRow.changedFields)
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
          "phase7_admin_audit_content_digest"(
            $8, 'QUESTION_VERSION_UPDATE', 'QUESTION_VERSION', $1,
            $3::TEXT, $4::TEXT, $5, $6, $7::jsonb,
            '{"kind":"NONE_V1"}'::jsonb
          ), $8, $9, 'TEST', $10
        )`,
        [
          firstFixture.versionId,
          operation.actorUserId,
          deltaRow.beforeState,
          deltaRow.afterState,
          deltaRow.beforeRowVersion,
          deltaRow.afterRowVersion,
          changedFields,
          operation.operationId,
          unusedManifestTagRequestId,
          operation.occurredAt
        ]
      )
      await client.query(`SELECT "phase7_finish_admin_operation"($1)`, [
        operation.operationId
      ])
    }, '23514')
    expect(unusedManifestTagOperationId).not.toBe('')
    expect(
      (
        await client.query<{
          auditCount: number
          contentMutationCount: number
          extraTagCount: number
          intentCount: number
          rowVersion: number
        }>(
          `SELECT version."rowVersion",
             CASE WHEN POSITION($4 IN COALESCE(version."explanationKo", '')) > 0
               THEN 1 ELSE 0 END AS "contentMutationCount",
             (SELECT COUNT(*)::int FROM "QuestionVersionTag"
              WHERE "questionVersionId" = $1 AND "tagId" = $2)
                AS "extraTagCount",
             (SELECT COUNT(*)::int FROM "AdminAuditLog"
              WHERE "operationId" = $3) AS "auditCount",
             (SELECT COUNT(*)::int FROM "Phase7OperationIntent"
              WHERE "operationId" = $3) AS "intentCount"
           FROM "QuestionVersion" AS version WHERE version."id" = $1`,
          [
            firstFixture.versionId,
            tagA.id,
            unusedManifestTagOperationId,
            unusedManifestTagMutation
          ]
        )
      ).rows
    ).toEqual([
      {
        auditCount: 0,
        contentMutationCount: 0,
        extraTagCount: 0,
        intentCount: 0,
        rowVersion: 2
      }
    ])

    if (!secondFixture) {
      throw new Error('Phase 7 reciprocal review fixture is unavailable.')
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
          "phase7_admin_audit_content_digest"(
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
      await targetClient.query(`SELECT "phase7_finish_admin_operation"($1)`, [
        transition.operation.operationId
      ])
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

    const reciprocalClient = new Client({
      connectionString: connectionUrl.toString(),
      options: createPostgresStartupOptions(schema)
    })
    let primaryApprovalOpen = false
    let reciprocalApprovalOpen = false
    let reciprocalBegin: ReturnType<typeof beginAdminOperation> | undefined
    await reciprocalClient.connect()
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
          "phase7_admin_audit_content_digest"(
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
      await client.query(`SELECT "phase7_finish_admin_operation"($1)`, [
        archiveOperation.operationId
      ])
      await client.query('COMMIT')
    } catch (error: unknown) {
      await client.query('ROLLBACK')
      throw error
    }

    const freshFirstSessionToken = `phase7-tag-authority-${randomUUID()}`
    await withExecutionRole('nihongo_auth_gateway', () =>
      client.query(
        `SELECT * FROM "phase7_issue_v1_session"(
          $1, 1, 'ADMIN', 'ACTIVE', $2, $3,
          '127.0.0.1', 'phase7-tag-authority', false
        )`,
        [firstActorId, randomUUID(), freshFirstSessionToken]
      )
    )
    const authorityClient = new Client({
      connectionString: connectionUrl.toString(),
      options: createPostgresStartupOptions(schema)
    })
    let publicationLockOpen = false
    let authorityChange: Promise<unknown> | undefined
    await authorityClient.connect()
    try {
      await authorityClient.query(`SET ROLE "nihongo_auth_gateway"`)
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
      authorityChange = authorityClient.query(
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
      const begun = await client.query<{
        actorUserId: string
        operationId: string
      }>(
        `SELECT * FROM "phase7_begin_admin_operation"(
          'PUBLICATION', $1, $2, 'TEST', $3::uuid[]
        )`,
        [
          freshFirstSessionToken,
          postAuthorityPublicationRequestId,
          [firstActorId, secondActorId].toSorted()
        ]
      )
      const operation = begun.rows[0]
      if (!operation) {
        throw new Error('Post-authority publication operation is unavailable.')
      }
      postAuthorityPublicationOperationId = operation.operationId
      const armed = await client.query<{ occurredAt: Date }>(
        `SELECT "phase7_arm_admin_operation"($1, $2::jsonb)
           AS "occurredAt"`,
        [
          operation.operationId,
          JSON.stringify({
            questions: [
              { id: firstFixture.questionId, rowVersion: 1, state: 'ACTIVE' }
            ],
            reports: [],
            tags: [],
            versions: [
              { id: firstFixture.versionId, rowVersion: 4, state: 'APPROVED' }
            ]
          })
        ]
      )
      const occurredAt = armed.rows[0]?.occurredAt
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
          "phase7_admin_audit_content_digest"(
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
      await client.query(`SELECT "phase7_finish_admin_operation"($1)`, [
        operation.operationId
      ])
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
             (SELECT COUNT(*)::int FROM "Phase7OperationIntent"
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
      await withExecutionRole('nihongo_erasure_worker', () =>
        client.query(`SELECT "phase7_erase_user"($1, 'TEST')`, [actorId])
      )
    }
  }, 90_000)

  it('admin command별 isolation matrix와 실패 write 0을 고정한다', async () => {
    const sessionId = randomUUID()
    const sessionToken = `phase7-repeatable-read-${randomUUID()}`
    const requestIds: string[] = []
    await insertCredentialUser({ id: repeatableReadActorId, role: 'ADMIN' })
    await expect(
      withExecutionRole('nihongo_auth_gateway', () =>
        client.query(
          `SELECT * FROM "phase7_issue_v1_session"(
            $1, 1, 'ADMIN', 'ACTIVE', $2, $3,
            '127.0.0.1', 'phase7-repeatable-read', false
          )`,
          [repeatableReadActorId, sessionId, sessionToken]
        )
      )
    ).resolves.toMatchObject({ rows: [{ id: sessionId }] })

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
        const operation = client.query(
          `SELECT * FROM "phase7_begin_admin_operation"(
            $1::"AdminAuditCommand", $2, $3, 'TEST', $4::uuid[]
          )`,
          [command, sessionToken, requestId, [repeatableReadActorId]]
        )
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
      throw new Error('Phase 7 target manifest fixtures are unavailable.')
    }
    const expectArmRejected = async (input: {
      code: string
      command: 'QUESTION_CREATE' | 'QUESTION_VERSION_UPDATE'
      manifest: unknown
    }): Promise<void> => {
      const requestId = randomUUID()
      requestIds.push(requestId)
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE')
      try {
        await client.query(`SET LOCAL ROLE "nihongo_app"`)
        const begun = await client.query<{ operationId: string }>(
          `SELECT * FROM "phase7_begin_admin_operation"(
            $1::"AdminAuditCommand", $2, $3, 'TEST', $4::uuid[]
          )`,
          [input.command, sessionToken, requestId, [repeatableReadActorId]]
        )
        const operationId = begun.rows[0]?.operationId
        if (!operationId) {
          throw new Error('Phase 7 manifest-negative operation is unavailable.')
        }
        await expect(
          client.query(`SELECT "phase7_arm_admin_operation"($1, $2::jsonb)`, [
            operationId,
            JSON.stringify(input.manifest)
          ])
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
    } satisfies Phase7AdminTargetManifest
    const emptyReferenceRequestId = randomUUID()
    requestIds.push(emptyReferenceRequestId)
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE')
    try {
      await client.query(`SET LOCAL ROLE "nihongo_app"`)
      await expect(
        client.query(
          `SELECT * FROM "phase7_begin_admin_operation"(
            'QUESTION_CREATE', $1, $2, 'TEST', ARRAY[]::uuid[]
          )`,
          [sessionToken, emptyReferenceRequestId]
        )
      ).rejects.toMatchObject({ code: '22023' })
    } finally {
      await client.query('ROLLBACK')
    }
    await expectArmRejected({
      code: '22023',
      command: 'QUESTION_CREATE',
      manifest: null
    })
    await expectArmRejected({
      code: '22023',
      command: 'QUESTION_CREATE',
      manifest: { questions: [], reports: [], tags: [manifestTag.id] }
    })
    await expectArmRejected({
      code: '22023',
      command: 'QUESTION_CREATE',
      manifest: {
        ...closedEmptyManifest,
        unexpected: true
      }
    })
    await expectArmRejected({
      code: '22023',
      command: 'QUESTION_CREATE',
      manifest: {
        ...closedEmptyManifest,
        tags: [manifestTag.id],
        versions: [{ id: manifestTag.id, rowVersion: '1', state: 'DRAFT' }]
      }
    })
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
    await client.query('BEGIN')
    try {
      await client.query(`SET LOCAL ROLE "nihongo_app"`)
      await expect(
        client.query(`SELECT "phase7_arm_admin_operation"($1, $2::jsonb)`, [
          randomUUID(),
          JSON.stringify(closedEmptyManifest)
        ])
      ).rejects.toMatchObject({ code: '42501' })
    } finally {
      await client.query('ROLLBACK')
    }

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
      const begun = await client.query<{ operationId: string }>(
        `SELECT * FROM "phase7_begin_admin_operation"(
          'EXPORT', $1, $2, 'TEST', $3::uuid[]
        )`,
        [sessionToken, exportRequestId, [repeatableReadActorId]]
      )
      const operationId = begun.rows[0]?.operationId
      if (!operationId) {
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
      } satisfies Phase7AdminTargetManifest
      await expect(
        client.query(`SELECT "phase7_arm_admin_operation"($1, $2::jsonb)`, [
          operationId,
          JSON.stringify(exportManifest)
        ])
      ).resolves.toMatchObject({ rowCount: 1 })
      await client.query('RESET ROLE')
      const storedManifest = await client.query<{
        manifestBytes: number
        versionCount: number
      }>(
        `SELECT pg_column_size("targetManifest")::int AS "manifestBytes",
           jsonb_array_length("targetManifest"->'versions')::int
             AS "versionCount"
         FROM "Phase7OperationIntent" WHERE "operationId" = $1`,
        [operationId]
      )
      expect(storedManifest.rows).toEqual([
        expect.objectContaining({
          manifestBytes: expect.any(Number),
          versionCount: 513
        })
      ])
      expect(storedManifest.rows[0]?.manifestBytes).toBeLessThanOrEqual(
        8 * 1024 * 1024
      )
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
          'Phase 7 import Tag ' || fixture.ordinality,
          'phase7-import-' || replace(fixture.id::text, '-', ''),
          clock_timestamp(), clock_timestamp()
        FROM unnest($1::uuid[]) WITH ORDINALITY AS fixture(id, ordinality)`,
        [importTagIds]
      )
      await client.query(`SET LOCAL ROLE "nihongo_app"`)
      const begun = await client.query<{ operationId: string }>(
        `SELECT * FROM "phase7_begin_admin_operation"(
          'IMPORT_APPLY', $1, $2, 'TEST', $3::uuid[]
        )`,
        [sessionToken, importRequestId, [repeatableReadActorId]]
      )
      const operationId = begun.rows[0]?.operationId
      if (!operationId) {
        throw new Error('Phase 7 257-Tag IMPORT operation is unavailable.')
      }
      await expect(
        client.query(`SELECT "phase7_arm_admin_operation"($1, $2::jsonb)`, [
          operationId,
          JSON.stringify({
            questions: [],
            reports: [],
            tags: importTagIds.toSorted(),
            versions: []
          } satisfies Phase7AdminTargetManifest)
        ])
      ).resolves.toMatchObject({ rowCount: 1 })
    } finally {
      await client.query('ROLLBACK')
    }
    expect(
      (
        await client.query<{ auditCount: number; intentCount: number }>(
          `SELECT
             (SELECT COUNT(*)::int FROM "Phase7OperationIntent"
              WHERE "requestId" = ANY($1::uuid[])) AS "intentCount",
             (SELECT COUNT(*)::int FROM "AdminAuditLog"
              WHERE "requestId" = ANY($1::uuid[])) AS "auditCount"`,
          [requestIds]
        )
      ).rows
    ).toEqual([{ auditCount: 0, intentCount: 0 }])
    await expect(
      withExecutionRole('nihongo_erasure_worker', () =>
        client.query(`SELECT "phase7_erase_user"($1, 'TEST') AS erased`, [
          repeatableReadActorId
        ])
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
    const operationSessionId = randomUUID()
    const operationSessionToken = `phase7-operation-${randomUUID()}`
    const wrongAuthorId = randomUUID()
    const wrongAuthorSessionId = randomUUID()
    const wrongAuthorSessionToken = `phase7-wrong-author-${randomUUID()}`
    const spoofFamilyId = randomUUID()
    const spoofSessionId = randomUUID()
    const spoofSessionToken = `phase7-spoof-${randomUUID()}`
    const appSpoofFamilyId = randomUUID()
    const wrongRoleSessionId = randomUUID()
    const wrongRoleSessionToken = `phase7-wrong-role-${randomUUID()}`
    await insertCredentialUser({ id: actorId, role: 'ADMIN' })
    await insertCredentialUser({ id: wrongAuthorId, role: 'ADMIN' })

    await expectFailedTransaction(async () => {
      await client.query(`SET LOCAL app.phase7_auth_issue = 'on'`)
      await client.query(`SET LOCAL app.phase7_auth_remember = 'true'`)
      await client.query(
        `INSERT INTO "AuthSessionFamily" ("id", "userId") VALUES ($1, $2)`,
        [spoofFamilyId, actorId]
      )
      await client.query(
        `INSERT INTO "Session" (
            "id", "expiresAt", "token", "createdAt", "updatedAt",
            "userId", "sessionFamilyId", "authorityGeneration",
            "issuerProtocolVersion"
          ) VALUES (
            $1, clock_timestamp() + INTERVAL '1 day', $2,
            clock_timestamp(), clock_timestamp(), $3, $4, 1, 'PHASE7_V1'
          )`,
        [spoofSessionId, spoofSessionToken, actorId, spoofFamilyId]
      )
    }, '42501')
    expect(
      (
        await client.query<{
          familyCount: number
          sessionCount: number
          trustedExecutionCount: number
        }>(
          `SELECT
            (SELECT COUNT(*)::int FROM "AuthSessionFamily" WHERE "id" = $1)
              AS "familyCount",
            (SELECT COUNT(*)::int FROM "Session"
              WHERE "id" = $2 OR "token" = $3) AS "sessionCount",
            (SELECT COUNT(*)::int FROM "Phase7TrustedExecution")
              AS "trustedExecutionCount"`,
          [spoofFamilyId, spoofSessionId, spoofSessionToken]
        )
      ).rows
    ).toEqual([{ familyCount: 0, sessionCount: 0, trustedExecutionCount: 0 }])
    await expectFailedTransaction(async () => {
      await client.query(`SET LOCAL ROLE "nihongo_app"`)
      await client.query(`SET LOCAL app.phase7_auth_issue = 'on'`)
      await client.query(
        `INSERT INTO "AuthSessionFamily" ("id", "userId") VALUES ($1, $2)`,
        [appSpoofFamilyId, actorId]
      )
    }, '42501')
    await expectFailedTransaction(async () => {
      await client.query(`SET LOCAL ROLE "nihongo_app"`)
      await client.query(
        `SELECT * FROM "phase7_issue_v1_session"(
          $1, 1, 'ADMIN', 'ACTIVE', $2, $3,
          '127.0.0.1', 'phase7-wrong-role', false
        )`,
        [actorId, wrongRoleSessionId, wrongRoleSessionToken]
      )
    }, '42501')
    expect(
      (
        await client.query<{ familyCount: number; sessionCount: number }>(
          `SELECT
            (SELECT COUNT(*)::int FROM "AuthSessionFamily" WHERE "id" = $1)
              AS "familyCount",
            (SELECT COUNT(*)::int FROM "Session"
             WHERE "id" = $2 OR "token" = $3) AS "sessionCount"`,
          [appSpoofFamilyId, wrongRoleSessionId, wrongRoleSessionToken]
        )
      ).rows
    ).toEqual([{ familyCount: 0, sessionCount: 0 }])

    const issued = await withExecutionRole('nihongo_auth_gateway', () =>
      client.query<{
        authorityGeneration: number
        createdAt: Date
        expiresAt: Date
        familyId: string
        id: string
      }>(
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
      withExecutionRole('nihongo_auth_gateway', () =>
        client.query(`SELECT "phase7_owned_sign_out"($1) AS signed_out`, [
          sessionToken
        ])
      )
    ).resolves.toMatchObject({ rows: [{ signed_out: true }] })

    const familyAfterSignOut = await client.query<{
      sessionCount: number
      status: string
    }>(
      `SELECT family."status"::text AS status,
         (SELECT COUNT(*)::int FROM "Session"
          WHERE "sessionFamilyId" = family."id") AS "sessionCount"
       FROM "AuthSessionFamily" AS family
       WHERE family."id" = $1`,
      [issued.rows[0]!.familyId]
    )
    expect(familyAfterSignOut.rows).toEqual([
      { sessionCount: 0, status: 'REVOKED' }
    ])
    const operationSession = await withExecutionRole(
      'nihongo_auth_gateway',
      () =>
        client.query<{
          authorityGeneration: number
          id: string
        }>(
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
      withExecutionRole('nihongo_auth_gateway', () =>
        client.query(
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
      throw new Error('Phase 7 authored question fixture is unavailable.')
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
          `Phase 7 authored ${questionId}`,
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
            `Phase 7 authored option ${index + 1} ${questionId}`,
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
          "phase7_admin_audit_content_digest"(
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
      await client.query(`SELECT "phase7_finish_admin_operation"($1)`, [
        operationRow.operationId
      ])
      await client.query('COMMIT')
    } catch (error: unknown) {
      await client.query('ROLLBACK')
      throw error
    }

    const originalVersion = await client.query<{
      questionText: string
      rowVersion: number
    }>(
      `SELECT "questionText", "rowVersion" FROM "QuestionVersion"
       WHERE "id" = $1`,
      [versionId]
    )
    const originalVersionRow = originalVersion.rows[0]
    if (!originalVersionRow) {
      throw new Error('Authored QuestionVersion fixture was not committed.')
    }

    const expectVersionUpdateRejected = async (input: {
      code: string
      sessionToken: string
      timestampOffsetSeconds: number
    }): Promise<void> => {
      await expectFailedTransaction(async () => {
        await client.query(`SET LOCAL ROLE "nihongo_app"`)
        const requestId = randomUUID()
        const operationRow = await beginAdminOperation(client, {
          command: 'QUESTION_VERSION_UPDATE',
          referencedUserIds:
            input.sessionToken === wrongAuthorSessionToken
              ? [wrongAuthorId, actorId]
              : [actorId],
          requestId,
          sessionToken: input.sessionToken,
          targetManifest: {
            questions: [{ id: questionId, rowVersion: 1, state: 'ACTIVE' }],
            reports: [],
            tags: [selectedTag.id],
            versions: [{ id: versionId, rowVersion: 1, state: 'DRAFT' }]
          }
        })
        await client.query(
          `UPDATE "QuestionVersion"
           SET "questionText" = $2,
               "rowVersion" = "rowVersion" + 1,
               "updatedAt" = (
                 $3::timestamptz + ($4 * INTERVAL '1 second')
               )::timestamp
           WHERE "id" = $1`,
          [
            versionId,
            `${originalVersionRow.questionText} rejected ${randomUUID()}`,
            operationRow.occurredAt,
            input.timestampOffsetSeconds
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
            'QUESTION_VERSION_UPDATE', 'QUESTION_VERSION', $1, 'ACCOUNT',
            $2, $2, 'ADMIN', 'ACTIVE_ADMIN', 'DRAFT', 'DRAFT', 1, 2,
            '["QUESTION_TEXT"]'::jsonb, '{"kind":"NONE_V1"}'::jsonb,
            "phase7_admin_audit_content_digest"(
              $3, 'QUESTION_VERSION_UPDATE', 'QUESTION_VERSION', $1,
              'DRAFT', 'DRAFT', 1, 2, '["QUESTION_TEXT"]'::jsonb,
              '{"kind":"NONE_V1"}'::jsonb
            ), $3, $4, 'TEST', $5
          )`,
          [
            versionId,
            operationRow.actorUserId,
            operationRow.operationId,
            requestId,
            operationRow.occurredAt
          ]
        )
        await client.query(`SELECT "phase7_finish_admin_operation"($1)`, [
          operationRow.operationId
        ])
      }, input.code)
      expect(
        (
          await client.query<{
            auditCount: number
            questionText: string
            rowVersion: number
          }>(
            `SELECT version."questionText", version."rowVersion",
              (SELECT COUNT(*)::int FROM "AdminAuditLog"
               WHERE "command" = 'QUESTION_VERSION_UPDATE'
                 AND "targetId" = $1) AS "auditCount"
             FROM "QuestionVersion" AS version WHERE version."id" = $1`,
            [versionId]
          )
        ).rows
      ).toEqual([{ auditCount: 0, ...originalVersionRow }])
    }

    await expectVersionUpdateRejected({
      code: '42501',
      sessionToken: wrongAuthorSessionToken,
      timestampOffsetSeconds: 0
    })
    await expectVersionUpdateRejected({
      code: '23514',
      sessionToken: operationSessionToken,
      timestampOffsetSeconds: 1
    })

    const legacySeed = buildAllQuestionSeeds()[0]
    if (!legacySeed)
      throw new Error('Legacy retirement fixture is unavailable.')
    let wrongReasonOperationId = ''
    await expectFailedTransaction(async () => {
      await client.query(`SET LOCAL ROLE "nihongo_app"`)
      const requestId = randomUUID()
      const operationRow = await beginAdminOperation(client, {
        command: 'RETIREMENT',
        referencedUserIds: [actorId],
        requestId,
        sessionToken: operationSessionToken,
        targetManifest: {
          questions: [
            { id: legacySeed.questionId, rowVersion: 1, state: 'ACTIVE' }
          ],
          reports: [],
          tags: [],
          versions: [
            { id: legacySeed.versionId, rowVersion: 1, state: 'PUBLISHED' }
          ]
        }
      })
      wrongReasonOperationId = operationRow.operationId
      await client.query(
        `UPDATE "Question"
         SET "currentPublishedVersionId" = NULL,
             "rowVersion" = "rowVersion" + 1,
             "updatedAt" = $2
         WHERE "id" = $1`,
        [legacySeed.questionId, operationRow.occurredAt]
      )
      await client.query(
        `UPDATE "QuestionVersion"
         SET "status" = 'RETIRED',
             "retirementKind" = 'PUBLISHED_RETIREMENT',
             "retiredAt" = $2,
             "rowVersion" = "rowVersion" + 1,
             "updatedAt" = $2
         WHERE "id" = $1`,
        [legacySeed.versionId, operationRow.occurredAt]
      )
      await client.query(
        `INSERT INTO "ContentReview" (
          "questionId", "questionVersionId", "action", "fromState",
          "toState", "actorKind", "actorUserId", "actorId", "actorRole",
          "actorLabel", "reason", "operationId", "requestId", "occurredAt"
        ) VALUES (
          $1, $2, 'RETIRED', 'PUBLISHED', 'RETIRED', 'ACCOUNT',
          $3, $3, 'ADMIN', 'ACTIVE_ADMIN', 'PUBLISHED_REPLACEMENT',
          $4, $5, $6
        )`,
        [
          legacySeed.questionId,
          legacySeed.versionId,
          operationRow.actorUserId,
          operationRow.operationId,
          requestId,
          operationRow.occurredAt
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
          'RETIREMENT', 'QUESTION_VERSION', $1, 'ACCOUNT',
          $2, $2, 'ADMIN', 'ACTIVE_ADMIN', 'PUBLISHED', 'RETIRED', 1, 2,
          '["VERSION_STATUS","CURRENT_PUBLISHED_VERSION_ID"]'::jsonb,
          '{"kind":"NONE_V1"}'::jsonb,
          "phase7_admin_audit_content_digest"(
            $3, 'RETIREMENT', 'QUESTION_VERSION', $1,
            'PUBLISHED', 'RETIRED', 1, 2,
            '["VERSION_STATUS","CURRENT_PUBLISHED_VERSION_ID"]'::jsonb,
            '{"kind":"NONE_V1"}'::jsonb
          ), $3, $4, 'TEST', $5
        )`,
        [
          legacySeed.versionId,
          operationRow.actorUserId,
          operationRow.operationId,
          requestId,
          operationRow.occurredAt
        ]
      )
      await client.query(`SELECT "phase7_finish_admin_operation"($1)`, [
        operationRow.operationId
      ])
    }, '23514')
    expect(wrongReasonOperationId).not.toBe('')
    expect(
      (
        await client.query<{
          auditCount: number
          currentPublishedVersionId: string
          reviewCount: number
          rowVersion: number
          status: string
        }>(
          `SELECT question."currentPublishedVersionId"::text
              AS "currentPublishedVersionId",
            version."status"::text AS status,
            version."rowVersion",
            (SELECT COUNT(*)::int FROM "ContentReview"
             WHERE "operationId" = $3) AS "reviewCount",
            (SELECT COUNT(*)::int FROM "AdminAuditLog"
             WHERE "operationId" = $3) AS "auditCount"
           FROM "Question" AS question
           JOIN "QuestionVersion" AS version
             ON version."questionId" = question."id"
           WHERE question."id" = $1 AND version."id" = $2`,
          [legacySeed.questionId, legacySeed.versionId, wrongReasonOperationId]
        )
      ).rows
    ).toEqual([
      {
        auditCount: 0,
        currentPublishedVersionId: legacySeed.versionId,
        reviewCount: 0,
        rowVersion: 1,
        status: 'PUBLISHED'
      }
    ])

    const missingCapabilityReportId = randomUUID()
    await expectFailedTransaction(async () => {
      await client.query(`SET LOCAL ROLE "nihongo_phase7_migration"`)
      await client.query(`DELETE FROM "Phase7DatabaseCapability"`)
      await client.query(`RESET ROLE`)
      await client.query(`SET LOCAL ROLE "nihongo_app"`)
      await client.query(
        `SELECT * FROM "phase7_create_question_report"(
          $1, $2, $3, $4, 'TYPO_OR_GRAMMAR', $5
        )`,
        [
          operationSessionToken,
          missingCapabilityReportId,
          legacySeed.questionId,
          legacySeed.versionId,
          'Phase 7 capability-negative report'
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
        client.query(
          `SELECT * FROM "phase7_create_question_report"(
            $1, $2, $3, $4, 'TYPO_OR_GRAMMAR', $5
          )`,
          [
            operationSessionToken,
            reportId,
            legacySeed.questionId,
            legacySeed.versionId,
            'Phase 7 owned report'
          ]
        )
      )
    ).resolves.toMatchObject({ rows: [{ id: reportId, rowVersion: 1 }] })

    const delayedReportSessionId = randomUUID()
    const delayedReportSessionToken = `phase7-delayed-report-${randomUUID()}`
    const delayedReportId = randomUUID()
    await expect(
      withExecutionRole('nihongo_auth_gateway', () =>
        client.query(
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
      delayedReportPromise = delayedClient.query(
        `SELECT * FROM "phase7_create_question_report"(
          $1, $2, $3, $4, 'TYPO_OR_GRAMMAR', $5
        )`,
        [
          delayedReportSessionToken,
          delayedReportId,
          legacySeed.questionId,
          legacySeed.versionId,
          'Phase 7 delayed-lock report'
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
            (SELECT COUNT(*)::int FROM "Phase7TrustedExecution")
              AS "trustedExecutionCount"`,
          [delayedReportId]
        )
      ).rows
    ).toEqual([{ reportCount: 0, trustedExecutionCount: 0 }])

    await expect(
      withExecutionRole('nihongo_erasure_worker', () =>
        client.query(`SELECT "phase7_erase_user"($1, 'TEST') AS erased`, [
          wrongAuthorId
        ])
      )
    ).resolves.toMatchObject({ rows: [{ erased: true }] })

    await expectFailedTransaction(async () => {
      await client.query(`SET LOCAL app.phase7_erasure_mode = 'on'`)
      await client.query(
        `UPDATE "QuestionVersion"
           SET "createdByUserId" = NULL,
               "createdByLabelSnapshot" = 'DELETED_ADMIN',
               "rowVersion" = "rowVersion" + 1,
               "updatedAt" = clock_timestamp()
           WHERE "id" = $1`,
        [versionId]
      )
    }, '23514')

    await expectFailedTransaction(async () => {
      await client.query(`SET LOCAL app.phase7_erasure_mode = 'on'`)
      await client.query('DELETE FROM "User" WHERE "id" = $1', [actorId])
    }, '42501')
    await expect(
      client.query(`SELECT "phase7_erase_user"($1, 'TEST')`, [actorId])
    ).rejects.toMatchObject({ code: '42501' })
    await expectFailedTransaction(async () => {
      await client.query(`SET LOCAL ROLE "nihongo_auth_gateway"`)
      await client.query(`SELECT "phase7_erase_user"($1, 'TEST')`, [actorId])
    }, '42501')
    await expectFailedTransaction(async () => {
      await client.query(
        `SELECT "phase7_open_trusted_execution"('ERASURE', $1, NULL)`,
        [actorId]
      )
      await client.query(`SELECT "phase7_close_trusted_execution"($1)`, [
        randomUUID()
      ])
    }, '42501')
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
            (SELECT COUNT(*)::int FROM "Phase7OperationIntent")
              AS "operationIntentCount",
            (SELECT COUNT(*)::int FROM "Phase7TrustedExecution")
              AS "trustedExecutionCount"`,
          [actorId]
        )
      ).rows
    ).toEqual([
      { operationIntentCount: 0, trustedExecutionCount: 0, userCount: 1 }
    ])
    await expect(
      withExecutionRole('nihongo_erasure_worker', () =>
        client.query(`SELECT "phase7_erase_user"($1, 'TEST') AS erased`, [
          actorId
        ])
      )
    ).resolves.toMatchObject({ rows: [{ erased: true }] })
    const erased = await client.query<{
      auditCount: number
      familyCount: number
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
        (SELECT COUNT(*)::int FROM "AuthSessionFamily" WHERE "userId" = $1)
          AS "familyCount",
        (SELECT COUNT(*)::int FROM "Phase7OperationIntent")
          AS "operationIntentCount",
        (SELECT COUNT(*)::int FROM "Phase7TrustedExecution")
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
        familyCount: 0,
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
    const sessionToken = `phase7-report-triage-${randomUUID()}`
    const reportId = randomUUID()
    const seed = buildAllQuestionSeeds()[0]
    if (!seed) throw new Error('Phase 7 report triage target is unavailable.')
    await insertCredentialUser({ id: actorId, role: 'ADMIN' })
    await insertCredentialUser({ id: injectedAssigneeId, role: 'ADMIN' })
    await withExecutionRole('nihongo_auth_gateway', () =>
      client.query(
        `SELECT * FROM "phase7_issue_v1_session"(
          $1, 1, 'ADMIN', 'ACTIVE', $2, $3,
          '127.0.0.1', 'phase7-report-triage', false
        )`,
        [actorId, sessionId, sessionToken]
      )
    )
    await withExecutionRole('nihongo_app', () =>
      client.query(
        `SELECT * FROM "phase7_create_question_report"(
          $1, $2, $3, $4, 'ANSWER_ERROR', $5
        )`,
        [
          sessionToken,
          reportId,
          seed.questionId,
          seed.versionId,
          'Phase 7 self-triage integration report'
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
        throw new Error('Phase 7 report erasure backend is unavailable.')
      }
      await erasureClient.query(`SET ROLE "nihongo_erasure_worker"`)

      await client.query('BEGIN')
      triageTransactionOpen = true
      await client.query(`SET LOCAL ROLE "nihongo_app"`)
      const requestId = randomUUID()
      const begun = await client.query<{ operationId: string }>(
        `SELECT * FROM "phase7_begin_admin_operation"(
          'REPORT_TRIAGE', $1, $2, 'TEST', $3::uuid[]
        )`,
        [sessionToken, requestId, [actorId, injectedAssigneeId].toSorted()]
      )
      const operationId = begun.rows[0]?.operationId
      if (!operationId) {
        throw new Error('Phase 7 injected-assignee operation is unavailable.')
      }
      erasurePromise = erasureClient.query(
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
        client.query(`SELECT "phase7_arm_admin_operation"($1, $2::jsonb)`, [
          operationId,
          JSON.stringify({
            questions: [
              { id: seed.questionId, rowVersion: 1, state: 'ACTIVE' }
            ],
            reports: [{ id: reportId, rowVersion: 1, state: 'OPEN' }],
            tags: [],
            versions: [
              { id: seed.versionId, rowVersion: 1, state: 'PUBLISHED' }
            ]
          } satisfies Phase7AdminTargetManifest)
        ])
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
          "phase7_admin_audit_content_digest"(
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
      await client.query(`SELECT "phase7_finish_admin_operation"($1)`, [
        operation.operationId
      ])
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
          "phase7_admin_audit_content_digest"(
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
      await client.query(`SELECT "phase7_finish_admin_operation"($1)`, [
        operation.operationId
      ])
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
    await withExecutionRole('nihongo_erasure_worker', () =>
      client.query(`SELECT "phase7_erase_user"($1, 'TEST')`, [actorId])
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
      throw new Error('Phase 7 report redaction target is unavailable.')
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
          `Phase 7 remediation v2 ${remediationVersionId}`,
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
            `Phase 7 remediation option ${index + 1}`,
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
         SET "contentFingerprint" = "phase7_question_version_fingerprint"("id")
         WHERE "id" = $1`,
        [remediationVersionId]
      )
    } finally {
      await client.query(`SET session_replication_role = origin`)
    }
    await insertCredentialUser({ id: actorId, role: 'ADMIN' })
    await withExecutionRole('nihongo_auth_gateway', () =>
      client.query(
        `SELECT * FROM "phase7_issue_v1_session"(
          $1, 1, 'ADMIN', 'ACTIVE', $2, $3,
          '127.0.0.1', 'phase7-report-redaction', false
        )`,
        [actorId, sessionId, sessionToken]
      )
    )
    for (const [reportId, reason, description] of [
      [matureReportId, 'ANSWER_ERROR', 'Phase 7 mature report description'],
      [
        prematureReportId,
        'EXPLANATION_ERROR',
        'Phase 7 premature report description'
      ],
      [openReportId, 'TYPO_OR_GRAMMAR', 'Phase 7 open report description']
    ] as const) {
      await withExecutionRole('nihongo_app', () =>
        client.query(
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
      throw new Error('Phase 7 report redaction snapshots are unavailable.')
    }

    await expect(
      withExecutionRole('nihongo_app', () =>
        client.query(
          `SELECT "phase7_redact_expired_report_descriptions"(100, 'TEST')`
        )
      )
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      withExecutionRole('nihongo_erasure_worker', () =>
        client.query(
          `SELECT "phase7_redact_expired_report_descriptions"(0, 'TEST')`
        )
      )
    ).rejects.toMatchObject({ code: '22023' })
    await expectFailedTransaction(async () => {
      await client.query(`SET LOCAL ROLE "nihongo_app"`)
      await client.query(
        `UPDATE "QuestionReport"
         SET "description" = NULL, "rowVersion" = "rowVersion" + 1,
             "updatedAt" = clock_timestamp()
         WHERE "id" = $1`,
        [matureReportId]
      )
    }, '42501')
    await expectFailedTransaction(async () => {
      await client.query(`SET LOCAL ROLE "nihongo_phase7_owner"`)
      const execution = await client.query<{ id: string }>(
        `SELECT "phase7_open_trusted_execution"(
          'REPORT_REDACTION', NULL, NULL
        ) AS id`
      )
      const executionId = execution.rows[0]?.id
      if (!executionId) {
        throw new Error('Phase 7 report redaction execution is unavailable.')
      }
      const event = await client.query<{ createdAt: Date }>(
        `SELECT "createdAt" FROM "Phase7TrustedExecution" WHERE "id" = $1`,
        [executionId]
      )
      const eventTime = event.rows[0]?.createdAt
      if (!eventTime) {
        throw new Error('Phase 7 report redaction event time is unavailable.')
      }
      await client.query(
        `UPDATE "QuestionReport"
         SET "description" = NULL,
             "resolutionReason" = 'FORBIDDEN_EXTRA_FIELD',
             "rowVersion" = "rowVersion" + 1, "updatedAt" = $2
         WHERE "id" = $1`,
        [matureReportId, eventTime]
      )
    }, '23514')

    await expect(
      withExecutionRole('nihongo_erasure_worker', () =>
        client.query<{ redacted: number }>(
          `SELECT "phase7_redact_expired_report_descriptions"(
            100, 'TEST'
          ) AS redacted`
        )
      )
    ).resolves.toMatchObject({ rows: [{ redacted: 1 }] })
    await expect(
      withExecutionRole('nihongo_erasure_worker', () =>
        client.query<{ redacted: number }>(
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
         (SELECT COUNT(*)::int FROM "Phase7TrustedExecution")
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
    await withExecutionRole('nihongo_erasure_worker', () =>
      client.query(`SELECT "phase7_erase_user"($1, 'TEST')`, [actorId])
    )
  }, 60_000)

  it('QUESTION_ARCHIVE는 모든 open candidate 상태를 exact abandonment evidence로 종료한다', async () => {
    const actorId = randomUUID()
    const sessionId = randomUUID()
    const sessionToken = `phase7-archive-${randomUUID()}`
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
    if (!selectedTag) throw new Error('Phase 7 archive tag is unavailable.')
    await insertCredentialUser({ id: actorId, role: 'ADMIN' })
    await withExecutionRole('nihongo_auth_gateway', () =>
      client.query(
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
            `Phase 7 archive ${state} ${questionId}`,
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
              `Phase 7 archive ${state} option ${index + 1}`,
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
            "phase7_admin_audit_content_digest"(
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
        await client.query(`SELECT "phase7_finish_admin_operation"($1)`, [
          operation.operationId
        ])
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
      throw new Error('Phase 7 archive 0/0 fixture is missing.')
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

    const archiveCandidates = candidates.slice(0, -1)
    const concurrentCandidate = candidates.at(-1)
    const firstCandidate = archiveCandidates[0]
    const secondCandidate = archiveCandidates[1]
    if (!firstCandidate || !secondCandidate || !concurrentCandidate) {
      throw new Error('Phase 7 archive guard fixtures are missing.')
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
      targetManifest: Phase7AdminTargetManifest,
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
    ): Phase7AdminTargetManifestItem => ({
      id: questionId,
      rowVersion,
      state: 'ACTIVE'
    })
    const versionManifest = (
      candidate: ArchiveCandidate
    ): Phase7AdminTargetManifestItem => ({
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
             SELECT intent."requestId" FROM "Phase7OperationIntent" AS intent
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

    interface ArchiveVerifierDelta {
      readonly afterRowVersion: number
      readonly beforeRowVersion: number
      readonly entityType: 'QUESTION' | 'QUESTION_VERSION'
      readonly fromState: string
      readonly questionId: string
      readonly targetId: string
      readonly toState: string
    }
    const archiveQuestionDelta = (
      questionId: string
    ): ArchiveVerifierDelta => ({
      afterRowVersion: 2,
      beforeRowVersion: 1,
      entityType: 'QUESTION',
      fromState: 'ACTIVE',
      questionId,
      targetId: questionId,
      toState: 'ARCHIVED'
    })
    const archiveVersionDelta = (
      candidate: ArchiveCandidate,
      questionId = candidate.questionId
    ): ArchiveVerifierDelta => ({
      afterRowVersion: 2,
      beforeRowVersion: 1,
      entityType: 'QUESTION_VERSION',
      fromState: candidate.state,
      questionId,
      targetId: candidate.versionId,
      toState: 'RETIRED'
    })
    const expectArchiveVerifier = async (input: {
      accepted: boolean
      deltas: readonly ArchiveVerifierDelta[]
      targetManifest: Phase7AdminTargetManifest
    }): Promise<void> => {
      const operationId = randomUUID()
      await client.query('BEGIN')
      try {
        await client.query(`SET LOCAL session_replication_role = replica`)
        await client.query(
          `INSERT INTO "Phase7OperationIntent" (
             "operationId", "requestId", "command", "referencedUserIds",
             "targetManifest", "requiresFresh", "environment", "occurredAt",
             "backendPid", "transactionId"
           ) VALUES (
             $1, $2, 'QUESTION_ARCHIVE', ARRAY[]::uuid[], $3::jsonb,
             false, 'TEST', clock_timestamp(), pg_backend_pid(), txid_current()
           )`,
          [operationId, randomUUID(), JSON.stringify(input.targetManifest)]
        )
        for (const delta of input.deltas) {
          await client.query(
            `INSERT INTO "Phase7OperationDelta" (
               "operationId", "entityType", "targetId", "questionId",
               "mutation", "fromState", "toState", "beforeRowVersion",
               "afterRowVersion"
             ) VALUES ($1, $2, $3, $4, 'UPDATE', $5, $6, $7, $8)`,
            [
              operationId,
              delta.entityType,
              delta.targetId,
              delta.questionId,
              delta.fromState,
              delta.toState,
              delta.beforeRowVersion,
              delta.afterRowVersion
            ]
          )
        }
        await client.query(`SET LOCAL session_replication_role = origin`)
        const verification = client.query(
          `SELECT "phase7_verify_operation_manifest"($1)`,
          [operationId]
        )
        if (input.accepted) {
          await expect(verification).resolves.toMatchObject({ rowCount: 1 })
        } else {
          await expect(verification).rejects.toMatchObject({ code: '23514' })
        }
      } finally {
        await client.query('ROLLBACK').catch(() => undefined)
      }
      expect(
        (
          await client.query<{ count: number }>(
            `SELECT (
               (SELECT COUNT(*) FROM "Phase7OperationIntent"
                WHERE "operationId" = $1) +
               (SELECT COUNT(*) FROM "Phase7OperationDelta"
                WHERE "operationId" = $1) +
               (SELECT COUNT(*) FROM "ContentReview"
                WHERE "operationId" = $1) +
               (SELECT COUNT(*) FROM "AdminAuditLog"
                WHERE "operationId" = $1)
             )::int AS count`,
            [operationId]
          )
        ).rows[0]?.count
      ).toBe(0)
    }

    const emptyManifest: Phase7AdminTargetManifest = {
      questions: [questionManifest(emptyManifestTarget.questionId)],
      reports: [],
      tags: [],
      versions: []
    }
    const candidateManifest: Phase7AdminTargetManifest = {
      questions: [questionManifest(firstCandidate.questionId)],
      reports: [],
      tags: [],
      versions: [versionManifest(firstCandidate)]
    }
    const emptyQuestionDelta = archiveQuestionDelta(
      emptyManifestTarget.questionId
    )
    const candidateQuestionDelta = archiveQuestionDelta(
      firstCandidate.questionId
    )
    const candidateVersionDelta = archiveVersionDelta(firstCandidate)
    await expectArchiveVerifier({
      accepted: true,
      deltas: [emptyQuestionDelta],
      targetManifest: emptyManifest
    })
    await expectArchiveVerifier({
      accepted: false,
      deltas: [
        emptyQuestionDelta,
        {
          afterRowVersion: 3,
          beforeRowVersion: 2,
          entityType: 'QUESTION_VERSION',
          fromState: 'RETIRED',
          questionId: emptyManifestTarget.questionId,
          targetId: emptyManifestTarget.versionId,
          toState: 'RETIRED'
        }
      ],
      targetManifest: emptyManifest
    })
    await expectArchiveVerifier({
      accepted: true,
      deltas: [candidateQuestionDelta, candidateVersionDelta],
      targetManifest: candidateManifest
    })
    await expectArchiveVerifier({
      accepted: false,
      deltas: [candidateVersionDelta],
      targetManifest: candidateManifest
    })
    await expectArchiveVerifier({
      accepted: false,
      deltas: [candidateQuestionDelta],
      targetManifest: candidateManifest
    })
    await expectArchiveVerifier({
      accepted: false,
      deltas: [
        candidateQuestionDelta,
        candidateVersionDelta,
        {
          ...archiveVersionDelta(secondCandidate, firstCandidate.questionId),
          targetId: randomUUID()
        }
      ],
      targetManifest: candidateManifest
    })
    await expectArchiveVerifier({
      accepted: false,
      deltas: [
        candidateQuestionDelta,
        archiveVersionDelta(firstCandidate, secondCandidate.questionId)
      ],
      targetManifest: candidateManifest
    })

    const expectArchiveEvidenceCardinalityRejected = async (input: {
      auditCount: 0 | 1 | 2
      deltas: readonly ArchiveVerifierDelta[]
      review: ArchiveCandidate | null
      targetManifest: Phase7AdminTargetManifest
    }): Promise<void> => {
      const operationId = randomUUID()
      const requestId = randomUUID()
      await client.query('BEGIN')
      try {
        await client.query(`SET LOCAL session_replication_role = replica`)
        await client.query(
          `INSERT INTO "Phase7OperationIntent" (
             "operationId", "requestId", "command", "referencedUserIds",
             "targetManifest", "requiresFresh", "environment", "occurredAt",
             "backendPid", "transactionId"
           ) VALUES (
             $1, $2, 'QUESTION_ARCHIVE', ARRAY[]::uuid[], $3::jsonb,
             false, 'TEST', clock_timestamp(), pg_backend_pid(), txid_current()
           )`,
          [operationId, requestId, JSON.stringify(input.targetManifest)]
        )
        for (const delta of input.deltas) {
          await client.query(
            `INSERT INTO "Phase7OperationDelta" (
               "operationId", "entityType", "targetId", "questionId",
               "mutation", "fromState", "toState", "beforeRowVersion",
               "afterRowVersion"
             ) VALUES ($1, $2, $3, $4, 'UPDATE', $5, $6, $7, $8)`,
            [
              operationId,
              delta.entityType,
              delta.targetId,
              delta.questionId,
              delta.fromState,
              delta.toState,
              delta.beforeRowVersion,
              delta.afterRowVersion
            ]
          )
        }
        const hasVersion = input.targetManifest.versions.length > 0
        const metadata = {
          abandonedCandidateCount: hasVersion ? 1 : 0,
          kind: 'QUESTION_ARCHIVE_V1',
          retiredPublishedCount: 0
        }
        for (let index = 0; index < input.auditCount; index += 1) {
          const targetId =
            index === 0 ? input.targetManifest.questions[0]?.id : randomUUID()
          if (!targetId) throw new Error('Archive audit target is missing.')
          const changedFields = hasVersion
            ? ['LIFECYCLE_STATUS', 'VERSION_STATUS']
            : ['LIFECYCLE_STATUS']
          await client.query(
            `INSERT INTO "AdminAuditLog" (
               "command", "targetType", "targetId", "actorKind",
               "actorUserId", "actorId", "actorRole", "actorLabel",
               "beforeState", "afterState", "beforeRowVersion",
               "afterRowVersion", "changedFields", "metadata",
               "contentDigest", "operationId", "requestId", "environment",
               "occurredAt"
             ) VALUES (
               'QUESTION_ARCHIVE', 'QUESTION', $1, 'ACCOUNT', $2, $2,
               'ADMIN', 'ACTIVE_ADMIN', 'ACTIVE', 'ARCHIVED', 1, 2,
               $3::jsonb, $4::jsonb,
               "phase7_admin_audit_content_digest"(
                 $5, 'QUESTION_ARCHIVE', 'QUESTION', $1,
                 'ACTIVE', 'ARCHIVED', 1, 2, $3::jsonb, $4::jsonb
               ), $5, $6, 'TEST', clock_timestamp()
             )`,
            [
              targetId,
              actorId,
              JSON.stringify(changedFields),
              JSON.stringify(metadata),
              operationId,
              requestId
            ]
          )
        }
        if (input.review) {
          await client.query(
            `INSERT INTO "ContentReview" (
               "questionId", "questionVersionId", "action", "fromState",
               "toState", "actorKind", "actorUserId", "actorId",
               "actorRole", "actorLabel", "reason", "operationId",
               "requestId", "occurredAt"
             ) VALUES (
               $1, $2, 'RETIRED', 'PUBLISHED', 'RETIRED', 'ACCOUNT',
               $3, $3, 'ADMIN', 'ACTIVE_ADMIN', 'QUESTION_ARCHIVE',
               $4, $5, clock_timestamp()
             )`,
            [
              input.review.questionId,
              input.review.versionId,
              actorId,
              operationId,
              requestId
            ]
          )
        }
        await client.query(`SET LOCAL session_replication_role = origin`)
        await client.query(`SET LOCAL ROLE "nihongo_app"`)
        await expect(
          client.query(`SELECT "phase7_finish_admin_operation"($1)`, [
            operationId
          ])
        ).rejects.toMatchObject({ code: '23514' })
      } finally {
        await client.query('ROLLBACK').catch(() => undefined)
      }
      expect(
        (
          await client.query<{ count: number }>(
            `SELECT (
               (SELECT COUNT(*) FROM "Phase7OperationIntent"
                WHERE "operationId" = $1) +
               (SELECT COUNT(*) FROM "Phase7OperationDelta"
                WHERE "operationId" = $1) +
               (SELECT COUNT(*) FROM "ContentReview"
                WHERE "operationId" = $1) +
               (SELECT COUNT(*) FROM "AdminAuditLog"
                WHERE "operationId" = $1)
             )::int AS count`,
            [operationId]
          )
        ).rows[0]?.count
      ).toBe(0)
    }
    await expectArchiveEvidenceCardinalityRejected({
      auditCount: 0,
      deltas: [emptyQuestionDelta],
      review: null,
      targetManifest: emptyManifest
    })
    await expectArchiveEvidenceCardinalityRejected({
      auditCount: 2,
      deltas: [emptyQuestionDelta],
      review: null,
      targetManifest: emptyManifest
    })
    await expectArchiveEvidenceCardinalityRejected({
      auditCount: 1,
      deltas: [emptyQuestionDelta],
      review: {
        questionId: emptyManifestTarget.questionId,
        state: 'DRAFT',
        versionId: emptyManifestTarget.versionId
      },
      targetManifest: emptyManifest
    })
    await expectArchiveEvidenceCardinalityRejected({
      auditCount: 1,
      deltas: [candidateQuestionDelta, candidateVersionDelta],
      review: null,
      targetManifest: candidateManifest
    })
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
          "phase7_admin_audit_content_digest"(
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
      await client.query(`SELECT "phase7_finish_admin_operation"($1)`, [
        operation.operationId
      ])
      await client.query('COMMIT')
    } catch (error: unknown) {
      await client.query('ROLLBACK')
      throw error
    }
    if (!emptyArchiveOperationId) {
      throw new Error('Phase 7 archive 0/0 operation is missing.')
    }
    expect(
      (
        await client.query<{
          auditCount: number
          changedFields: string[]
          contentDigestValid: boolean
          currentPublishedVersionId: string | null
          deltaCount: number
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
             audit."contentDigest" = "phase7_admin_audit_content_digest"(
               audit."operationId", audit."command", audit."targetType",
               audit."targetId", audit."beforeState", audit."afterState",
               audit."beforeRowVersion", audit."afterRowVersion",
               audit."changedFields", audit."metadata"
             ) AS "contentDigestValid",
             (SELECT COUNT(*)::int FROM "AdminAuditLog"
              WHERE "operationId" = $3) AS "auditCount",
             (SELECT COUNT(*)::int FROM "ContentReview"
              WHERE "operationId" = $3) AS "reviewCount",
             (SELECT COUNT(*)::int FROM "Phase7OperationIntent"
              WHERE "operationId" = $3) AS "intentCount",
             (SELECT COUNT(*)::int FROM "Phase7OperationDelta"
              WHERE "operationId" = $3) AS "deltaCount"
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
        deltaCount: 0,
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

    await expectFailedTransaction(async () => {
      await client.query(
        `UPDATE "QuestionVersion"
         SET "status" = 'RETIRED',
             "retirementKind" = 'QUESTION_ARCHIVE_ABANDONED',
             "retiredAt" = clock_timestamp(),
             "rowVersion" = "rowVersion" + 1,
             "updatedAt" = clock_timestamp()
         WHERE "id" = $1`,
        [firstCandidate.versionId]
      )
    }, '42501')
    await expectFailedTransaction(async () => {
      await client.query(`SET LOCAL ROLE "nihongo_app"`)
      const requestId = randomUUID()
      const operation = await beginAdminOperation(client, {
        command: 'QUESTION_VERSION_UPDATE',
        referencedUserIds: [actorId],
        requestId,
        sessionToken,
        targetManifest: {
          questions: [
            { id: firstCandidate.questionId, rowVersion: 1, state: 'ACTIVE' }
          ],
          reports: [],
          tags: [selectedTag.id],
          versions: [
            { id: firstCandidate.versionId, rowVersion: 1, state: 'DRAFT' }
          ]
        }
      })
      await client.query(
        `UPDATE "QuestionVersion"
         SET "status" = 'RETIRED',
             "retirementKind" = 'QUESTION_ARCHIVE_ABANDONED',
             "retiredAt" = $2, "rowVersion" = "rowVersion" + 1,
             "updatedAt" = $2
         WHERE "id" = $1`,
        [firstCandidate.versionId, operation.occurredAt]
      )
    }, '23514')

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
            "phase7_admin_audit_content_digest"(
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
        await client.query(`SELECT "phase7_finish_admin_operation"($1)`, [
          operation.operationId
        ])
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
             "phase7_admin_audit_content_digest"(
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
        await databaseClient.query(
          `SELECT "phase7_finish_admin_operation"($1)`,
          [operation.operationId]
        )
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
      throw new Error('Phase 7 archive concurrency outcome is unavailable.')
    }
    const concurrentLoser = concurrentOutcomes[concurrentLoserIndex]
    if (concurrentLoser?.status !== 'rejected') {
      throw new Error('Phase 7 archive concurrency loser is malformed.')
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
             audit."contentDigest" = "phase7_admin_audit_content_digest"(
               audit."operationId", audit."command", audit."targetType",
               audit."targetId", audit."beforeState", audit."afterState",
               audit."beforeRowVersion", audit."afterRowVersion",
               audit."changedFields", audit."metadata"
             ) AS "auditDigestValid",
             (SELECT COUNT(*)::int FROM "AdminAuditLog"
              WHERE "requestId" = $3) AS "auditCount",
             (SELECT COUNT(*)::int FROM "ContentReview"
              WHERE "requestId" = $3) AS "reviewCount",
             (SELECT COUNT(*)::int FROM "Phase7OperationIntent"
              WHERE "requestId" = $3) AS "winnerIntentCount",
             (SELECT COUNT(*)::int FROM "AdminAuditLog"
              WHERE "requestId" = $4) AS "loserAuditCount",
             (SELECT COUNT(*)::int FROM "ContentReview"
              WHERE "requestId" = $4) AS "loserReviewCount",
             (SELECT COUNT(*)::int FROM "Phase7OperationIntent"
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
    await withExecutionRole('nihongo_erasure_worker', () =>
      client.query(`SELECT "phase7_erase_user"($1, 'TEST')`, [actorId])
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
      withExecutionRole('nihongo_auth_gateway', () =>
        client.query(
          `SELECT * FROM "phase7_issue_v1_session"(
            $1, 1, 'ADMIN', 'ACTIVE', $2, $3,
            '127.0.0.1', 'phase7-duplicate-first', false
          )`,
          [firstActorId, firstSessionId, firstSessionToken]
        )
      )
    ).resolves.toMatchObject({ rows: [{ id: firstSessionId }] })
    await expect(
      withExecutionRole('nihongo_auth_gateway', () =>
        client.query(
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
          'Phase 7 concurrent duplicate content', $3,
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
            `Phase 7 concurrent option ${index + 1}`,
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
          "phase7_admin_audit_content_digest"(
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

      await client.query(`SELECT "phase7_finish_admin_operation"($1)`, [
        first.operationId
      ])
      await client.query('COMMIT')
      firstTransactionOpen = false

      try {
        const second = await secondStagePromise
        secondStagePromise = undefined
        loserCompletionPromise = duplicateClient
          .query(`SELECT "phase7_finish_admin_operation"($1)`, [
            second.operationId
          ])
          .then(() => duplicateClient.query('COMMIT'))
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
      await client.query(`SELECT "phase7_finish_admin_operation"($1)`, [
        visibleDuplicate.operationId
      ])
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
            (SELECT COUNT(*)::int FROM "Phase7OperationIntent")
              AS "operationIntentCount",
            (SELECT COUNT(*)::int FROM "Phase7TrustedExecution")
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
        withExecutionRole('nihongo_erasure_worker', () =>
          client.query(`SELECT "phase7_erase_user"($1, 'TEST') AS erased`, [
            actorId
          ])
        )
      ).resolves.toMatchObject({ rows: [{ erased: true }] })
    }
  }, 60_000)

  it('auth cleanup은 captured expired set만 제거하고 동시 신규 발급은 보존한다', async () => {
    const userId = randomUUID()
    const expiredSessionId = randomUUID()
    const freshSessionId = randomUUID()
    const expiredToken = `phase7-expired-cleanup-${randomUUID()}`
    const freshToken = `phase7-fresh-cleanup-${randomUUID()}`
    await insertCredentialUser({ id: userId, role: 'USER' })
    const expiredIssue = await withExecutionRole('nihongo_auth_gateway', () =>
      client.query<{ familyId: string }>(
        `SELECT * FROM "phase7_issue_v1_session"(
          $1, 1, 'USER', 'ACTIVE', $2, $3,
          '127.0.0.1', 'phase7-expired-cleanup', false
        )`,
        [userId, expiredSessionId, expiredToken]
      )
    )
    const expiredFamilyId = expiredIssue.rows[0]?.familyId ?? ''
    expect(expiredFamilyId).not.toBe('')
    await client.query('BEGIN')
    try {
      await client.query(`SET LOCAL session_replication_role = replica`)
      await client.query(
        `UPDATE "Session"
         SET "expiresAt" = clock_timestamp() - INTERVAL '1 minute',
             "createdAt" = clock_timestamp() - INTERVAL '2 minutes',
             "updatedAt" = clock_timestamp() - INTERVAL '2 minutes'
         WHERE "id" = $1`,
        [expiredSessionId]
      )
      await client.query('COMMIT')
    } catch (error: unknown) {
      await client.query('ROLLBACK')
      throw error
    }

    const cleanupClient = new Client({
      connectionString: connectionUrl.toString(),
      options: createPostgresStartupOptions(schema)
    })
    let issuerTransactionOpen = false
    let cleanupPromise: Promise<unknown> | undefined
    let freshFamilyId = ''
    await cleanupClient.connect()
    try {
      const cleanupBackend = await cleanupClient.query<{ pid: number }>(
        `SELECT pg_backend_pid() AS pid`
      )
      const cleanupBackendPid = cleanupBackend.rows[0]?.pid
      if (!cleanupBackendPid) {
        throw new Error('Auth cleanup backend PID is unavailable.')
      }
      await client.query('BEGIN')
      issuerTransactionOpen = true
      await client.query(`SELECT 1 FROM "User" WHERE "id" = $1 FOR UPDATE`, [
        userId
      ])
      await cleanupClient.query(`SET ROLE "nihongo_erasure_worker"`)
      cleanupPromise = cleanupClient.query(
        `SELECT * FROM "phase7_cleanup_expired_auth_state"(1000, 'TEST')`
      )
      let lockObserved = false
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const activity = await client.query<{ waitEventType: string | null }>(
          `SELECT wait_event_type AS "waitEventType"
           FROM pg_stat_activity WHERE pid = $1`,
          [cleanupBackendPid]
        )
        if (activity.rows[0]?.waitEventType === 'Lock') {
          lockObserved = true
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(lockObserved).toBe(true)
      const issued = await withExecutionRole('nihongo_auth_gateway', () =>
        client.query<{ familyId: string }>(
          `SELECT * FROM "phase7_issue_v1_session"(
            $1, 1, 'USER', 'ACTIVE', $2, $3,
            '127.0.0.1', 'phase7-cleanup-race', false
          )`,
          [userId, freshSessionId, freshToken]
        )
      )
      freshFamilyId = issued.rows[0]?.familyId ?? ''
      expect(freshFamilyId).not.toBe('')
      await client.query('COMMIT')
      issuerTransactionOpen = false
      await expect(cleanupPromise).resolves.toMatchObject({
        rows: [
          {
            familiesDeleted: 1,
            fencesDeleted: 0,
            sessionsDeleted: 1
          }
        ]
      })
    } finally {
      if (issuerTransactionOpen) await client.query('ROLLBACK')
      await cleanupPromise?.catch(() => undefined)
      await cleanupClient.query('RESET ROLE').catch(() => undefined)
      await cleanupClient.end()
    }

    expect(
      (
        await client.query<{
          expiredFamilyCount: number
          expiredSessionCount: number
          freshFamilyStatus: string
          freshSessionCount: number
          trustedExecutionCount: number
        }>(
          `SELECT
            (SELECT COUNT(*)::int FROM "Session" WHERE "id" = $1)
              AS "expiredSessionCount",
            (SELECT COUNT(*)::int FROM "AuthSessionFamily" WHERE "id" = $2)
              AS "expiredFamilyCount",
            (SELECT COUNT(*)::int FROM "Session"
             WHERE "id" = $3 AND "token" = $4)
              AS "freshSessionCount",
            (SELECT "status"::text FROM "AuthSessionFamily" WHERE "id" = $5)
              AS "freshFamilyStatus",
            (SELECT COUNT(*)::int FROM "Phase7TrustedExecution")
              AS "trustedExecutionCount"`,
          [
            expiredSessionId,
            expiredFamilyId,
            freshSessionId,
            freshToken,
            freshFamilyId
          ]
        )
      ).rows
    ).toEqual([
      {
        expiredFamilyCount: 0,
        expiredSessionCount: 0,
        freshFamilyStatus: 'ACTIVE',
        freshSessionCount: 1,
        trustedExecutionCount: 0
      }
    ])
    await expect(
      withExecutionRole('nihongo_erasure_worker', () =>
        client.query(`SELECT "phase7_erase_user"($1, 'TEST') AS erased`, [
          userId
        ])
      )
    ).resolves.toMatchObject({ rows: [{ erased: true }] })
  })

  async function runLegacyCompatibility(): Promise<void> {
    expect(
      (
        await legacyClient.query<{ migrationCount: number }>(
          `SELECT COUNT(*)::int AS "migrationCount"
           FROM "_prisma_migrations"
           WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`
        )
      ).rows
    ).toEqual([{ migrationCount: 27 }])
    await expect(
      client.query(
        `SELECT "legacyIssuerDisabled" FROM "AuthIssuerActivation"
         WHERE "id" = 1`
      )
    ).resolves.toMatchObject({ rows: [{ legacyIssuerDisabled: false }] })

    const accountId = randomUUID()
    const sessionId = randomUUID()
    const sessionToken = `phase7-legacy-session-${randomUUID()}`
    const question = await legacyClient.query<{ id: string }>(
      `SELECT "id" FROM "Question" ORDER BY "id" LIMIT 1`
    )
    const questionId = question.rows[0]?.id
    if (!questionId) {
      throw new Error('Legacy learner compatibility question is unavailable.')
    }

    await legacyClient.query('BEGIN')
    try {
      await legacyClient.query(
        `INSERT INTO "User" (
          "id", "name", "email", "emailVerified", "role",
          "targetLevel", "accountStatus", "createdAt", "updatedAt"
        ) VALUES (
          $1, 'Phase 7 legacy learner', $2, true, 'USER',
          'N5', 'ACTIVE', clock_timestamp(), clock_timestamp()
        )`,
        [
          legacyCompatibilityUserId,
          `phase7-legacy-${randomUUID()}@example.test`
        ]
      )
      await legacyClient.query(
        `INSERT INTO "Account" (
          "id", "accountId", "providerId", "userId", "password",
          "createdAt", "updatedAt"
        ) VALUES (
          $1, $2::uuid::text, 'credential', $2,
          'phase7-legacy-password-hash', clock_timestamp(), clock_timestamp()
        )`,
        [accountId, legacyCompatibilityUserId]
      )
      await legacyClient.query(
        `UPDATE "User" SET "targetLevel" = 'N4', "updatedAt" = clock_timestamp()
         WHERE "id" = $1`,
        [legacyCompatibilityUserId]
      )
      await legacyClient.query(
        `INSERT INTO "Bookmark" ("id", "userId", "questionId", "createdAt")
         VALUES ($1, $2, $3, clock_timestamp())`,
        [randomUUID(), legacyCompatibilityUserId, questionId]
      )
      await legacyClient.query(
        `DELETE FROM "Bookmark" WHERE "userId" = $1 AND "questionId" = $2`,
        [legacyCompatibilityUserId, questionId]
      )
      await legacyClient.query(
        `INSERT INTO "Session" (
          "id", "expiresAt", "token", "createdAt", "updatedAt", "userId"
        ) VALUES (
          $1, clock_timestamp() + INTERVAL '1 day', $2,
          clock_timestamp(), clock_timestamp(), $3
        )`,
        [sessionId, sessionToken, legacyCompatibilityUserId]
      )
      expect(
        (
          await legacyClient.query<{
            sessionCount: number
            targetLevel: string
          }>(
            `SELECT "targetLevel"::text AS "targetLevel",
               (SELECT COUNT(*)::int FROM "Session"
                WHERE "id" = $2 AND "token" = $3) AS "sessionCount"
             FROM "User" WHERE "id" = $1`,
            [legacyCompatibilityUserId, sessionId, sessionToken]
          )
        ).rows
      ).toEqual([{ sessionCount: 1, targetLevel: 'N4' }])
      expect(
        (
          await legacyClient.query<{ capped: boolean }>(
            `UPDATE "Session"
             SET "expiresAt" = "createdAt" + INTERVAL '60 days',
                 "updatedAt" = clock_timestamp()
             WHERE "id" = $1
             RETURNING "expiresAt" = "createdAt" + INTERVAL '30 days'
               AS capped`,
            [sessionId]
          )
        ).rows
      ).toEqual([{ capped: true }])
      expect(
        (
          await legacyClient.query<{ id: string }>(
            `DELETE FROM "Session" WHERE "token" = $1 RETURNING "id"`,
            [sessionToken]
          )
        ).rows
      ).toEqual([{ id: sessionId }])
      await legacyClient.query('COMMIT')
    } catch (error: unknown) {
      await legacyClient.query('ROLLBACK')
      throw error
    }
  }

  async function runIssuerActivation(): Promise<void> {
    const readLegacyCutoverState = async (): Promise<{
      canConnect: boolean
      canSelectLedger: boolean
      canSelectUser: boolean
      canUseSchema: boolean
      canUseUserRole: boolean
      legacyIssuerDisabled: boolean
      legacyLedgerPolicyCount: number
    }> => {
      const state = await client.query<{
        canConnect: boolean
        canSelectLedger: boolean
        canSelectUser: boolean
        canUseSchema: boolean
        canUseUserRole: boolean
        legacyIssuerDisabled: boolean
        legacyLedgerPolicyCount: number
      }>(
        `SELECT
           has_database_privilege(
             'nihongo_test_legacy_app_login', current_database(), 'CONNECT'
           ) AS "canConnect",
           has_schema_privilege(
             'nihongo_test_legacy_app_login', current_schema(), 'USAGE'
           ) AS "canUseSchema",
           has_table_privilege(
             'nihongo_test_legacy_app_login',
             format('%I.%I', current_schema(), 'User'), 'SELECT'
           ) AS "canSelectUser",
           has_table_privilege(
             'nihongo_test_legacy_app_login',
             format('%I.%I', current_schema(), '_prisma_migrations'), 'SELECT'
           ) AS "canSelectLedger",
           has_type_privilege(
             'nihongo_test_legacy_app_login',
             format('%I.%I', current_schema(), 'UserRole'), 'USAGE'
           ) AS "canUseUserRole",
           (SELECT "legacyIssuerDisabled" FROM "AuthIssuerActivation"
            WHERE "id" = 1) AS "legacyIssuerDisabled",
           (SELECT COUNT(*)::int FROM pg_policy AS policy
            JOIN pg_class AS ledger ON ledger.oid = policy.polrelid
            JOIN pg_namespace AS namespace ON namespace.oid = ledger.relnamespace
            WHERE namespace.nspname = current_schema()
              AND ledger.relname = '_prisma_migrations'
              AND policy.polname = 'phase7_ledger_legacy_read')
             AS "legacyLedgerPolicyCount"`
      )
      const row = state.rows[0]
      if (!row) throw new Error('Legacy cutover ACL state is unavailable.')
      return row
    }
    const preActivationState = await readLegacyCutoverState()
    expect(preActivationState).toEqual({
      canConnect: true,
      canSelectLedger: true,
      canSelectUser: true,
      canUseSchema: true,
      canUseUserRole: true,
      legacyIssuerDisabled: false,
      legacyLedgerPolicyCount: 1
    })
    await client.query('BEGIN')
    try {
      await client.query(`SET LOCAL ROLE "nihongo_phase7_migration"`)
      await client.query(`SELECT "phase7_activate_v1_issuer"('TEST')`)
      expect(await readLegacyCutoverState()).toEqual({
        canConnect: false,
        canSelectLedger: false,
        canSelectUser: false,
        canUseSchema: false,
        canUseUserRole: false,
        legacyIssuerDisabled: true,
        legacyLedgerPolicyCount: 0
      })
      await client.query('ROLLBACK')
    } catch (error: unknown) {
      await client.query('ROLLBACK')
      throw error
    }
    expect(await readLegacyCutoverState()).toEqual(preActivationState)
    expect(
      (
        await legacyClient.query<{ migrationCount: number }>(
          `SELECT COUNT(*)::int AS "migrationCount"
           FROM "_prisma_migrations"
           WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`
        )
      ).rows
    ).toEqual([{ migrationCount: 27 }])
    await expect(
      legacyClient.query(`SELECT "id" FROM "User" WHERE "id" = $1`, [
        legacyCompatibilityUserId
      ])
    ).resolves.toMatchObject({ rowCount: 1 })

    const observer = new Client({
      connectionString: connectionUrl.toString(),
      options: createPostgresStartupOptions(schema)
    })
    const legacyInsertLoser = new Client({
      connectionString: legacyConnectionUrl.toString(),
      options: createPostgresStartupOptions(legacySchema)
    })
    const legacyPasswordLoser = new Client({
      connectionString: legacyConnectionUrl.toString(),
      options: createPostgresStartupOptions(legacySchema)
    })
    const mainBackend = await client.query<{ pid: number }>(
      `SELECT pg_backend_pid() AS pid`
    )
    const mainBackendPid = mainBackend.rows[0]?.pid
    if (!mainBackendPid) {
      throw new Error('Activation concurrency backend identity is unavailable.')
    }
    const waitForLock = async (pid: number): Promise<void> => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const activity = await observer.query<{ waitEventType: string | null }>(
          `SELECT wait_event_type AS "waitEventType"
           FROM pg_stat_activity WHERE pid = $1`,
          [pid]
        )
        if (activity.rows[0]?.waitEventType === 'Lock') return
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      throw new Error('Activation concurrency lock wait was not observed.')
    }
    await observer.connect()
    await legacyInsertLoser.connect()
    await legacyPasswordLoser.connect()
    try {
      const insertLoserBackend = await legacyInsertLoser.query<{ pid: number }>(
        `SELECT pg_backend_pid() AS pid`
      )
      const passwordLoserBackend = await legacyPasswordLoser.query<{
        pid: number
      }>(`SELECT pg_backend_pid() AS pid`)
      const insertLoserBackendPid = insertLoserBackend.rows[0]?.pid
      const passwordLoserBackendPid = passwordLoserBackend.rows[0]?.pid
      if (!insertLoserBackendPid || !passwordLoserBackendPid) {
        throw new Error('Legacy loser backend identity is unavailable.')
      }

      const signedOutSessionId = randomUUID()
      const signedOutToken = `phase7-legacy-signout-winner-${randomUUID()}`
      const purgedSessionId = randomUUID()
      const purgedToken = `phase7-legacy-purge-winner-${randomUUID()}`
      const purgedVerificationId = randomUUID()
      const rejectedSessionId = randomUUID()
      const rejectedToken = `phase7-activation-reject-${randomUUID()}`
      let activationTransactionOpen = false
      let legacyTransactionOpen = false
      let activationPromise: Promise<unknown> | undefined
      let rejectedLegacyInsert: Promise<unknown> | undefined
      let rejectedLegacyPassword: Promise<unknown> | undefined
      let successfulPasswordUpdatedAt: Date | undefined
      try {
        await legacyClient.query('BEGIN')
        legacyTransactionOpen = true
        await legacyClient.query(
          `INSERT INTO "Session" (
            "id", "expiresAt", "token", "createdAt", "updatedAt", "userId"
          ) VALUES (
            $1, clock_timestamp() + INTERVAL '1 day', $2,
            clock_timestamp(), clock_timestamp(), $3
          )`,
          [signedOutSessionId, signedOutToken, legacyCompatibilityUserId]
        )
        await legacyClient.query(`DELETE FROM "Session" WHERE "id" = $1`, [
          signedOutSessionId
        ])
        await legacyClient.query(
          `INSERT INTO "Session" (
            "id", "expiresAt", "token", "createdAt", "updatedAt", "userId"
          ) VALUES (
            $1, clock_timestamp() + INTERVAL '1 day', $2,
            clock_timestamp(), clock_timestamp(), $3
          )`,
          [purgedSessionId, purgedToken, legacyCompatibilityUserId]
        )
        await legacyClient.query(
          `INSERT INTO "Verification" (
            "id", "identifier", "value", "expiresAt", "createdAt", "updatedAt"
          ) VALUES (
            $1, $2, $3, clock_timestamp() + INTERVAL '1 day',
            clock_timestamp(), clock_timestamp()
          )`,
          [
            purgedVerificationId,
            `phase7-legacy-${legacyCompatibilityUserId}`,
            `phase7-legacy-verification-${randomUUID()}`
          ]
        )
        const passwordUpdate = await legacyClient.query<{
          password: string
          updatedAt: Date
        }>(
          `UPDATE "Account"
           SET "password" = 'phase7-legacy-race-winner-hash',
               "updatedAt" = clock_timestamp()
           WHERE "userId" = $1 AND "providerId" = 'credential'
           RETURNING "password", "updatedAt"`,
          [legacyCompatibilityUserId]
        )
        successfulPasswordUpdatedAt = passwordUpdate.rows[0]?.updatedAt
        expect(passwordUpdate.rows).toEqual([
          {
            password: 'phase7-legacy-race-winner-hash',
            updatedAt: successfulPasswordUpdatedAt
          }
        ])

        await client.query('BEGIN')
        activationTransactionOpen = true
        await client.query(`SET LOCAL ROLE "nihongo_phase7_migration"`)
        activationPromise = client.query(
          `SELECT "phase7_activate_v1_issuer"('TEST')`
        )
        await waitForLock(mainBackendPid)
        await legacyClient.query('COMMIT')
        legacyTransactionOpen = false
        await expect(activationPromise).resolves.toBeDefined()

        rejectedLegacyInsert = legacyInsertLoser.query(
          `INSERT INTO "Session" (
            "id", "expiresAt", "token", "createdAt", "updatedAt", "userId"
          ) VALUES (
            $1, clock_timestamp() + INTERVAL '1 day', $2,
            clock_timestamp(), clock_timestamp(), $3
          )`,
          [rejectedSessionId, rejectedToken, legacyCompatibilityUserId]
        )
        void rejectedLegacyInsert.catch(() => undefined)
        rejectedLegacyPassword = legacyPasswordLoser.query(
          `UPDATE "Account"
           SET "password" = 'phase7-legacy-race-loser-hash',
               "updatedAt" = clock_timestamp()
           WHERE "userId" = $1 AND "providerId" = 'credential'`,
          [legacyCompatibilityUserId]
        )
        void rejectedLegacyPassword.catch(() => undefined)
        await Promise.all([
          waitForLock(insertLoserBackendPid),
          waitForLock(passwordLoserBackendPid)
        ])
        await client.query('COMMIT')
        activationTransactionOpen = false
        await expect(rejectedLegacyInsert).rejects.toMatchObject({
          code: '42501'
        })
        await expect(rejectedLegacyPassword).rejects.toMatchObject({
          code: '42501'
        })
      } finally {
        if (legacyTransactionOpen) {
          await legacyClient.query('ROLLBACK').catch(() => undefined)
        }
        if (activationTransactionOpen) {
          await client.query('ROLLBACK').catch(() => undefined)
        }
        await activationPromise?.catch(() => undefined)
        await rejectedLegacyInsert?.catch(() => undefined)
        await rejectedLegacyPassword?.catch(() => undefined)
      }
      if (!successfulPasswordUpdatedAt) {
        throw new Error('Legacy password winner timestamp is unavailable.')
      }
      expect(
        (
          await client.query<{
            password: string
            sessionCount: number
            updatedAt: Date
            verificationCount: number
          }>(
            `SELECT credential."password", credential."updatedAt",
               (SELECT COUNT(*)::int FROM "Session"
                WHERE "id" IN ($2, $3, $4)) AS "sessionCount",
               (SELECT COUNT(*)::int FROM "Verification"
                WHERE "id" = $5) AS "verificationCount"
             FROM "Account" AS credential
             WHERE credential."userId" = $1
               AND credential."providerId" = 'credential'`,
            [
              legacyCompatibilityUserId,
              signedOutSessionId,
              purgedSessionId,
              rejectedSessionId,
              purgedVerificationId
            ]
          )
        ).rows
      ).toEqual([
        {
          password: 'phase7-legacy-race-winner-hash',
          sessionCount: 0,
          updatedAt: successfulPasswordUpdatedAt,
          verificationCount: 0
        }
      ])
    } finally {
      await legacyInsertLoser.end().catch(() => undefined)
      await legacyPasswordLoser.end().catch(() => undefined)
      await observer.end()
    }
    await expect(
      client.query(
        `SELECT "legacyIssuerDisabled" FROM "AuthIssuerActivation" WHERE "id" = 1`
      )
    ).resolves.toMatchObject({ rows: [{ legacyIssuerDisabled: true }] })
    await expect(
      legacyClient.query(`SELECT COUNT(*)::int AS count FROM "User"`)
    ).rejects.toMatchObject({ code: '42P01' })
    await expect(
      legacyClient.query(
        `SELECT COUNT(*)::int AS count FROM "_prisma_migrations"`
      )
    ).rejects.toMatchObject({ code: '42P01' })
    expect(
      (
        await client.query<{
          canConnect: boolean
          canSelectLedger: boolean
          canSelectUser: boolean
          canUseSchema: boolean
          canUseUserRole: boolean
        }>(
          `SELECT
             has_database_privilege(
               'nihongo_test_legacy_app_login', current_database(), 'CONNECT'
             ) AS "canConnect",
             has_schema_privilege(
               'nihongo_test_legacy_app_login', current_schema(), 'USAGE'
             ) AS "canUseSchema",
             has_table_privilege(
               'nihongo_test_legacy_app_login',
               format('%I.%I', current_schema(), 'User'), 'SELECT'
             ) AS "canSelectUser",
             has_table_privilege(
               'nihongo_test_legacy_app_login',
               format('%I.%I', current_schema(), '_prisma_migrations'), 'SELECT'
             ) AS "canSelectLedger",
             has_type_privilege(
               'nihongo_test_legacy_app_login',
               format('%I.%I', current_schema(), 'UserRole'), 'USAGE'
             ) AS "canUseUserRole"`
        )
      ).rows
    ).toEqual([
      {
        canConnect: false,
        canSelectLedger: false,
        canSelectUser: false,
        canUseSchema: false,
        canUseUserRole: false
      }
    ])

    const signupUserId = randomUUID()
    const signupAccountId = randomUUID()
    const signupSessionId = randomUUID()
    const signupSessionToken = `phase7-signup-session-${randomUUID()}`
    const signupEmail = `phase7-signup-${randomUUID()}@example.test`
    await expect(
      withExecutionRole('nihongo_auth_gateway', () =>
        client.query(
          `SELECT * FROM "phase7_sign_up_credential"(
            $1, $2, $3, 'Phase 7 Signup', 'N4', $4
          )`,
          [signupUserId, signupAccountId, signupEmail, 'phase7-signup-hash']
        )
      )
    ).resolves.toMatchObject({
      rows: [{ email: signupEmail, userId: signupUserId }]
    })
    await expect(
      withExecutionRole('nihongo_auth_gateway', () =>
        client.query(
          `SELECT * FROM "phase7_resolve_email_verification_subject"($1)`,
          [signupEmail]
        )
      )
    ).resolves.toMatchObject({
      rows: [
        {
          email: signupEmail,
          emailVerified: false,
          name: 'Phase 7 Signup',
          userId: signupUserId
        }
      ]
    })
    await expect(
      withExecutionRole('nihongo_auth_gateway', () =>
        client.query(
          `SELECT * FROM "phase7_resolve_email_verification_subject"($1)`,
          [`phase7-unknown-${randomUUID()}@example.test`]
        )
      )
    ).resolves.toMatchObject({ rowCount: 0, rows: [] })
    await expect(
      withExecutionRole('nihongo_auth_gateway', () =>
        client.query(`SELECT "phase7_verify_email"($1, $2) AS verified`, [
          signupUserId,
          signupEmail
        ])
      )
    ).resolves.toMatchObject({ rows: [{ verified: true }] })
    await expect(
      withExecutionRole('nihongo_auth_gateway', () =>
        client.query(`SELECT * FROM "phase7_resolve_sign_in_credential"($1)`, [
          signupEmail
        ])
      )
    ).resolves.toMatchObject({
      rows: [
        {
          accountStatus: 'ACTIVE',
          authorityGeneration: 1,
          emailVerified: true,
          passwordHash: 'phase7-signup-hash',
          role: 'USER',
          userId: signupUserId
        }
      ]
    })
    await expect(
      withExecutionRole('nihongo_auth_gateway', () =>
        client.query(`SELECT * FROM "phase7_resolve_sign_in_credential"($1)`, [
          `phase7-unknown-${randomUUID()}@example.test`
        ])
      )
    ).resolves.toMatchObject({ rowCount: 0, rows: [] })
    await expect(
      withExecutionRole('nihongo_auth_gateway', () =>
        client.query(
          `SELECT * FROM "phase7_issue_v1_session"(
            $1, 1, 'USER', 'ACTIVE', $2, $3,
            '127.0.0.1', 'phase7-signup-session', false
          )`,
          [signupUserId, signupSessionId, signupSessionToken]
        )
      )
    ).resolves.toMatchObject({ rows: [{ id: signupSessionId }] })
    await expect(
      withExecutionRole('nihongo_auth_gateway', () =>
        client.query(
          `SELECT "phase7_confirm_v1_session_issuance"(
            $1, $2, $3, 1, 'USER', 'ACTIVE'
          ) AS confirmed`,
          [signupSessionToken, signupSessionId, signupUserId]
        )
      )
    ).resolves.toMatchObject({ rows: [{ confirmed: true }] })
    const mismatchedIssuanceProofs: ReadonlyArray<
      readonly [string, string, string, number, string, string]
    > = [
      [
        `phase7-wrong-token-${randomUUID()}`,
        signupSessionId,
        signupUserId,
        1,
        'USER',
        'ACTIVE'
      ],
      [signupSessionToken, randomUUID(), signupUserId, 1, 'USER', 'ACTIVE'],
      [signupSessionToken, signupSessionId, randomUUID(), 1, 'USER', 'ACTIVE'],
      [signupSessionToken, signupSessionId, signupUserId, 2, 'USER', 'ACTIVE'],
      [signupSessionToken, signupSessionId, signupUserId, 1, 'ADMIN', 'ACTIVE'],
      [
        signupSessionToken,
        signupSessionId,
        signupUserId,
        1,
        'USER',
        'DELETION_PENDING'
      ]
    ]
    for (const proof of mismatchedIssuanceProofs) {
      await expect(
        withExecutionRole('nihongo_auth_gateway', () =>
          client.query(
            `SELECT "phase7_confirm_v1_session_issuance"(
              $1, $2, $3, $4, $5::"UserRole", $6::"UserAccountStatus"
            ) AS confirmed`,
            [...proof]
          )
        )
      ).resolves.toMatchObject({ rows: [{ confirmed: false }] })
    }
    await expect(
      withExecutionRole('nihongo_app', () =>
        client.query(
          `SELECT "phase7_confirm_v1_session_issuance"(
            $1, $2, $3, 1, 'USER', 'ACTIVE'
          )`,
          [signupSessionToken, signupSessionId, signupUserId]
        )
      )
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      withExecutionRole('nihongo_app', () =>
        client.query(`SELECT * FROM "phase7_resolve_v1_principal"($1)`, [
          signupSessionToken
        ])
      )
    ).resolves.toMatchObject({
      rows: [
        {
          role: 'USER',
          sessionId: signupSessionId,
          targetLevel: 'N4',
          userId: signupUserId
        }
      ]
    })
    await expect(
      withExecutionRole('nihongo_app', () =>
        client.query(`SELECT * FROM "phase7_resolve_v1_principal"($1)`, [
          `phase7-unknown-${randomUUID()}`
        ])
      )
    ).resolves.toMatchObject({ rowCount: 0, rows: [] })
    await expect(
      withExecutionRole('nihongo_auth_gateway', () =>
        client.query(`SELECT * FROM "phase7_resolve_session_credential"($1)`, [
          signupSessionToken
        ])
      )
    ).resolves.toMatchObject({
      rows: [
        {
          accountStatus: 'ACTIVE',
          authorityGeneration: 1,
          passwordHash: 'phase7-signup-hash',
          role: 'USER',
          userId: signupUserId
        }
      ]
    })
    await expect(
      withExecutionRole('nihongo_auth_gateway', () =>
        client.query(`SELECT * FROM "phase7_resolve_session_credential"($1)`, [
          `phase7-unknown-${randomUUID()}`
        ])
      )
    ).resolves.toMatchObject({ rowCount: 0, rows: [] })
    await expect(
      withExecutionRole('nihongo_auth_gateway', () =>
        client.query(`SELECT "phase7_change_password"($1, $2, $3) AS changed`, [
          signupUserId,
          'phase7-signup-hash',
          'phase7-forbidden-hash'
        ])
      )
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      withExecutionRole('nihongo_auth_gateway', () =>
        client.query(
          `SELECT "phase7_change_password_v1"($1, $2, $3) AS changed`,
          [signupSessionToken, 'phase7-signup-hash', 'phase7-signup-new-hash']
        )
      )
    ).resolves.toMatchObject({ rows: [{ changed: true }] })
    await expect(
      withExecutionRole('nihongo_app', () =>
        client.query(`SELECT * FROM "phase7_resolve_v1_principal"($1)`, [
          signupSessionToken
        ])
      )
    ).resolves.toMatchObject({ rowCount: 0, rows: [] })
    expect(
      (
        await client.query<{
          authorityGeneration: number
          password: string
          sessionCount: number
        }>(
          `SELECT target_user."authorityGeneration", credential."password",
             (SELECT COUNT(*)::int FROM "Session" WHERE "userId" = $1)
               AS "sessionCount"
           FROM "User" AS target_user
           JOIN "Account" AS credential
             ON credential."userId" = target_user."id"
            AND credential."providerId" = 'credential'
           WHERE target_user."id" = $1`,
          [signupUserId]
        )
      ).rows
    ).toEqual([
      {
        authorityGeneration: 2,
        password: 'phase7-signup-new-hash',
        sessionCount: 0
      }
    ])

    const reauthUserId = randomUUID()
    const oldSessionId = randomUUID()
    const oldSessionToken = `phase7-reauth-old-${randomUUID()}`
    const replacementSessionId = oldSessionId
    await insertCredentialUser({ id: reauthUserId, role: 'ADMIN' })
    const oldSession = await withExecutionRole('nihongo_auth_gateway', () =>
      client.query<{ familyId: string }>(
        `SELECT * FROM "phase7_issue_v1_session"(
          $1, 1, 'ADMIN', 'ACTIVE', $2, $3,
          '127.0.0.1', 'phase7-reauth-old', false
        )`,
        [reauthUserId, oldSessionId, oldSessionToken]
      )
    )
    const reauthFamilyId = oldSession.rows[0]?.familyId
    if (!reauthFamilyId) {
      throw new Error('Reauthentication family fixture is unavailable.')
    }
    await expectFailedTransaction(async () => {
      await client.query(`SET LOCAL ROLE "nihongo_auth_gateway"`)
      await client.query(
        `SELECT * FROM "phase7_reauthenticate_v1_session"(
          $1, 1, 'ADMIN', 'ACTIVE', $2, $3,
          '127.0.0.1', 'phase7-retired-prototype', $4, $5, 'TEST'
        )`,
        [
          oldSessionToken,
          randomUUID(),
          `phase7-retired-prototype-${randomUUID()}`,
          randomUUID(),
          randomUUID()
        ]
      )
    }, '42501')
    expect(
      (
        await client.query<{
          activeSessionCount: number
          familyStatus: string
        }>(
          `SELECT family."status"::text AS "familyStatus",
             (SELECT COUNT(*)::int FROM "Session"
              WHERE "id" = $2 AND "authorizationState" = 'ACTIVE')
                AS "activeSessionCount"
           FROM "AuthSessionFamily" AS family WHERE family."id" = $1`,
          [reauthFamilyId, oldSessionId]
        )
      ).rows
    ).toEqual([
      {
        activeSessionCount: 1,
        familyStatus: 'ACTIVE'
      }
    ])

    const mismatchUserId = randomUUID()
    const mismatchSessionId = randomUUID()
    const mismatchSessionToken = `phase7-fence-mismatch-${randomUUID()}`
    const alternateSessionId = randomUUID()
    const alternateSessionToken = `phase7-fence-alternate-${randomUUID()}`
    await insertCredentialUser({ id: mismatchUserId, role: 'USER' })
    const mismatchSession = await withExecutionRole(
      'nihongo_auth_gateway',
      () =>
        client.query<{ familyId: string }>(
          `SELECT * FROM "phase7_issue_v1_session"(
            $1, 1, 'USER', 'ACTIVE', $2, $3,
            '127.0.0.1', 'phase7-fence-mismatch', false
          )`,
          [mismatchUserId, mismatchSessionId, mismatchSessionToken]
        )
    )
    const alternateSession = await withExecutionRole(
      'nihongo_auth_gateway',
      () =>
        client.query<{ familyId: string }>(
          `SELECT * FROM "phase7_issue_v1_session"(
            $1, 1, 'ADMIN', 'ACTIVE', $2, $3,
            '127.0.0.1', 'phase7-fence-alternate', false
          )`,
          [reauthUserId, alternateSessionId, alternateSessionToken]
        )
    )
    const mismatchFamilyId = mismatchSession.rows[0]?.familyId
    const alternateFamilyId = alternateSession.rows[0]?.familyId
    if (!mismatchFamilyId || !alternateFamilyId) {
      throw new Error(
        'Rotation fence negative Session fixtures are unavailable.'
      )
    }
    const invalidFenceOperationIds: string[] = []
    const expectInvalidFenceCommit = async (input: {
      mutation: 'CROSS_TUPLE' | 'INSERT_THEN_DELETE' | 'SESSION_DRIFT'
    }): Promise<void> => {
      const operationId = randomUUID()
      invalidFenceOperationIds.push(operationId)
      await expectFailedTransaction(async () => {
        await client.query(`SET LOCAL ROLE "nihongo_phase7_owner"`)
        const execution = await client.query<{ id: string }>(
          `SELECT "phase7_open_trusted_execution"(
            'REAUTHENTICATE', $1, false
          ) AS id`,
          [reauthUserId]
        )
        const executionId = execution.rows[0]?.id
        if (!executionId) {
          throw new Error('Rotation fence negative execution is unavailable.')
        }
        await client.query(
          `INSERT INTO "AuthSessionRotationFence" (
            "oldSessionId", "oldTokenDigest", "userId", "oldFamilyId",
            "replacementFamilyId", "replacementSessionId", "operationId",
            "expiresAt"
          ) VALUES (
            $1, $2, $3, $4, $4, $5, $6,
            clock_timestamp() + INTERVAL '1 day'
          )`,
          [
            randomUUID(),
            createHash('sha256')
              .update(`phase7-invalid-fence-${operationId}`, 'utf8')
              .digest('hex'),
            reauthUserId,
            reauthFamilyId,
            input.mutation === 'CROSS_TUPLE'
              ? mismatchSessionId
              : replacementSessionId,
            operationId
          ]
        )
        if (input.mutation === 'INSERT_THEN_DELETE') {
          await client.query(`DELETE FROM "Session" WHERE "id" = $1`, [
            replacementSessionId
          ])
        } else if (input.mutation === 'SESSION_DRIFT') {
          await client.query(`RESET ROLE`)
          await client.query(`SET LOCAL session_replication_role = replica`)
          try {
            await client.query(
              `UPDATE "Session" SET "sessionFamilyId" = $2 WHERE "id" = $1`,
              [replacementSessionId, alternateFamilyId]
            )
          } finally {
            await client.query(`SET LOCAL session_replication_role = origin`)
          }
          await client.query(`SET LOCAL ROLE "nihongo_phase7_owner"`)
        }
        await client.query(`SELECT "phase7_close_trusted_execution"($1)`, [
          executionId
        ])
        await client.query('COMMIT')
      }, '23503')
    }
    await expectInvalidFenceCommit({ mutation: 'CROSS_TUPLE' })
    await expectInvalidFenceCommit({ mutation: 'INSERT_THEN_DELETE' })
    await expectInvalidFenceCommit({ mutation: 'SESSION_DRIFT' })
    expect(
      (
        await client.query<{
          familyId: string
          invalidFenceCount: number
          replacementSessionCount: number
          trustedExecutionCount: number
        }>(
          `SELECT session."sessionFamilyId"::text AS "familyId",
             COUNT(*)::int AS "replacementSessionCount",
             (SELECT COUNT(*)::int FROM "AuthSessionRotationFence"
              WHERE "operationId" = ANY($2::uuid[])) AS "invalidFenceCount",
             (SELECT COUNT(*)::int FROM "Phase7TrustedExecution")
               AS "trustedExecutionCount"
           FROM "Session" AS session WHERE session."id" = $1
           GROUP BY session."sessionFamilyId"`,
          [replacementSessionId, invalidFenceOperationIds]
        )
      ).rows
    ).toEqual([
      {
        familyId: reauthFamilyId,
        invalidFenceCount: 0,
        replacementSessionCount: 1,
        trustedExecutionCount: 0
      }
    ])

    const resetActivationUserId = randomUUID()
    const resetActivationVerificationId = randomUUID()
    const resetActivationToken = `phase7-reset-activation-${randomUUID()}`
    await insertCredentialUser({ id: resetActivationUserId, role: 'USER' })
    const resetActivationEmail = (
      await client.query<{ email: string }>(
        `SELECT "email" FROM "User" WHERE "id" = $1`,
        [resetActivationUserId]
      )
    ).rows[0]?.email
    if (!resetActivationEmail) {
      throw new Error('Reset activation email is unavailable.')
    }
    const resetRaceClient = new Client({
      connectionString: connectionUrl.toString(),
      options: createPostgresStartupOptions(schema)
    })
    const activationRaceClient = new Client({
      connectionString: connectionUrl.toString(),
      options: createPostgresStartupOptions(schema)
    })
    let userLockOpen = false
    let resetRacePromise: Promise<unknown> | undefined
    let activationRacePromise: Promise<unknown> | undefined
    await resetRaceClient.connect()
    await activationRaceClient.connect()
    try {
      const resetBackend = await resetRaceClient.query<{ pid: number }>(
        `SELECT pg_backend_pid() AS pid`
      )
      const activationBackend = await activationRaceClient.query<{
        pid: number
      }>(`SELECT pg_backend_pid() AS pid`)
      const resetBackendPid = resetBackend.rows[0]?.pid
      const activationBackendPid = activationBackend.rows[0]?.pid
      if (!resetBackendPid || !activationBackendPid) {
        throw new Error('Reset/activation race backends are unavailable.')
      }
      await client.query('BEGIN')
      userLockOpen = true
      await client.query(`SELECT 1 FROM "User" WHERE "id" = $1 FOR UPDATE`, [
        resetActivationUserId
      ])
      await resetRaceClient.query(`SET ROLE "nihongo_auth_gateway"`)
      resetRacePromise = resetRaceClient.query(
        `SELECT "phase7_request_password_reset"($1, $2, $3) AS issued`,
        [
          resetActivationEmail,
          resetActivationVerificationId,
          resetActivationToken
        ]
      )
      void resetRacePromise.catch(() => undefined)
      let resetWaitObserved = false
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const activity = await client.query<{ waitEventType: string | null }>(
          `SELECT wait_event_type AS "waitEventType"
           FROM pg_stat_activity WHERE pid = $1`,
          [resetBackendPid]
        )
        if (activity.rows[0]?.waitEventType === 'Lock') {
          resetWaitObserved = true
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(resetWaitObserved).toBe(true)

      await activationRaceClient.query(`SET ROLE "nihongo_phase7_migration"`)
      activationRacePromise = activationRaceClient.query(
        `SELECT "phase7_activate_v1_issuer"('TEST') AS activated`
      )
      void activationRacePromise.catch(() => undefined)
      let activationWaitObserved = false
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const activity = await client.query<{ waitEventType: string | null }>(
          `SELECT wait_event_type AS "waitEventType"
           FROM pg_stat_activity WHERE pid = $1`,
          [activationBackendPid]
        )
        if (activity.rows[0]?.waitEventType === 'Lock') {
          activationWaitObserved = true
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(activationWaitObserved).toBe(true)
      await client.query('COMMIT')
      userLockOpen = false
      await expect(resetRacePromise).resolves.toMatchObject({
        rows: [{ issued: true }]
      })
      resetRacePromise = undefined
      await expect(activationRacePromise).rejects.toMatchObject({
        code: '23514'
      })
      activationRacePromise = undefined
    } finally {
      if (userLockOpen) await client.query('ROLLBACK')
      await resetRacePromise?.catch(() => undefined)
      await activationRacePromise?.catch(() => undefined)
      await resetRaceClient.query('RESET ROLE').catch(() => undefined)
      await activationRaceClient.query('RESET ROLE').catch(() => undefined)
      await resetRaceClient.end()
      await activationRaceClient.end()
    }
    expect(
      (
        await client.query<{
          legacyIssuerDisabled: boolean
          trustedExecutionCount: number
          verificationCount: number
        }>(
          `SELECT activation."legacyIssuerDisabled",
             (SELECT COUNT(*)::int FROM "Verification"
              WHERE "id" = $1 AND "resetUserId" = $2)
                AS "verificationCount",
             (SELECT COUNT(*)::int FROM "Phase7TrustedExecution")
               AS "trustedExecutionCount"
           FROM "AuthIssuerActivation" AS activation WHERE activation."id" = 1`,
          [resetActivationVerificationId, resetActivationUserId]
        )
      ).rows
    ).toEqual([
      {
        legacyIssuerDisabled: true,
        trustedExecutionCount: 0,
        verificationCount: 1
      }
    ])
    await withExecutionRole('nihongo_erasure_worker', () =>
      client.query(`SELECT "phase7_erase_user"($1, 'TEST')`, [
        resetActivationUserId
      ])
    )

    const resetCredentialRaceUserId = randomUUID()
    const resetCredentialRaceVerificationId = randomUUID()
    const resetCredentialRaceToken = `phase7-reset-credential-race-${randomUUID()}`
    await insertCredentialUser({ id: resetCredentialRaceUserId, role: 'USER' })
    const resetCredentialRaceEmail = (
      await client.query<{ email: string }>(
        `SELECT "email" FROM "User" WHERE "id" = $1`,
        [resetCredentialRaceUserId]
      )
    ).rows[0]?.email
    if (!resetCredentialRaceEmail) {
      throw new Error('Reset credential-race email is unavailable.')
    }
    const credentialMutationClient = new Client({
      connectionString: connectionUrl.toString(),
      options: createPostgresStartupOptions(schema)
    })
    const credentialResetClient = new Client({
      connectionString: connectionUrl.toString(),
      options: createPostgresStartupOptions(schema)
    })
    let credentialMutationOpen = false
    let credentialDeleted = false
    let credentialResetPromise: Promise<unknown> | undefined
    await credentialMutationClient.connect()
    await credentialResetClient.connect()
    try {
      const resetBackend = await credentialResetClient.query<{ pid: number }>(
        `SELECT pg_backend_pid() AS pid`
      )
      const resetBackendPid = resetBackend.rows[0]?.pid
      if (!resetBackendPid) {
        throw new Error('Credential reset-race backend is unavailable.')
      }

      await credentialMutationClient.query('BEGIN')
      credentialMutationOpen = true
      await credentialMutationClient.query(
        `SET LOCAL session_replication_role = replica`
      )
      await credentialMutationClient.query(
        `SELECT 1 FROM "User" WHERE "id" = $1 FOR UPDATE`,
        [resetCredentialRaceUserId]
      )
      await credentialMutationClient.query(
        `DELETE FROM "Account" WHERE "userId" = $1`,
        [resetCredentialRaceUserId]
      )

      await credentialResetClient.query(`SET ROLE "nihongo_auth_gateway"`)
      credentialResetPromise = credentialResetClient.query(
        `SELECT "phase7_request_password_reset"($1, $2, $3) AS issued`,
        [
          resetCredentialRaceEmail,
          resetCredentialRaceVerificationId,
          resetCredentialRaceToken
        ]
      )
      void credentialResetPromise.catch(() => undefined)

      let resetWaitObserved = false
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const activity = await client.query<{ waitEventType: string | null }>(
          `SELECT wait_event_type AS "waitEventType"
           FROM pg_stat_activity WHERE pid = $1`,
          [resetBackendPid]
        )
        if (activity.rows[0]?.waitEventType === 'Lock') {
          resetWaitObserved = true
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(resetWaitObserved).toBe(true)

      await credentialMutationClient.query('COMMIT')
      credentialMutationOpen = false
      credentialDeleted = true
      await expect(credentialResetPromise).resolves.toMatchObject({
        rows: [{ issued: false }]
      })
      credentialResetPromise = undefined
    } finally {
      if (credentialMutationOpen) {
        await credentialMutationClient.query('ROLLBACK')
      }
      await credentialResetPromise?.catch(() => undefined)
      await credentialResetClient.query('RESET ROLE').catch(() => undefined)
      await credentialMutationClient.end()
      await credentialResetClient.end()
    }
    expect(
      (
        await client.query<{
          trustedExecutionCount: number
          verificationCount: number
        }>(
          `SELECT
             (SELECT COUNT(*)::int FROM "Verification"
              WHERE "id" = $1 OR "resetUserId" = $2)
               AS "verificationCount",
             (SELECT COUNT(*)::int FROM "Phase7TrustedExecution")
               AS "trustedExecutionCount"`,
          [resetCredentialRaceVerificationId, resetCredentialRaceUserId]
        )
      ).rows
    ).toEqual([{ trustedExecutionCount: 0, verificationCount: 0 }])
    if (credentialDeleted) {
      const restoredAt = new Date()
      await client.query(
        `INSERT INTO "Account" (
          "id", "accountId", "providerId", "userId", "password",
          "createdAt", "updatedAt"
        ) VALUES (
          $1, $2::uuid::text, 'credential', $2::uuid,
          'integration-password-hash', $3, $3
        )`,
        [randomUUID(), resetCredentialRaceUserId, restoredAt]
      )
    }
    await withExecutionRole('nihongo_erasure_worker', () =>
      client.query(`SELECT "phase7_erase_user"($1, 'TEST')`, [
        resetCredentialRaceUserId
      ])
    )

    const userId = randomUUID()
    await insertCredentialUser({ id: userId, role: 'USER' })
    await expectFailedTransaction(async () => {
      await client.query(
        `INSERT INTO "Session" (
            "id", "expiresAt", "token", "createdAt", "updatedAt", "userId",
            "sessionFamilyId", "authorityGeneration", "issuerProtocolVersion"
          ) VALUES (
            $1, clock_timestamp() + INTERVAL '1 day', $2,
            clock_timestamp(), clock_timestamp(), $3, $4, 1, 'LEGACY'
          )`,
        [randomUUID(), `late-legacy-${randomUUID()}`, userId, randomUUID()]
      )
    }, '42501')
    expect(
      (
        await client.query<{ count: number }>(
          `SELECT COUNT(*)::int AS count FROM "Session" WHERE "userId" = $1`,
          [userId]
        )
      ).rows
    ).toEqual([{ count: 0 }])

    const resetSessionId = randomUUID()
    const resetSessionToken = `phase7-reset-session-${randomUUID()}`
    const resetVerificationId = randomUUID()
    const rawResetToken = `phase7-reset-token-${randomUUID()}`
    const resetEmail = (
      await client.query<{ email: string }>(
        `SELECT "email" FROM "User" WHERE "id" = $1`,
        [userId]
      )
    ).rows[0]?.email
    if (!resetEmail) throw new Error('Reset email is unavailable.')
    await expect(
      withExecutionRole('nihongo_auth_gateway', () =>
        client.query(
          `SELECT * FROM "phase7_issue_v1_session"(
            $1, 1, 'USER', 'ACTIVE', $2, $3,
            '127.0.0.1', 'phase7-reset-session', false
          )`,
          [userId, resetSessionId, resetSessionToken]
        )
      )
    ).resolves.toMatchObject({ rows: [{ id: resetSessionId }] })
    await expect(
      withExecutionRole('nihongo_auth_gateway', () =>
        client.query(
          `SELECT "phase7_request_password_reset"($1, $2, $3) AS issued`,
          [resetEmail, resetVerificationId, rawResetToken]
        )
      )
    ).resolves.toMatchObject({ rows: [{ issued: true }] })
    await expect(
      withExecutionRole('nihongo_auth_gateway', () =>
        client.query(
          `SELECT * FROM "phase7_resolve_password_reset_credential"($1)`,
          [rawResetToken]
        )
      )
    ).resolves.toMatchObject({
      rows: [
        {
          authorityGeneration: 1,
          passwordHash: 'integration-password-hash',
          userId
        }
      ]
    })
    await expect(
      withExecutionRole('nihongo_auth_gateway', () =>
        client.query(
          `SELECT * FROM "phase7_resolve_password_reset_credential"($1)`,
          [`phase7-unknown-reset-${randomUUID()}`]
        )
      )
    ).resolves.toMatchObject({ rowCount: 0, rows: [] })
    const resetBefore = await client.query<{
      authorityGeneration: number
      password: string
      sessionCount: number
      verificationCount: number
    }>(
      `SELECT target_user."authorityGeneration",
         credential."password",
         (SELECT COUNT(*)::int FROM "Session" WHERE "userId" = $1)
           AS "sessionCount",
         (SELECT COUNT(*)::int FROM "Verification"
          WHERE "id" = $2 AND "resetUserId" = $1
            AND "capturedGeneration" = 1)
           AS "verificationCount"
       FROM "User" AS target_user
       JOIN "Account" AS credential
         ON credential."userId" = target_user."id"
        AND credential."providerId" = 'credential'
       WHERE target_user."id" = $1`,
      [userId, resetVerificationId]
    )
    expect(resetBefore.rows).toEqual([
      {
        authorityGeneration: 1,
        password: 'integration-password-hash',
        sessionCount: 1,
        verificationCount: 1
      }
    ])
    await expect(
      withExecutionRole('nihongo_auth_gateway', () =>
        client.query(`SELECT * FROM "phase7_consume_password_reset"($1, $2)`, [
          rawResetToken,
          'integration-password-hash'
        ])
      )
    ).resolves.toMatchObject({ rowCount: 0, rows: [] })
    expect(
      (
        await client.query<{
          authorityGeneration: number
          password: string
          sessionCount: number
          verificationCount: number
        }>(
          `SELECT target_user."authorityGeneration",
             credential."password",
             (SELECT COUNT(*)::int FROM "Session" WHERE "userId" = $1)
               AS "sessionCount",
             (SELECT COUNT(*)::int FROM "Verification"
              WHERE "id" = $2 AND "resetUserId" = $1
                AND "capturedGeneration" = 1)
               AS "verificationCount"
           FROM "User" AS target_user
           JOIN "Account" AS credential
             ON credential."userId" = target_user."id"
            AND credential."providerId" = 'credential'
           WHERE target_user."id" = $1`,
          [userId, resetVerificationId]
        )
      ).rows
    ).toEqual(resetBefore.rows)
    await expect(
      withExecutionRole('nihongo_auth_gateway', () =>
        client.query(`SELECT * FROM "phase7_consume_password_reset"($1, $2)`, [
          rawResetToken,
          'phase7-reset-password-hash'
        ])
      )
    ).resolves.toMatchObject({
      rows: [{ authorityGeneration: 2, userId }]
    })
    expect(
      (
        await client.query<{
          authorityGeneration: number
          password: string
          sessionCount: number
          trustedExecutionCount: number
          verificationCount: number
        }>(
          `SELECT target_user."authorityGeneration",
             credential."password",
             (SELECT COUNT(*)::int FROM "Session" WHERE "userId" = $1)
               AS "sessionCount",
             (SELECT COUNT(*)::int FROM "Verification"
              WHERE "resetUserId" = $1) AS "verificationCount",
             (SELECT COUNT(*)::int FROM "Phase7TrustedExecution")
               AS "trustedExecutionCount"
           FROM "User" AS target_user
           JOIN "Account" AS credential
             ON credential."userId" = target_user."id"
            AND credential."providerId" = 'credential'
           WHERE target_user."id" = $1`,
          [userId]
        )
      ).rows
    ).toEqual([
      {
        authorityGeneration: 2,
        password: 'phase7-reset-password-hash',
        sessionCount: 0,
        trustedExecutionCount: 0,
        verificationCount: 0
      }
    ])
    await expect(
      withExecutionRole('nihongo_erasure_worker', () =>
        client.query(`SELECT "phase7_erase_user"($1, 'TEST') AS erased`, [
          userId
        ])
      )
    ).resolves.toMatchObject({ rows: [{ erased: true }] })
    await expect(
      withExecutionRole('nihongo_erasure_worker', () =>
        client.query(`SELECT "phase7_erase_user"($1, 'TEST') AS erased`, [
          mismatchUserId
        ])
      )
    ).resolves.toMatchObject({ rows: [{ erased: true }] })
    await expect(
      withExecutionRole('nihongo_erasure_worker', () =>
        client.query(`SELECT "phase7_erase_user"($1, 'TEST') AS erased`, [
          reauthUserId
        ])
      )
    ).resolves.toMatchObject({ rows: [{ erased: true }] })
    await expect(
      withExecutionRole('nihongo_erasure_worker', () =>
        client.query(`SELECT "phase7_erase_user"($1, 'TEST') AS erased`, [
          signupUserId
        ])
      )
    ).resolves.toMatchObject({ rows: [{ erased: true }] })
    await expect(
      withExecutionRole('nihongo_erasure_worker', () =>
        client.query(`SELECT "phase7_erase_user"($1, 'TEST') AS erased`, [
          legacyCompatibilityUserId
        ])
      )
    ).resolves.toMatchObject({ rows: [{ erased: true }] })
  }

  it('서로 분리된 LOGIN wrapper를 실제 startup role로 attestation한다', async () => {
    if (!schema) {
      throw new Error('Phase 7 integration schema is unavailable.')
    }
    const suffix = randomUUID().replaceAll('-', '').slice(0, 20)
    const applicationLogin = 'nihongo_test_app_login'
    const authGatewayLogin = 'nihongo_test_auth_gateway_login'
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
    const authGatewayUrl = environment.AUTH_GATEWAY_DATABASE_URL
    if (!authGatewayUrl) {
      throw new Error('Phase 7 auth gateway wrapper URL is required.')
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
      throw new Error('Phase 7 runtime wrapper URL identities are not exact.')
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
        'nihongo_auth_gateway'
      )
      const endpoints = {
        application: {
          client: applicationRuntime.client,
          connectionString: applicationUrl,
          expectedRole: 'nihongo_app' as const
        },
        authGateway: {
          client: authGatewayRuntime.client,
          connectionString: authGatewayUrl,
          expectedRole: 'nihongo_auth_gateway' as const
        }
      }
      await expect(attestPhase7RuntimeRoles(endpoints)).resolves.toBeUndefined()
      await expect(
        Promise.all([
          applicationRuntime.client.$queryRawUnsafe(
            `SELECT "phase7_require_runtime_ready"()`
          ),
          authGatewayRuntime.client.$queryRawUnsafe(
            `SELECT "phase7_require_runtime_ready"()`
          )
        ])
      ).resolves.toHaveLength(2)

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
          throw new Error('Phase 7 runtime write-zero fixture is unavailable.')
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
          'nihongo_auth_gateway'
        )
        try {
          const guardedServiceMutation = async (): Promise<number> => {
            try {
              await attestPhase7RuntimeRoles({
                application: {
                  client: replicaApplicationRuntime.client,
                  connectionString: applicationUrl,
                  expectedRole: 'nihongo_app'
                },
                authGateway: {
                  client: replicaAuthGatewayRuntime.client,
                  connectionString: authGatewayUrl,
                  expectedRole: 'nihongo_auth_gateway'
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
      await assertReplicaStartupFailsClosed({
        resetSetting: `ALTER ROLE ${quoteIdentifier(authGatewayLogin)}
          IN DATABASE ${quoteIdentifier(configuredDatabaseName)}
          RESET session_replication_role`,
        setSetting: `ALTER ROLE ${quoteIdentifier(authGatewayLogin)}
          IN DATABASE ${quoteIdentifier(configuredDatabaseName)}
          SET session_replication_role = replica`,
        settingKind: 'auth-gateway-database-role'
      })

      await client.query(
        `GRANT CONNECT ON DATABASE ${quoteIdentifier(configuredDatabaseName)}
         TO PUBLIC`
      )
      publicConnectRestored = false
      await expect(attestPhase7RuntimeRoles(endpoints)).rejects.toThrow(
        'Phase 7 runtime DB role attestation failed.'
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
      await expect(attestPhase7RuntimeRoles(endpoints)).rejects.toThrow(
        'Phase 7 runtime DB role attestation failed.'
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
      await expect(attestPhase7RuntimeRoles(endpoints)).rejects.toThrow(
        'Phase 7 runtime DB role attestation failed.'
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
      await client.query(
        `GRANT ${quoteIdentifier(extraRole)} TO ${quoteIdentifier(applicationLogin)}`
      )
      applicationHasExtraMembership = true
      await expect(attestPhase7RuntimeRoles(endpoints)).rejects.toThrow(
        'Phase 7 runtime DB role attestation failed.'
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
      await expect(attestPhase7RuntimeRoles(endpoints)).rejects.toThrow(
        'Phase 7 runtime DB role attestation failed.'
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
      await expect(attestPhase7RuntimeRoles(endpoints)).rejects.toThrow(
        'Phase 7 runtime DB role attestation failed.'
      )
      await client.query(
        `REVOKE SELECT ("email") ON TABLE ${quoteIdentifier(schema)}."User"
         FROM ${quoteIdentifier(applicationLogin)}`
      )
      applicationHasDirectUserEmailAcl = false

      await client.query(
        `CREATE SCHEMA ${quoteIdentifier(wrongSchema)}
         AUTHORIZATION "nihongo_phase7_owner"`
      )
      await client.query(
        `GRANT USAGE ON SCHEMA ${quoteIdentifier(wrongSchema)}
         TO "nihongo_app", "nihongo_auth_gateway"`
      )
      const wrongSchemaApplicationUrl = retargetWrapperUrl(
        { databaseName: configuredDatabaseName, schemaName: wrongSchema },
        applicationUrl
      )
      wrongSchemaRuntime = createRoleDatabaseRuntime(
        wrongSchemaApplicationUrl,
        'nihongo_app'
      )
      await expect(
        attestPhase7RuntimeRoles({
          application: {
            client: wrongSchemaRuntime.client,
            connectionString: wrongSchemaApplicationUrl,
            expectedRole: 'nihongo_app'
          },
          authGateway: endpoints.authGateway
        })
      ).rejects.toThrow(
        'Phase 7 runtime DB endpoints do not share one safe target.'
      )

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
      await expect(attestPhase7RuntimeRoles(endpoints)).rejects.toThrow(
        'Phase 7 runtime DB role attestation failed.'
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
         AUTHORIZATION "nihongo_phase7_owner"`
      )
      await ownedDatabaseAdmin.query(
        `GRANT USAGE ON SCHEMA ${quoteIdentifier(schema)}
         TO "nihongo_app", "nihongo_auth_gateway"`
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
        'nihongo_auth_gateway'
      )
      await expect(
        attestPhase7RuntimeRoles({
          application: {
            client: ownedDatabaseApplicationRuntime.client,
            connectionString: ownedDatabaseApplicationUrl,
            expectedRole: 'nihongo_app'
          },
          authGateway: {
            client: ownedDatabaseAuthGatewayRuntime.client,
            connectionString: ownedDatabaseAuthGatewayUrl,
            expectedRole: 'nihongo_auth_gateway'
          }
        })
      ).rejects.toThrow('Phase 7 runtime DB role attestation failed.')
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
