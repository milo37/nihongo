import { createHash } from 'node:crypto'
import { Prisma } from '../generated/prisma/client.js'
import {
  adminAuditLogItemSchema,
  createAdminAuditContentDigestPreimage,
  diffQuestionVersionResponseSchema,
  getAdminQuestionResponseSchema,
  listAdminAuditLogResponseSchema,
  listAdminQuestionsQuerySchema,
  listAdminQuestionsResponseSchema,
  listAdminQuestionVersionsResponseSchema,
  listAdminTagsResponseSchema,
  listQuestionVersionReviewsResponseSchema,
  previewQuestionVersionResponseSchema,
  type ListAdminQuestionsResponse
} from '@nihongo/contracts/admin/phase7'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  buildAdminQuestionPageQuery,
  createPrismaAdminQuestionRepository,
  type AdminQuestionRepository
} from './adminQuestionRepository.js'
import { createAdminQuestionService } from './adminQuestionService.js'
import { createDatabaseRuntime, type DatabaseRuntime } from '../db/database.js'
import { createPostgresStartupOptions } from '../db/databaseOptions.js'
import { createApiApp } from '../app/createApp.js'
import type { AdminReadRateLimiter } from './adminReadRateLimiter.js'
import type { GuestPrincipalService } from '../auth/guestPrincipalService.js'
import type { PrincipalService } from '../auth/principalService.js'
import { parseApiEnvironment } from '../config/env.js'
import { createJsonLogger } from '../observability/logger.js'
import type { QuestionReader } from '../question/questionService.js'

const requireEnvironmentValue = (name: string): string => {
  const value = process.env[name]
  if (!value)
    throw new Error(`Phase 7 admin read integration requires ${name}.`)
  return value
}

const adminDatabaseUrl = requireEnvironmentValue(
  'PHASE7_API_ADMIN_DATABASE_URL'
)
const applicationDatabaseUrl = requireEnvironmentValue('DATABASE_URL')
const authGatewayDatabaseUrl = requireEnvironmentValue(
  'AUTH_GATEWAY_DATABASE_URL'
)
const schemaName = new URL(adminDatabaseUrl).searchParams.get('schema')
if (!schemaName || !/^phase7_[a-f0-9]{32}_test$/u.test(schemaName)) {
  throw new Error('Phase 7 admin read integration received an unsafe schema.')
}

const QUESTION_IDS = {
  candidate: '019d7100-0000-7000-8000-000000000001',
  published: '019d7100-0000-7000-8000-000000000002',
  fallback: '019d7100-0000-7000-8000-000000000003'
} as const
const VERSION_IDS = {
  candidatePublished: '019d7100-0000-7000-8000-000000000011',
  candidateOpen: '019d7100-0000-7000-8000-000000000012',
  publishedCurrent: '019d7100-0000-7000-8000-000000000013',
  publishedRetiredDecoy: '019d7100-0000-7000-8000-000000000014',
  fallbackOld: '019d7100-0000-7000-8000-000000000015',
  fallbackHighest: '019d7100-0000-7000-8000-000000000016'
} as const
const TAG_IDS = [
  '019d7100-0000-7000-8000-000000000021',
  '019d7100-0000-7000-8000-000000000022',
  '019d7100-0000-7000-8000-000000000023',
  '019d7100-0000-7000-8000-000000000024',
  '019d7100-0000-7000-8000-000000000025',
  '019d7100-0000-7000-8000-000000000026'
] as const
const REVIEWER_ID = '019d7100-0000-7000-8000-000000000041'
const AUTHOR_ID = '019d7100-0000-7000-8000-000000000042'
const REPORTER_ID = '019d7100-0000-7000-8000-000000000043'
const REPORT_IDS = [
  '019d7100-0000-7000-8000-000000000051',
  '019d7100-0000-7000-8000-000000000052'
] as const
const AUDIT_IDS = [
  '019d7100-0000-7000-8000-000000000061',
  '019d7100-0000-7000-8000-000000000062',
  '019d7100-0000-7000-8000-000000000063'
] as const

const versionIds = Object.values(VERSION_IDS)
const questionIds = Object.values(QUESTION_IDS)

const adminClient = new Client({
  connectionString: adminDatabaseUrl,
  options: createPostgresStartupOptions(schemaName)
})
let databaseRuntime: DatabaseRuntime
let repository: AdminQuestionRepository
let service: ReturnType<typeof createAdminQuestionService>
let app: ReturnType<typeof createApiApp>

interface VersionFixture {
  id: string
  questionId: string
  versionNumber: number
  status: 'CHANGES_REQUESTED' | 'PUBLISHED' | 'RETIRED'
  questionText: string
  retirementKind: 'PUBLISHED_RETIREMENT' | null
  createdAt: string
  updatedAt: string
  publishedAt: string | null
  retiredAt: string | null
}

const optionIdFor = (versionId: string, ordinal: number): string => {
  const versionIndex = versionIds.findIndex(
    (candidate) => candidate === versionId
  )
  if (versionIndex < 0 || ordinal < 1 || ordinal > 4) {
    throw new Error('Phase 7 option fixture identity is invalid.')
  }
  return `019d7100-${String(versionIndex + 1).padStart(4, '0')}-7000-8${ordinal}00-000000000001`
}

const insertQuestion = async ({
  createdAt,
  currentPublishedVersionId,
  id
}: {
  createdAt: string
  currentPublishedVersionId: string | null
  id: string
}): Promise<void> => {
  await adminClient.query(
    `INSERT INTO "Question" (
       "id", "lifecycleStatus", "currentPublishedVersionId",
       "createdByUserId", "createdByActorId", "createdByRoleSnapshot",
       "createdByLabelSnapshot", "rowVersion", "createdAt", "updatedAt",
       "archivedAt"
     ) VALUES (
       $1, 'ACTIVE', $2, NULL, NULL, NULL, 'SYSTEM_SEED', 1,
       $3::timestamptz, $3::timestamptz, NULL
     )`,
    [id, currentPublishedVersionId, createdAt]
  )
}

const insertVersion = async (fixture: VersionFixture): Promise<void> => {
  const correctOptionId = optionIdFor(fixture.id, 2)
  await adminClient.query(
    `INSERT INTO "QuestionVersion" (
       "id", "questionId", "versionNumber", "status", "level", "subject",
       "questionType", "passage", "questionText", "correctOptionId",
       "explanationKo", "explanationJa", "difficulty", "sourceType",
       "rowVersion", "createdByUserId", "createdByActorId",
       "createdByRoleSnapshot", "createdByLabelSnapshot", "retirementKind",
       "contentFingerprint", "createdAt", "updatedAt", "publishedAt",
       "retiredAt"
     ) VALUES (
       $1, $2, $3, $4, 'N5', 'VOCABULARY', 'KANJI_READING', NULL, $5, $6,
       '통합 테스트 해설입니다.', NULL, 'EASY', 'ORIGINAL', 1,
       NULL, NULL, NULL, 'SYSTEM_SEED', $7,
       repeat('0', 64), $8::timestamptz, $9::timestamptz,
       $10::timestamptz, $11::timestamptz
     )`,
    [
      fixture.id,
      fixture.questionId,
      fixture.versionNumber,
      fixture.status,
      fixture.questionText,
      correctOptionId,
      fixture.retirementKind,
      fixture.createdAt,
      fixture.updatedAt,
      fixture.publishedAt,
      fixture.retiredAt
    ]
  )

  for (let ordinal = 1; ordinal <= 4; ordinal += 1) {
    await adminClient.query(
      `INSERT INTO "QuestionOption" (
         "id", "questionVersionId", "label", "text", "ordinal"
       ) VALUES ($1, $2, $3, $4, $5)`,
      [
        optionIdFor(fixture.id, ordinal),
        fixture.id,
        String(ordinal),
        `${fixture.versionNumber}번 버전 원본 선택지 ${ordinal}`,
        ordinal
      ]
    )
  }
}

const insertTagSnapshot = async ({
  index,
  name,
  versionId
}: {
  index: number
  name: string
  versionId: string
}): Promise<void> => {
  const tagId = TAG_IDS[index]!
  await adminClient.query(
    `INSERT INTO "Tag" (
       "id", "label", "normalizedName", "createdAt", "updatedAt"
     ) VALUES ($1, $2, $2, clock_timestamp(), clock_timestamp())`,
    [tagId, name]
  )
  await adminClient.query(
    `INSERT INTO "QuestionVersionTag" (
       "id", "questionVersionId", "tagId", "labelSnapshot",
       "normalizedNameSnapshot"
     ) VALUES ($1, $2, $3, $4, $4)`,
    [
      `019d7100-0000-7000-8000-0000000001${index.toString().padStart(2, '0')}`,
      versionId,
      tagId,
      name
    ]
  )
}

const insertAnswer = async ({
  index,
  isCorrect,
  versionId
}: {
  index: number
  isCorrect: boolean
  versionId: string
}): Promise<void> => {
  const suffix = index.toString().padStart(3, '0')
  await adminClient.query(
    `INSERT INTO "StudyAnswer" (
       "id", "studySessionQuestionId", "questionVersionId",
       "selectedOptionId", "isCorrect", "elapsedSec", "gradingVersion",
       "answeredAt", "gradedAt"
     ) VALUES (
       $1, $2, $3, NULL, $4, 10, 'server-grading-v1',
       '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'
     )`,
    [
      `019d7100-0000-7000-8000-000000000${suffix}`,
      `019d7100-0000-7000-9000-000000000${suffix}`,
      versionId,
      isCorrect
    ]
  )
}

const seedFixture = async (): Promise<void> => {
  await adminClient.query('BEGIN')
  try {
    await adminClient.query('SET LOCAL session_replication_role = replica')
    await insertQuestion({
      id: QUESTION_IDS.candidate,
      currentPublishedVersionId: VERSION_IDS.candidatePublished,
      createdAt: '2026-01-01T00:00:00.000Z'
    })
    await insertQuestion({
      id: QUESTION_IDS.published,
      currentPublishedVersionId: VERSION_IDS.publishedCurrent,
      createdAt: '2026-02-01T00:00:00.000Z'
    })
    await insertQuestion({
      id: QUESTION_IDS.fallback,
      currentPublishedVersionId: null,
      createdAt: '2026-03-01T00:00:00.000Z'
    })

    const fixtures: VersionFixture[] = [
      {
        id: VERSION_IDS.candidatePublished,
        questionId: QUESTION_IDS.candidate,
        versionNumber: 1,
        status: 'PUBLISHED',
        questionText: '출판된 이전 문제입니다.',
        retirementKind: null,
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        publishedAt: '2026-01-02T00:00:00.000Z',
        retiredAt: null
      },
      {
        id: VERSION_IDS.candidateOpen,
        questionId: QUESTION_IDS.candidate,
        versionNumber: 2,
        status: 'CHANGES_REQUESTED',
        questionText: '후보 문제를 선택하세요.',
        retirementKind: null,
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z',
        publishedAt: null,
        retiredAt: null
      },
      {
        id: VERSION_IDS.publishedCurrent,
        questionId: QUESTION_IDS.published,
        versionNumber: 1,
        status: 'PUBLISHED',
        questionText: '현재 출판 문제를 선택하세요.',
        retirementKind: null,
        createdAt: '2026-02-02T00:00:00.000Z',
        updatedAt: '2026-02-02T00:00:00.000Z',
        publishedAt: '2026-02-02T00:00:00.000Z',
        retiredAt: null
      },
      {
        id: VERSION_IDS.publishedRetiredDecoy,
        questionId: QUESTION_IDS.published,
        versionNumber: 2,
        status: 'RETIRED',
        questionText: '더 높은 은퇴 버전입니다.',
        retirementKind: 'PUBLISHED_RETIREMENT',
        createdAt: '2026-02-03T00:00:00.000Z',
        updatedAt: '2026-05-02T00:00:00.000Z',
        publishedAt: '2026-02-03T00:00:00.000Z',
        retiredAt: '2026-05-02T00:00:00.000Z'
      },
      {
        id: VERSION_IDS.fallbackOld,
        questionId: QUESTION_IDS.fallback,
        versionNumber: 1,
        status: 'RETIRED',
        questionText: '이전 fallback 문제입니다.',
        retirementKind: 'PUBLISHED_RETIREMENT',
        createdAt: '2026-03-02T00:00:00.000Z',
        updatedAt: '2026-03-02T00:00:00.000Z',
        publishedAt: '2026-03-02T00:00:00.000Z',
        retiredAt: '2026-03-02T01:00:00.000Z'
      },
      {
        id: VERSION_IDS.fallbackHighest,
        questionId: QUESTION_IDS.fallback,
        versionNumber: 2,
        status: 'RETIRED',
        questionText: '가장 높은 fallback 문제입니다.',
        retirementKind: 'PUBLISHED_RETIREMENT',
        createdAt: '2026-04-02T00:00:00.000Z',
        updatedAt: '2026-04-02T00:00:00.000Z',
        publishedAt: '2026-04-02T00:00:00.000Z',
        retiredAt: '2026-04-02T01:00:00.000Z'
      }
    ]
    for (const fixture of fixtures) await insertVersion(fixture)

    const tagFixtures = [
      [VERSION_IDS.candidatePublished, 'published-decoy'],
      [VERSION_IDS.candidateOpen, 'candidate-selected'],
      [VERSION_IDS.publishedCurrent, 'published-selected'],
      [VERSION_IDS.publishedRetiredDecoy, 'retired-decoy'],
      [VERSION_IDS.fallbackOld, 'fallback-old'],
      [VERSION_IDS.fallbackHighest, 'fallback-selected']
    ] as const
    for (const [index, [versionId, name]] of tagFixtures.entries()) {
      await insertTagSnapshot({ index, name, versionId })
    }

    await adminClient.query(
      `INSERT INTO "ContentReview" (
         "id", "questionId", "questionVersionId", "action", "fromState",
         "toState", "actorKind", "actorUserId", "actorId", "actorRole",
         "actorLabel", "actorSystemLabel", "counterpartUserId",
         "counterpartActorId", "counterpartRole", "counterpartLabel",
         "reason", "comment", "operationId", "requestId", "occurredAt"
       ) VALUES (
         '019d7100-0000-7000-8000-000000000031', $1, $2,
         'CHANGES_REQUESTED', 'IN_REVIEW', 'CHANGES_REQUESTED', 'ACCOUNT',
         NULL, $3, 'ADMIN', 'DELETED_ADMIN', NULL, NULL, $4, 'ADMIN',
         'DELETED_ADMIN', '수정이 필요합니다.', NULL,
         '019d7100-0000-7000-8000-000000000071',
         '019d7100-0000-7000-8000-000000000081',
         '2026-01-04T00:00:00.000Z'
       ), (
         '019d7100-0000-7000-8000-000000000032', $1, $2,
         'PUBLISHED', 'APPROVED', 'PUBLISHED', 'ACCOUNT', NULL, $4,
         'ADMIN', 'DELETED_ADMIN', NULL, NULL, $3, 'ADMIN', 'DELETED_ADMIN',
         NULL, NULL, '019d7100-0000-7000-8000-000000000072',
         '019d7100-0000-7000-8000-000000000082',
         '2026-01-05T00:00:00.000Z'
       )`,
      [
        QUESTION_IDS.candidate,
        VERSION_IDS.candidateOpen,
        REVIEWER_ID,
        AUTHOR_ID
      ]
    )

    for (let index = 0; index < 5; index += 1) {
      await insertAnswer({
        index: index + 1,
        versionId: VERSION_IDS.candidatePublished,
        isCorrect: false
      })
    }
    await insertAnswer({
      index: 11,
      versionId: VERSION_IDS.candidateOpen,
      isCorrect: true
    })
    await insertAnswer({
      index: 12,
      versionId: VERSION_IDS.candidateOpen,
      isCorrect: true
    })
    await insertAnswer({
      index: 13,
      versionId: VERSION_IDS.candidateOpen,
      isCorrect: false
    })
    await insertAnswer({
      index: 21,
      versionId: VERSION_IDS.publishedRetiredDecoy,
      isCorrect: true
    })
    await insertAnswer({
      index: 31,
      versionId: VERSION_IDS.fallbackHighest,
      isCorrect: true
    })
    await insertAnswer({
      index: 32,
      versionId: VERSION_IDS.fallbackHighest,
      isCorrect: false
    })

    await adminClient.query(
      `INSERT INTO "QuestionReport" (
         "id", "questionId", "questionVersionId", "reason", "description",
         "descriptionDigest", "status", "reporterUserId", "reporterActorId",
         "reporterRole", "reporterLabel", "assigneeUserId", "assigneeActorId",
         "assigneeRole", "assigneeLabel", "resolutionOutcome",
         "resolutionReason", "remediationVersionId", "rowVersion", "createdAt",
         "updatedAt", "resolvedAt"
       ) VALUES (
         $1, $3, $4, 'ANSWER_ERROR', NULL, repeat('0', 64), 'OPEN', NULL, $5,
         'USER', 'DELETED_USER', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1,
         '2026-01-06T00:00:00.000Z', '2026-01-06T00:00:00.000Z', NULL
       ), (
         $2, $3, $6, 'EXPLANATION_ERROR', NULL, repeat('1', 64), 'TRIAGED',
         NULL, $5, 'USER', 'DELETED_USER', NULL, $7, 'ADMIN', 'DELETED_ADMIN',
         NULL, NULL, NULL, 2, '2026-01-07T00:00:00.000Z',
         '2026-01-08T00:00:00.000Z', NULL
       )`,
      [
        REPORT_IDS[0],
        REPORT_IDS[1],
        QUESTION_IDS.candidate,
        VERSION_IDS.candidatePublished,
        REPORTER_ID,
        VERSION_IDS.candidateOpen,
        REVIEWER_ID
      ]
    )

    const auditRows = [
      {
        id: AUDIT_IDS[0],
        command: 'QUESTION_ARCHIVE',
        targetType: 'QUESTION',
        targetId: QUESTION_IDS.candidate,
        beforeState: 'ACTIVE',
        afterState: 'ARCHIVED',
        beforeRowVersion: 1,
        afterRowVersion: 2,
        changedFields: ['LIFECYCLE_STATUS'],
        metadata: {
          kind: 'QUESTION_ARCHIVE_V1',
          retiredPublishedCount: 0,
          abandonedCandidateCount: 0
        },
        occurredAt: '2026-01-09T00:00:00.000Z'
      },
      {
        id: AUDIT_IDS[1],
        command: 'REVIEW_REQUEST',
        targetType: 'QUESTION_VERSION',
        targetId: VERSION_IDS.candidateOpen,
        beforeState: 'DRAFT',
        afterState: 'IN_REVIEW',
        beforeRowVersion: 1,
        afterRowVersion: 2,
        changedFields: ['VERSION_STATUS'],
        metadata: { kind: 'NONE_V1' },
        occurredAt: '2026-01-10T00:00:00.000Z'
      },
      {
        id: AUDIT_IDS[2],
        command: 'REPORT_TRIAGE',
        targetType: 'QUESTION_REPORT',
        targetId: REPORT_IDS[0],
        beforeState: 'OPEN',
        afterState: 'TRIAGED',
        beforeRowVersion: 1,
        afterRowVersion: 2,
        changedFields: ['ASSIGNEE', 'REPORT_STATUS'],
        metadata: { kind: 'NONE_V1' },
        occurredAt: '2026-01-11T00:00:00.000Z'
      }
    ] as const
    for (const [index, row] of auditRows.entries()) {
      const operationId = `019d7100-0000-7000-8000-00000000009${index}`
      const requestId = `019d7100-0000-7000-8000-00000000010${index}`
      const digestItem = adminAuditLogItemSchema.parse({
        ...row,
        actor: {
          kind: 'ACCOUNT',
          actorId: REVIEWER_ID,
          role: 'ADMIN',
          label: 'DELETED_ADMIN'
        },
        contentDigest: '0'.repeat(64),
        operationId,
        requestId,
        environment: 'TEST'
      })
      const contentDigest = createHash('sha256')
        .update(createAdminAuditContentDigestPreimage(digestItem), 'utf8')
        .digest('hex')
      await adminClient.query(
        `INSERT INTO "AdminAuditLog" (
           "id", "command", "targetType", "targetId", "actorKind",
           "actorUserId", "actorId", "actorRole", "actorLabel",
           "actorSystemLabel", "beforeState", "afterState",
           "beforeRowVersion", "afterRowVersion", "changedFields", "metadata",
           "contentDigest", "operationId", "requestId", "environment",
           "occurredAt"
         ) VALUES (
           $1, $2, $3, $4, 'ACCOUNT', NULL, $5, 'ADMIN', 'DELETED_ADMIN', NULL,
           $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13,
           $14, 'TEST', $15::timestamptz
         )`,
        [
          row.id,
          row.command,
          row.targetType,
          row.targetId,
          REVIEWER_ID,
          row.beforeState,
          row.afterState,
          row.beforeRowVersion,
          row.afterRowVersion,
          JSON.stringify(row.changedFields),
          JSON.stringify(row.metadata),
          contentDigest,
          operationId,
          requestId,
          row.occurredAt
        ]
      )
    }
    await adminClient.query('COMMIT')
  } catch (error: unknown) {
    await adminClient.query('ROLLBACK')
    throw error
  }
}

const cleanupFixture = async (): Promise<void> => {
  await adminClient.query('BEGIN')
  try {
    await adminClient.query('SET LOCAL session_replication_role = replica')
    await adminClient.query(
      `DELETE FROM "AdminAuditLog" WHERE "id" = ANY($1::uuid[])`,
      [AUDIT_IDS]
    )
    await adminClient.query(
      `DELETE FROM "QuestionReport" WHERE "id" = ANY($1::uuid[])`,
      [REPORT_IDS]
    )
    await adminClient.query(
      `DELETE FROM "ContentReview" WHERE "questionVersionId" = ANY($1::uuid[])`,
      [versionIds]
    )
    await adminClient.query(
      `DELETE FROM "StudyAnswer" WHERE "questionVersionId" = ANY($1::uuid[])`,
      [versionIds]
    )
    await adminClient.query(
      `DELETE FROM "QuestionVersionTag" WHERE "questionVersionId" = ANY($1::uuid[])`,
      [versionIds]
    )
    await adminClient.query(
      `DELETE FROM "QuestionOption" WHERE "questionVersionId" = ANY($1::uuid[])`,
      [versionIds]
    )
    await adminClient.query(`DELETE FROM "Tag" WHERE "id" = ANY($1::uuid[])`, [
      TAG_IDS
    ])
    await adminClient.query(
      `DELETE FROM "QuestionVersion" WHERE "id" = ANY($1::uuid[])`,
      [versionIds]
    )
    await adminClient.query(
      `DELETE FROM "Question" WHERE "id" = ANY($1::uuid[])`,
      [questionIds]
    )
    await adminClient.query('COMMIT')
  } catch (error: unknown) {
    await adminClient.query('ROLLBACK')
    throw error
  }
}

interface ExplainNode {
  'Actual Rows'?: number
  'Node Type'?: string
  Plans?: readonly ExplainNode[]
  'Shared Hit Blocks'?: number
  'Shared Read Blocks'?: number
  'Sort Method'?: string
}

interface ExplainRow {
  'QUERY PLAN': readonly [{ Plan: ExplainNode }]
}

const flattenPlan = (node: ExplainNode): readonly ExplainNode[] => [
  node,
  ...(node.Plans ?? []).flatMap(flattenPlan)
]

interface DomainTableCounts {
  adminAuditLogs: number
  contentReviews: number
  questionOptions: number
  questionReports: number
  questions: number
  questionVersionTags: number
  questionVersions: number
  tags: number
}

const readDomainTableCounts = async (): Promise<DomainTableCounts> => {
  const result = await adminClient.query<DomainTableCounts>(
    `SELECT
       (SELECT count(*)::int FROM "Question") AS "questions",
       (SELECT count(*)::int FROM "QuestionVersion") AS "questionVersions",
       (SELECT count(*)::int FROM "QuestionOption") AS "questionOptions",
       (SELECT count(*)::int FROM "Tag") AS "tags",
       (SELECT count(*)::int FROM "QuestionVersionTag") AS "questionVersionTags",
       (SELECT count(*)::int FROM "ContentReview") AS "contentReviews",
       (SELECT count(*)::int FROM "QuestionReport") AS "questionReports",
       (SELECT count(*)::int FROM "AdminAuditLog") AS "adminAuditLogs"`
  )
  const counts = result.rows[0]
  if (!counts) throw new Error('Phase 7 domain table counts are unavailable.')
  return counts
}

const apiEnvironment = parseApiEnvironment({
  NODE_ENV: 'test',
  ADMIN_CMS_MODE: 'technical',
  DATABASE_URL: applicationDatabaseUrl,
  AUTH_GATEWAY_DATABASE_URL: authGatewayDatabaseUrl,
  TRUSTED_ORIGINS: 'http://localhost:5173',
  BETTER_AUTH_SECRET: 'a'.repeat(32),
  GUEST_COOKIE_SECRET: 'b'.repeat(32),
  AUTH_EMAIL_FROM: 'auth@example.com'
})

const questionReader: QuestionReader = {
  getQuestion: async () => Promise.reject(new Error('not used')),
  listQuestions: async (query) => ({
    items: [],
    page: query.page,
    pageSize: query.pageSize,
    total: 0
  })
}

const guestPrincipalService: GuestPrincipalService = {
  clear: vi.fn(),
  create: vi.fn(),
  deleteExpired: vi.fn(),
  inspectCookie: vi.fn(() => ({ kind: 'ABSENT' }) as const),
  prepareCredential: vi.fn(),
  resolveExisting: vi.fn()
}

const integrationAdminUser = {
  id: REVIEWER_ID,
  name: '통합 관리자',
  role: 'ADMIN',
  targetLevel: null
} as const

const principalService: PrincipalService = {
  resolveAuthenticatedUser: vi.fn(async () => ({
    clearSessionCookie: false,
    headers: new Headers(),
    user: integrationAdminUser
  })),
  getAuthenticatedUser: vi.fn(async () => integrationAdminUser)
}

const rateLimiter: AdminReadRateLimiter = {
  consume: async () => undefined
}

interface RouteCase {
  readonly name: string
  readonly url: string
  readonly assertBody: (raw: unknown) => string | null
  readonly cursor?: {
    readonly url: (cursor: string) => string
    readonly assertBody: (raw: unknown) => void
  }
}

const routeCases: readonly RouteCase[] = [
  {
    name: 'question list',
    url: '/api/v1/admin/questions?pageSize=100',
    assertBody: (raw) => {
      const parsed = listAdminQuestionsResponseSchema.parse(raw)
      expect(parsed.items).toHaveLength(3)
      const serialized = JSON.stringify(parsed)
      for (const forbidden of [
        'correctOptionId',
        'explanationKo',
        'explanationJa',
        'options'
      ]) {
        expect(serialized).not.toContain(forbidden)
      }
      return null
    }
  },
  {
    name: 'question detail',
    url: `/api/v1/admin/questions/${QUESTION_IDS.candidate}`,
    assertBody: (raw) => {
      const parsed = getAdminQuestionResponseSchema.parse(raw)
      expect(parsed.question.questionId).toBe(QUESTION_IDS.candidate)
      const serialized = JSON.stringify(parsed)
      expect(serialized).not.toContain('correctOptionId')
      expect(serialized).not.toContain('explanationKo')
      expect(serialized).not.toContain('options')
      return null
    }
  },
  {
    name: 'tag autocomplete',
    url: '/api/v1/admin/tags?q=candidate',
    assertBody: (raw) => {
      const parsed = listAdminTagsResponseSchema.parse(raw)
      expect(parsed.items.map((item) => item.normalizedName)).toContain(
        'candidate-selected'
      )
      return null
    }
  },
  {
    name: 'version preview',
    url: `/api/v1/admin/question-versions/${VERSION_IDS.candidateOpen}/preview`,
    assertBody: (raw) => {
      const parsed = previewQuestionVersionResponseSchema.parse(raw)
      expect(parsed.question.options).toHaveLength(4)
      expect(parsed.question.tags.length).toBeGreaterThan(0)
      expect(
        parsed.question.options.some(
          (option) => option.id === parsed.adminAnswer.correctOptionId
        )
      ).toBe(true)
      expect(JSON.stringify(parsed.question)).not.toContain('correctOptionId')
      return null
    }
  },
  {
    name: 'version diff',
    url: `/api/v1/admin/question-versions/${VERSION_IDS.candidateOpen}/diff?baseVersionId=${VERSION_IDS.candidatePublished}`,
    assertBody: (raw) => {
      const parsed = diffQuestionVersionResponseSchema.parse(raw)
      expect(parsed.baseVersionId).toBe(VERSION_IDS.candidatePublished)
      expect(parsed.targetVersionId).toBe(VERSION_IDS.candidateOpen)
      const optionChange = parsed.changes.find(
        (change) => change.kind === 'OPTIONS'
      )
      expect(optionChange).toBeDefined()
      expect(JSON.stringify(optionChange)).not.toContain('"id"')
      return null
    }
  },
  {
    name: 'version history',
    url: `/api/v1/admin/questions/${QUESTION_IDS.candidate}/versions?limit=1`,
    assertBody: (raw) => {
      const parsed = listAdminQuestionVersionsResponseSchema.parse(raw)
      expect(parsed.items).toHaveLength(1)
      expect(JSON.stringify(parsed)).not.toContain('correctOptionId')
      expect(parsed.nextCursor).not.toBeNull()
      return parsed.nextCursor
    },
    cursor: {
      url: (cursor) =>
        `/api/v1/admin/questions/${QUESTION_IDS.candidate}/versions?limit=1&cursor=${encodeURIComponent(cursor)}`,
      assertBody: (raw) => {
        expect(
          listAdminQuestionVersionsResponseSchema.parse(raw).items
        ).toHaveLength(1)
      }
    }
  },
  {
    name: 'review history',
    url: `/api/v1/admin/question-versions/${VERSION_IDS.candidateOpen}/reviews?limit=1`,
    assertBody: (raw) => {
      const parsed = listQuestionVersionReviewsResponseSchema.parse(raw)
      expect(parsed.items).toHaveLength(1)
      expect(parsed.nextCursor).not.toBeNull()
      return parsed.nextCursor
    },
    cursor: {
      url: (cursor) =>
        `/api/v1/admin/question-versions/${VERSION_IDS.candidateOpen}/reviews?limit=1&cursor=${encodeURIComponent(cursor)}`,
      assertBody: (raw) => {
        expect(
          listQuestionVersionReviewsResponseSchema.parse(raw).items
        ).toHaveLength(1)
      }
    }
  },
  {
    name: 'audit log',
    url: '/api/v1/admin/audit-log?environment=TEST&limit=1',
    assertBody: (raw) => {
      const parsed = listAdminAuditLogResponseSchema.parse(raw)
      expect(parsed.items).toHaveLength(1)
      expect(parsed.items[0]?.contentDigest).toMatch(/^[0-9a-f]{64}$/u)
      expect(parsed.nextCursor).not.toBeNull()
      return parsed.nextCursor
    },
    cursor: {
      url: (cursor) =>
        `/api/v1/admin/audit-log?environment=TEST&limit=1&cursor=${encodeURIComponent(cursor)}`,
      assertBody: (raw) => {
        expect(listAdminAuditLogResponseSchema.parse(raw).items).toHaveLength(1)
      }
    }
  }
]

let baselineDomainTableCounts: DomainTableCounts

beforeAll(async () => {
  await adminClient.connect()
  databaseRuntime = createDatabaseRuntime(applicationDatabaseUrl, {
    migrationProfile: 'current',
    startupRole: 'nihongo_app'
  })
  repository = createPrismaAdminQuestionRepository(databaseRuntime.client)
  service = createAdminQuestionService(repository)
  await seedFixture()
  app = createApiApp({
    admin: {
      assertCapability: async () => undefined,
      rateLimiter,
      reader: service
    },
    auth: {
      environment: apiEnvironment,
      gateway: { handle: vi.fn() },
      guestPrincipalService,
      principalService
    },
    checkReadiness: async () => undefined,
    logger: createJsonLogger('silent'),
    questionReader
  })
  baselineDomainTableCounts = await readDomainTableCounts()
}, 30_000)

afterAll(async () => {
  await cleanupFixture()
  await Promise.all([databaseRuntime.disconnect(), adminClient.end()])
})

describe('Phase 7 admin read TEST database integration', () => {
  it('produces canonical cursor-backed review and audit service DTOs', async () => {
    const reviews = await service.listReviews(VERSION_IDS.candidateOpen, {
      limit: 1
    })
    expect(
      listQuestionVersionReviewsResponseSchema.parse(reviews).items
    ).toHaveLength(1)

    const audit = await service.listAuditLog({ environment: 'TEST', limit: 1 })
    expect(listAdminAuditLogResponseSchema.parse(audit).items).toHaveLength(1)
  })

  it.each(routeCases)(
    'serves $name through Hono → service → PostgreSQL',
    async ({ assertBody, cursor, url }) => {
      const response = await app.request(url)
      const raw = await response.json()

      expect(response.status).toBe(200)
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/u)
      const nextCursor = assertBody(raw)

      if (cursor !== undefined) {
        expect(nextCursor).not.toBeNull()
        const follow = await app.request(cursor.url(nextCursor!))
        expect(follow.status).toBe(200)
        expect(follow.headers.get('Cache-Control')).toBe('private, no-store')
        cursor.assertBody(await follow.json())
      }
    }
  )

  it('keeps every CMS domain table unchanged across all read routes', async () => {
    expect(await readDomainTableCounts()).toEqual(baselineDomainTableCounts)
  })

  it('selects candidate, then current published, then highest retained with selected-version stats', async () => {
    const response = await service.listQuestions(
      listAdminQuestionsQuerySchema.parse({ pageSize: 100 })
    )
    expect(response.items.map((item) => item.questionId)).toEqual([
      QUESTION_IDS.fallback,
      QUESTION_IDS.published,
      QUESTION_IDS.candidate
    ])
    const candidate = response.items.find(
      (item) => item.questionId === QUESTION_IDS.candidate
    )
    const published = response.items.find(
      (item) => item.questionId === QUESTION_IDS.published
    )
    const fallback = response.items.find(
      (item) => item.questionId === QUESTION_IDS.fallback
    )
    expect(candidate).toMatchObject({
      selectedVersionId: VERSION_IDS.candidateOpen,
      currentPublishedVersionId: VERSION_IDS.candidatePublished,
      openCandidateVersionId: VERSION_IDS.candidateOpen,
      answerCount: 3,
      correctRateBasisPoints: 6667,
      openReportCount: 2,
      latestReviewer: { actorId: REVIEWER_ID }
    })
    expect(published).toMatchObject({
      selectedVersionId: VERSION_IDS.publishedCurrent,
      openCandidateVersionId: null,
      answerCount: 0,
      correctRateBasisPoints: null
    })
    expect(fallback).toMatchObject({
      selectedVersionId: VERSION_IDS.fallbackHighest,
      currentPublishedVersionId: null,
      openCandidateVersionId: null,
      answerCount: 2,
      correctRateBasisPoints: 5000
    })
    const serialized = JSON.stringify(response)
    expect(serialized).not.toContain('correctOptionId')
    expect(serialized).not.toContain('explanationKo')
    expect(serialized).not.toContain('options')
  })

  it('binds pagination, selected-version prefix/tag and latest-reviewer filters', async () => {
    const first = await service.listQuestions(
      listAdminQuestionsQuerySchema.parse({ page: 1, pageSize: 2 })
    )
    const second = await service.listQuestions(
      listAdminQuestionsQuerySchema.parse({ page: 2, pageSize: 2 })
    )
    expect(first).toMatchObject({ page: 1, pageSize: 2, total: 3 })
    expect(first.items.map((item) => item.questionId)).toEqual([
      QUESTION_IDS.fallback,
      QUESTION_IDS.published
    ])
    expect(second.items.map((item) => item.questionId)).toEqual([
      QUESTION_IDS.candidate
    ])
    const filteredResponses: ListAdminQuestionsResponse[] = []
    for (const query of [
      { q: '후보' },
      { tag: 'candidate-selected' },
      { reviewerActorId: REVIEWER_ID }
    ]) {
      filteredResponses.push(
        await service.listQuestions(listAdminQuestionsQuerySchema.parse(query))
      )
    }
    for (const response of filteredResponses) {
      expect(response.total).toBe(1)
      expect(response.items[0]?.questionId).toBe(QUESTION_IDS.candidate)
    }
    const historicalTag = await service.listQuestions(
      listAdminQuestionsQuerySchema.parse({ tag: 'published-decoy' })
    )
    expect(historicalTag).toMatchObject({ items: [], total: 0 })
  })

  it('scopes detail audit summary to QUESTION and owned QUESTION_VERSION targets', async () => {
    const detail = await service.getQuestion(QUESTION_IDS.candidate)
    expect(detail.question).toMatchObject({
      questionId: QUESTION_IDS.candidate,
      currentPublishedVersionId: VERSION_IDS.candidatePublished,
      openCandidateVersionId: VERSION_IDS.candidateOpen
    })
    expect(detail.versions.items.map((item) => item.questionVersionId)).toEqual(
      [VERSION_IDS.candidateOpen, VERSION_IDS.candidatePublished]
    )
    expect(detail.auditSummary).toEqual({
      lastCommand: 'REVIEW_REQUEST',
      lastActor: {
        kind: 'ACCOUNT',
        actorId: REVIEWER_ID,
        role: 'ADMIN',
        label: 'DELETED_ADMIN'
      },
      lastOccurredAt: '2026-01-10T00:00:00.000Z',
      totalCount: 2
    })
  })

  it('executes the production list SQL with a bounded, in-memory TEST plan', async () => {
    const query = buildAdminQuestionPageQuery({
      sort: 'UPDATED_DESC',
      page: 1,
      pageSize: 100
    })
    expect(query.sql).not.toContain('correctOptionId')
    expect(query.sql).not.toContain('explanationKo')
    expect(query.sql).not.toContain('QuestionOption')

    const rows = await databaseRuntime.client.$queryRaw<
      ExplainRow[]
    >(Prisma.sql`
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      ${query}
    `)
    const plan = rows[0]?.['QUERY PLAN'][0]?.Plan
    if (!plan)
      throw new Error('Admin question list EXPLAIN plan is unavailable.')
    const nodes = flattenPlan(plan)
    expect(nodes.some((node) => node['Node Type'] === 'Limit')).toBe(true)
    expect(
      nodes.filter((node) =>
        node['Sort Method']?.toLowerCase().includes('external')
      )
    ).toEqual([])
    expect(
      Math.max(...nodes.map((node) => node['Actual Rows'] ?? 0))
    ).toBeLessThanOrEqual(11)
    expect(
      (plan['Shared Hit Blocks'] ?? 0) + (plan['Shared Read Blocks'] ?? 0)
    ).toBeLessThan(1_000)
  })
})
