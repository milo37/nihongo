import { createHash, randomUUID } from 'node:crypto'
import {
  applyQuestionImportRequestSchema,
  assertAdminImportApplyForRequest,
  assertAdminImportValidationForRequest,
  assertAdminQuestionExportDocumentForRequest,
  assertCreateAdminQuestionResponse,
  assertCreateAdminQuestionVersionResponse,
  assertCreateQuestionReportForRequest,
  assertApproveQuestionVersionResponse,
  assertArchiveAdminQuestionResponse,
  assertPublishQuestionVersionResponse,
  assertRequestContentReviewBatchResponse,
  assertRequestContentReviewResponse,
  assertRequestQuestionChangesResponse,
  assertResolveAdminQuestionReportResponse,
  assertRetireQuestionVersionResponse,
  assertTriageAdminQuestionReportResponse,
  assertUpdateQuestionVersionResponse,
  approveQuestionVersionRequestSchema,
  archiveAdminQuestionRequestSchema,
  createQuestionReportRequestSchema,
  createAdminQuestionRequestSchema,
  createAdminQuestionVersionRequestSchema,
  createPhase7QuestionDuplicateIdentity,
  exportAdminQuestionsRequestSchema,
  listAdminQuestionReportsQuerySchema,
  publishQuestionVersionRequestSchema,
  requestContentReviewBatchRequestSchema,
  requestContentReviewRequestSchema,
  requestQuestionChangesRequestSchema,
  resolveAdminQuestionReportRequestSchema,
  retireQuestionVersionRequestSchema,
  triageAdminQuestionReportRequestSchema,
  updateQuestionVersionRequestSchema,
  validateQuestionImportRequestSchema,
  type AdminImportItem,
  type AdminQuestionMutationResult,
  type CreateAdminQuestionRequest,
  type Sha256TextPort,
  type UpdateQuestionVersionRequest
} from '@nihongo/contracts/admin/phase7'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { createPrismaBookmarkRepository } from '../bookmark/bookmarkRepository.js'
import {
  createDatabaseRuntime,
  createRoleDatabaseRuntime,
  type DatabaseRuntime,
  type RoleDatabaseRuntime
} from '../db/database.js'
import { createPostgresStartupOptions } from '../db/databaseOptions.js'
import { ApplicationError } from '../errors/applicationError.js'
import { createPrismaQuestionRepository } from '../question/questionRepository.js'
import {
  createPrismaStudySessionRepository,
  NoEligibleQuestionsError
} from '../study/studySessionRepository.js'
import { createPrismaStudySubmissionRepository } from '../study/studySubmissionRepository.js'
import { createPrismaWrongNoteRepository } from '../wrong-note/wrongNoteRepository.js'
import { createWrongNoteService } from '../wrong-note/wrongNoteService.js'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import {
  createPreparedAdminQuestionCommandRepository,
  type AdminCommandAuthority
} from './adminQuestionCommandRepository.js'
import {
  createAdminQuestionCommandService,
  createAdminQuestionPublicationCommandService,
  createAdminQuestionSlice5CommandService,
  type AdminQuestionCommandService,
  type AdminQuestionPublicationCommandService,
  type AdminQuestionSlice5CommandService
} from './adminQuestionCommandService.js'
import { createPrismaAdminQuestionSlice5Repository } from './adminQuestionSlice5Repository.js'
import { createPrismaQuestionReportRepository } from './questionReportRepository.js'
import {
  createQuestionReportService,
  type QuestionReportService
} from './questionReportService.js'

const requireEnvironmentValue = (name: string): string => {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Phase 7 admin command integration requires ${name}.`)
  }
  return value
}

const adminDatabaseUrl = requireEnvironmentValue(
  'PHASE7_API_ADMIN_DATABASE_URL'
)
const applicationDatabaseUrl = requireEnvironmentValue('DATABASE_URL')
const authGatewayDatabaseUrl = requireEnvironmentValue(
  'AUTH_GATEWAY_DATABASE_URL'
)
const erasureWorkerDatabaseUrl = requireEnvironmentValue(
  'PHASE7_API_ERASURE_DATABASE_URL'
)
const schemaName = new URL(adminDatabaseUrl).searchParams.get('schema')
if (!schemaName || !/^phase7_[a-f0-9]{32}_test$/u.test(schemaName)) {
  throw new Error(
    'Phase 7 admin command integration received an unsafe schema.'
  )
}

const authorId = randomUUID()
const reviewerId = randomUUID()
const learnerId = randomUUID()
const revocationLearnerId = randomUUID()
const erasureLearnerId = randomUUID()
const actorIds = [
  authorId,
  reviewerId,
  learnerId,
  revocationLearnerId,
  erasureLearnerId
]
const authorToken = `phase7-command-author-${randomUUID()}`
const reviewerToken = `phase7-command-reviewer-${randomUUID()}`
const learnerToken = `phase7-command-learner-${randomUUID()}`
const adminClient = new Client({
  connectionString: adminDatabaseUrl,
  options: createPostgresStartupOptions(schemaName)
})
const erasureWorkerClient = new Client({
  connectionString: erasureWorkerDatabaseUrl,
  options: createPostgresStartupOptions(schemaName)
})

let adminConnected = false
let erasureWorkerConnected = false
let applicationRuntime: DatabaseRuntime | undefined
let authGatewayRuntime: RoleDatabaseRuntime | undefined
let commandService:
  | (AdminQuestionCommandService & AdminQuestionPublicationCommandService)
  | undefined
let slice5CommandService: AdminQuestionSlice5CommandService | undefined
let questionReportService: QuestionReportService | undefined
let baseQuestionId = ''
let baseQuestionRowVersion = 0
let baseQuestionUpdatedAt = new Date(0)
let tagName = ''

const insertCredentialUser = async (
  id: string,
  role: 'ADMIN' | 'USER' = 'ADMIN'
): Promise<void> => {
  const now = new Date()
  await adminClient.query('BEGIN')
  try {
    await adminClient.query(
      `INSERT INTO "User" (
         "id", "name", "email", "emailVerified", "role",
         "accountStatus", "createdAt", "updatedAt"
       ) VALUES (
         $1, 'Phase 7 command integration', $2, true, $4::"UserRole",
         'ACTIVE', $3, $3
       )`,
      [id, `phase7-command-${randomUUID()}@example.test`, now, role]
    )
    await adminClient.query(
      `INSERT INTO "Account" (
         "id", "accountId", "providerId", "userId", "password",
         "createdAt", "updatedAt"
       ) VALUES (
         $1, $2::uuid::text, 'credential', $2::uuid,
         'integration-password-hash', $3, $3
       )`,
      [randomUUID(), id, now]
    )
    await adminClient.query('COMMIT')
  } catch (error: unknown) {
    await adminClient.query('ROLLBACK')
    throw error
  }
}

const loadCanonicalContentFixture = async (): Promise<void> => {
  const result = await adminClient.query<{
    questionId: string
    rowVersion: number
    tagName: string
    updatedAt: Date
  }>(
    `SELECT question."id" AS "questionId",
       question."rowVersion",
       question."updatedAt",
       tag."label" AS "tagName"
     FROM "Question" AS question
     JOIN "QuestionVersion" AS version
       ON version."id" = question."currentPublishedVersionId"
     JOIN "QuestionVersionTag" AS assignment
       ON assignment."questionVersionId" = version."id"
     JOIN "Tag" AS tag ON tag."id" = assignment."tagId"
     JOIN "TagApplicability" AS applicability
       ON applicability."tagId" = tag."id"
      AND applicability."level" = version."level"
      AND applicability."subject" = version."subject"
      AND applicability."questionType" = version."questionType"
     WHERE question."createdByLabelSnapshot" = 'SYSTEM_SEED'
       AND question."lifecycleStatus" = 'ACTIVE'
       AND version."status" = 'PUBLISHED'
       AND version."level" = 'N5'
       AND version."subject" = 'VOCABULARY'
       AND version."questionType" = 'KANJI_READING'
     ORDER BY question."id", tag."normalizedName"
     LIMIT 1`
  )
  const fixture = result.rows[0]
  if (!fixture) {
    throw new Error('Canonical Phase 7 seed fixture is unavailable.')
  }
  baseQuestionId = fixture.questionId
  baseQuestionRowVersion = fixture.rowVersion
  baseQuestionUpdatedAt = fixture.updatedAt
  tagName = fixture.tagName
}

const issueSession = async (
  userId: string,
  token: string,
  role: 'ADMIN' | 'USER' = 'ADMIN'
): Promise<void> => {
  if (!authGatewayRuntime) {
    throw new Error('Phase 7 auth gateway runtime is unavailable.')
  }
  const rows = await authGatewayRuntime.client.$queryRawUnsafe<
    Array<{ id: string }>
  >(
    `SELECT * FROM "phase7_issue_v1_session"(
       $1, 1, $4::"UserRole", 'ACTIVE', $2, $3,
       '127.0.0.1', 'phase7-command-integration', false
     )`,
    userId,
    randomUUID(),
    token,
    role
  )
  if (rows.length !== 1) {
    throw new Error('Phase 7 command integration session was not issued.')
  }
}

const authority = (actorId: string, rawSessionToken: string) =>
  ({
    actorId,
    rawSessionToken,
    requestId: randomUUID()
  }) satisfies AdminCommandAuthority

const sha256Port: Sha256TextPort = {
  digestUtf8: async (value) =>
    createHash('sha256').update(value, 'utf8').digest('hex')
}

const describeFailure = (value: unknown, depth = 0): string => {
  if (depth >= 5 || !(value instanceof Error)) return String(value)
  const details = value as Error & {
    readonly code?: unknown
    readonly disposition?: unknown
    readonly phase7Disposition?: unknown
  }
  const code = typeof details.code === 'string' ? `:${details.code}` : ''
  const dispositionValue =
    typeof details.phase7Disposition === 'string'
      ? details.phase7Disposition
      : typeof details.disposition === 'string'
        ? details.disposition
        : ''
  const disposition = dispositionValue === '' ? '' : `:${dispositionValue}`
  const cause = value.cause
  return `${value.name}:${value.message}${code}${disposition}${
    cause === undefined ? '' : ` <- ${describeFailure(cause, depth + 1)}`
  }`
}

const createContent = (suffix: string): CreateAdminQuestionRequest =>
  createAdminQuestionRequestSchema.parse({
    level: 'N5',
    subject: 'VOCABULARY',
    questionType: 'KANJI_READING',
    difficulty: 'NORMAL',
    questionText: `次の漢字の読み方を選んでください。${suffix}`,
    passage: null,
    explanationKo: `실제 PostgreSQL 명령 통합 해설 ${suffix}`,
    explanationJa: null,
    tagNames: [tagName],
    options: [
      { clientOptionKey: 'a', text: `かな-${suffix}` },
      { clientOptionKey: 'b', text: `かんじ-${suffix}` },
      { clientOptionKey: 'c', text: `ことば-${suffix}` },
      { clientOptionKey: 'd', text: `ぶんぽう-${suffix}` }
    ],
    correctOptionKey: 'a'
  })

const createDraftQuestion = async (
  suffix: string
): Promise<AdminQuestionMutationResult> => {
  if (!commandService) throw new Error('Command service is unavailable.')
  const content = createContent(suffix)
  return assertCreateAdminQuestionResponse(
    content,
    await commandService.createQuestion(
      authority(authorId, authorToken),
      content
    )
  )
}

const createImportItem = (suffix: string): AdminImportItem => ({
  clientItemId: `import-${suffix}`,
  content: createContent(`import-${suffix}`)
})

interface ApprovedQuestionFixture {
  questionId: string
  questionRowVersion: number
  versionId: string
  versionRowVersion: number
}

const prepareApprovedQuestion = async (
  suffix: string
): Promise<ApprovedQuestionFixture> => {
  if (!commandService) throw new Error('Command service is unavailable.')
  const content = createContent(suffix)
  const created = assertCreateAdminQuestionResponse(
    content,
    await commandService.createQuestion(
      authority(authorId, authorToken),
      content
    )
  )
  const versionId = created.questionVersionId
  if (!versionId) throw new Error('Created version ID is unavailable.')
  const reviewRequest = requestContentReviewRequestSchema.parse({
    expectedRowVersion: created.versionRowVersion
  })
  const inReview = assertRequestContentReviewResponse(
    { versionId },
    reviewRequest,
    await commandService.requestReview(
      authority(authorId, authorToken),
      versionId,
      reviewRequest
    )
  )
  const approvalRequest = approveQuestionVersionRequestSchema.parse({
    expectedRowVersion: inReview.versionRowVersion
  })
  const approved = assertApproveQuestionVersionResponse(
    { versionId },
    approvalRequest,
    await commandService.approveVersion(
      authority(reviewerId, reviewerToken),
      versionId,
      approvalRequest
    )
  )
  if (approved.versionRowVersion === null) {
    throw new Error('Approved version rowVersion is unavailable.')
  }
  return {
    questionId: created.questionId,
    questionRowVersion: approved.questionRowVersion,
    versionId,
    versionRowVersion: approved.versionRowVersion
  }
}

const prepareApprovedVersion = async (
  questionId: string,
  expectedQuestionRowVersion: number,
  suffix: string
): Promise<ApprovedQuestionFixture> => {
  if (!commandService) throw new Error('Command service is unavailable.')
  const request = createAdminQuestionVersionRequestSchema.parse({
    ...createContent(suffix),
    expectedQuestionRowVersion
  })
  const created = assertCreateAdminQuestionVersionResponse(
    { questionId },
    request,
    await commandService.createVersion(
      authority(authorId, authorToken),
      questionId,
      request
    )
  )
  const versionId = created.questionVersionId
  if (!versionId) throw new Error('Created version ID is unavailable.')
  const reviewRequest = requestContentReviewRequestSchema.parse({
    expectedRowVersion: created.versionRowVersion
  })
  const inReview = assertRequestContentReviewResponse(
    { versionId },
    reviewRequest,
    await commandService.requestReview(
      authority(authorId, authorToken),
      versionId,
      reviewRequest
    )
  )
  const approvalRequest = approveQuestionVersionRequestSchema.parse({
    expectedRowVersion: inReview.versionRowVersion
  })
  const approved = assertApproveQuestionVersionResponse(
    { versionId },
    approvalRequest,
    await commandService.approveVersion(
      authority(reviewerId, reviewerToken),
      versionId,
      approvalRequest
    )
  )
  if (approved.versionRowVersion === null) {
    throw new Error('Approved version rowVersion is unavailable.')
  }
  return {
    questionId,
    questionRowVersion: approved.questionRowVersion,
    versionId,
    versionRowVersion: approved.versionRowVersion
  }
}

interface LearnerSnapshot {
  answerId: string
  bookmarkId: string
  currentReviewQuestionVersionId: string
  lastWrongQuestionVersionId: string
  resultId: string
  reviewScheduleId: string
  sessionQuestionId: string
  sessionQuestionVersionId: string
  studySessionId: string
  wrongNoteId: string
}

const insertLearnerSnapshot = async (
  questionId: string,
  versionId: string
): Promise<LearnerSnapshot> => {
  const ids: LearnerSnapshot = {
    answerId: randomUUID(),
    bookmarkId: randomUUID(),
    currentReviewQuestionVersionId: versionId,
    lastWrongQuestionVersionId: versionId,
    resultId: randomUUID(),
    reviewScheduleId: randomUUID(),
    sessionQuestionId: randomUUID(),
    sessionQuestionVersionId: versionId,
    studySessionId: randomUUID(),
    wrongNoteId: randomUUID()
  }
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000)
  await adminClient.query('BEGIN')
  try {
    await adminClient.query('SET LOCAL session_replication_role = replica')
    await adminClient.query(
      `INSERT INTO "StudySession" (
         "id", "userId", "level", "subject", "mode", "status",
         "requestedCount", "actualCount", "usedFallback", "startedAt",
         "expiresAt", "submittedAt", "durationSec", "submissionHash",
         "practiceContractVersion", "createdAt", "updatedAt"
       ) VALUES (
         $1, $2, 'N5', 'VOCABULARY', 'RANDOM', 'SUBMITTED',
         1, 1, false, $3, $4, $3, 10, repeat('a', 64), 1, $3, $3
       )`,
      [ids.studySessionId, learnerId, now, expiresAt]
    )
    await adminClient.query(
      `INSERT INTO "StudySessionQuestion" (
         "id", "studySessionId", "questionId", "questionVersionId",
         "ordinal", "createdAt"
       ) VALUES ($1, $2, $3, $4, 1, $5)`,
      [ids.sessionQuestionId, ids.studySessionId, questionId, versionId, now]
    )
    await adminClient.query(
      `INSERT INTO "StudyResult" (
         "id", "studySessionId", "totalCount", "correctCount",
         "incorrectCount", "correctRateBasisPoints", "durationSec",
         "gradingVersion", "createdAt"
       ) VALUES ($1, $2, 1, 0, 1, 0, 10, 'server-grading-v1', $3)`,
      [ids.resultId, ids.studySessionId, now]
    )
    await adminClient.query(
      `INSERT INTO "StudyAnswer" (
         "id", "studySessionQuestionId", "questionVersionId",
         "selectedOptionId", "isCorrect", "elapsedSec", "gradingVersion",
         "answeredAt", "gradedAt"
       ) VALUES ($1, $2, $3, NULL, false, 10, 'server-grading-v1', $4, $4)`,
      [ids.answerId, ids.sessionQuestionId, versionId, now]
    )
    await adminClient.query(
      `INSERT INTO "WrongNote" (
         "id", "userId", "questionId", "lastWrongQuestionVersionId",
         "currentReviewQuestionVersionId", "wrongCount", "correctStreak",
         "status", "lastWrongAt", "createdAt", "updatedAt"
       ) VALUES ($1, $2, $3, $4, $4, 1, 0, 'NEW', $5, $5, $5)`,
      [ids.wrongNoteId, learnerId, questionId, versionId, now]
    )
    await adminClient.query(
      `INSERT INTO "ReviewSchedule" (
         "id", "wrongNoteId", "nextReviewAt", "intervalDays",
         "algorithmVersion", "updatedAt"
       ) VALUES ($1, $2, $3, 1, 1, $4)`,
      [
        ids.reviewScheduleId,
        ids.wrongNoteId,
        new Date(now.getTime() + 24 * 60 * 60 * 1_000),
        now
      ]
    )
    await adminClient.query(
      `INSERT INTO "Bookmark" (
         "id", "userId", "questionId", "createdAt"
       ) VALUES ($1, $2, $3, $4)`,
      [ids.bookmarkId, learnerId, questionId, now]
    )
    await adminClient.query('SET LOCAL session_replication_role = origin')
    await adminClient.query('COMMIT')
  } catch (error: unknown) {
    await adminClient.query('ROLLBACK')
    throw error
  }
  return ids
}

const readLearnerSnapshot = async (
  questionId: string,
  studySessionId: string
): Promise<LearnerSnapshot> => {
  const result = await adminClient.query<LearnerSnapshot>(
    `SELECT answer."id" AS "answerId", bookmark."id" AS "bookmarkId",
       note."currentReviewQuestionVersionId",
       note."lastWrongQuestionVersionId",
       result."id" AS "resultId", schedule."id" AS "reviewScheduleId",
       item."id" AS "sessionQuestionId",
       item."questionVersionId" AS "sessionQuestionVersionId",
       session."id" AS "studySessionId",
       note."id" AS "wrongNoteId"
     FROM "Bookmark" AS bookmark
     JOIN "WrongNote" AS note
       ON note."userId" = bookmark."userId"
      AND note."questionId" = bookmark."questionId"
     JOIN "StudySessionQuestion" AS item
       ON item."questionId" = bookmark."questionId"
     JOIN "StudySession" AS session ON session."id" = item."studySessionId"
     JOIN "StudyResult" AS result ON result."studySessionId" = session."id"
     JOIN "StudyAnswer" AS answer
       ON answer."studySessionQuestionId" = item."id"
     JOIN "ReviewSchedule" AS schedule ON schedule."wrongNoteId" = note."id"
     WHERE bookmark."userId" = $1 AND bookmark."questionId" = $2
       AND session."id" = $3`,
    [learnerId, questionId, studySessionId]
  )
  const snapshot = result.rows[0]
  if (!snapshot)
    throw new Error('Learner preservation snapshot is unavailable.')
  return snapshot
}

const readActualLearnerContracts = async (
  questionId: string,
  studySessionId: string
) => {
  if (!applicationRuntime) {
    throw new Error('Application runtime is unavailable for learner reads.')
  }
  const client = applicationRuntime.client
  const owner = { kind: 'USER', userId: learnerId } as const
  const questionRepository = createPrismaQuestionRepository(client)
  const bookmarkRepository = createPrismaBookmarkRepository(client)
  const wrongNoteService = createWrongNoteService(
    createPrismaWrongNoteRepository(client)
  )
  const studySessionRepository = createPrismaStudySessionRepository(client)
  const studySubmissionRepository =
    createPrismaStudySubmissionRepository(client)
  const observedAt = new Date()
  const [
    publicQuestion,
    publicQuestions,
    bookmarks,
    wrongNote,
    studySession,
    studyResult
  ] = await Promise.all([
    questionRepository.findPublishedById(questionId),
    questionRepository.listPublished({
      level: 'N5',
      subject: 'VOCABULARY',
      page: 1,
      pageSize: 100
    }),
    bookmarkRepository.listOwned({
      userId: learnerId,
      questionIds: [questionId],
      page: 1,
      pageSize: 20
    }),
    wrongNoteService.getWrongNote(learnerId, questionId),
    studySessionRepository.findOwnedById(studySessionId, owner, observedAt),
    studySubmissionRepository.findOwnedResult(studySessionId, owner, observedAt)
  ])
  const bookmark = bookmarks.items[0]
  if (bookmarks.total !== 1 || !bookmark || !studySession) {
    throw new Error('Actual learner contract fixture is incomplete.')
  }
  return {
    bookmark,
    publicQuestion,
    publicQuestions,
    studyResult,
    studySession,
    wrongNote
  }
}

const createBookmarkPractice = async () => {
  if (!applicationRuntime) {
    throw new Error('Application runtime is unavailable for learner practice.')
  }
  const startedAt = new Date()
  return await createPrismaStudySessionRepository(
    applicationRuntime.client
  ).create({
    expiresAt: new Date(startedAt.getTime() + 60 * 60 * 1_000),
    level: 'N5',
    mode: 'BOOKMARK',
    owner: { kind: 'USER', userId: learnerId },
    practiceContractVersion: 1,
    requestedCount: 1,
    startedAt,
    subject: 'VOCABULARY'
  })
}

const readCommandEvidence = async (requestId: string) => {
  const audit = await adminClient.query<{
    changedFields: string[]
    command: string
    contentDigestValid: boolean
    metadata: Record<string, unknown>
    operationId: string
  }>(
    `SELECT audit."command", audit."operationId",
       audit."changedFields" AS "changedFields",
       audit."metadata" AS metadata,
       audit."contentDigest" = "phase7_admin_audit_content_digest"(
         audit."operationId", audit."command", audit."targetType",
         audit."targetId", audit."beforeState", audit."afterState",
         audit."beforeRowVersion", audit."afterRowVersion",
         audit."changedFields", audit."metadata"
       ) AS "contentDigestValid"
     FROM "AdminAuditLog" AS audit WHERE audit."requestId" = $1`,
    [requestId]
  )
  const operationId = audit.rows[0]?.operationId
  const reviews = operationId
    ? await adminClient.query<{
        action: string
        counterpartActorId: string | null
        fromState: string
        reason: string | null
        toState: string
      }>(
        `SELECT "action", "counterpartActorId", "fromState", "reason",
           "toState"
         FROM "ContentReview" WHERE "operationId" = $1
         ORDER BY "questionVersionId"`,
        [operationId]
      )
    : { rows: [] }
  const intents = await adminClient.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM "Phase7OperationIntent"
     WHERE "requestId" = $1`,
    [requestId]
  )
  return {
    audit: audit.rows,
    intents: intents.rows[0]?.count ?? -1,
    reviews: reviews.rows
  }
}

const loadUpdateRequest = async ({
  expectedRowVersion,
  questionText,
  versionId
}: {
  expectedRowVersion: number
  questionText: string
  versionId: string
}): Promise<UpdateQuestionVersionRequest> => {
  const result = await adminClient.query<{
    id: string
    ordinal: number
    text: string
  }>(
    `SELECT "id", "ordinal", "text"
     FROM "QuestionOption" WHERE "questionVersionId" = $1
     ORDER BY "ordinal"`,
    [versionId]
  )
  const first = result.rows[0]
  if (!first || result.rows.length !== 4) {
    throw new Error('Phase 7 command integration options are unavailable.')
  }
  return updateQuestionVersionRequestSchema.parse({
    level: 'N5',
    subject: 'VOCABULARY',
    questionType: 'KANJI_READING',
    difficulty: 'NORMAL',
    questionText,
    passage: null,
    explanationKo: `수정된 실제 PostgreSQL 해설 ${questionText}`,
    explanationJa: null,
    tagNames: [tagName],
    options: result.rows,
    correctOptionId: first.id,
    expectedRowVersion
  })
}

const readVersionWriteCounts = async (
  versionId: string
): Promise<{ audit: number; review: number; rowVersion: number }> => {
  const result = await adminClient.query<{
    audit: number
    review: number
    rowVersion: number
  }>(
    `SELECT version."rowVersion",
       (SELECT COUNT(*)::int FROM "AdminAuditLog"
        WHERE "targetId" = version."id") AS audit,
       (SELECT COUNT(*)::int FROM "ContentReview"
        WHERE "questionVersionId" = version."id") AS review
     FROM "QuestionVersion" AS version WHERE version."id" = $1`,
    [versionId]
  )
  const row = result.rows[0]
  if (!row) throw new Error('Phase 7 version write counts are unavailable.')
  return row
}

const readGlobalWriteCounts = async (): Promise<{
  audit: number
  question: number
  review: number
  version: number
}> => {
  const result = await adminClient.query<{
    audit: number
    question: number
    review: number
    version: number
  }>(
    `SELECT
       (SELECT COUNT(*)::int FROM "Question") AS question,
       (SELECT COUNT(*)::int FROM "QuestionVersion") AS version,
       (SELECT COUNT(*)::int FROM "ContentReview") AS review,
       (SELECT COUNT(*)::int FROM "AdminAuditLog") AS audit`
  )
  const row = result.rows[0]
  if (!row) throw new Error('Phase 7 global write counts are unavailable.')
  return row
}

const cleanupFixtures = async (): Promise<void> => {
  if (!adminConnected) return
  await adminClient.query('BEGIN')
  try {
    await adminClient.query('SET LOCAL session_replication_role = replica')
    const questions = await adminClient.query<{ id: string }>(
      `SELECT "id" FROM "Question"
       WHERE "createdByUserId" = ANY($1::uuid[])`,
      [actorIds]
    )
    const questionIds = questions.rows.map(({ id }) => id)
    const versions = await adminClient.query<{ id: string }>(
      `SELECT "id" FROM "QuestionVersion"
       WHERE "createdByUserId" = ANY($1::uuid[])`,
      [actorIds]
    )
    const versionIds = versions.rows.map(({ id }) => id)
    const studySessions = await adminClient.query<{ id: string }>(
      `SELECT "id" FROM "StudySession" WHERE "userId" = ANY($1::uuid[])`,
      [actorIds]
    )
    const studySessionIds = studySessions.rows.map(({ id }) => id)
    await adminClient.query(
      `DELETE FROM "QuestionReport"
       WHERE "reporterUserId" = ANY($1::uuid[])
          OR "assigneeUserId" = ANY($1::uuid[])
          OR "questionId" = ANY($2::uuid[])
          OR "questionVersionId" = ANY($3::uuid[])`,
      [actorIds, questionIds, versionIds]
    )
    await adminClient.query(
      `DELETE FROM "StudyAnswer"
       WHERE "studySessionQuestionId" IN (
         SELECT "id" FROM "StudySessionQuestion"
         WHERE "studySessionId" = ANY($1::uuid[])
       )`,
      [studySessionIds]
    )
    await adminClient.query(
      `DELETE FROM "StudyResult"
       WHERE "studySessionId" = ANY($1::uuid[])`,
      [studySessionIds]
    )
    await adminClient.query(
      `DELETE FROM "StudySessionQuestion"
       WHERE "studySessionId" = ANY($1::uuid[])`,
      [studySessionIds]
    )
    await adminClient.query(
      `DELETE FROM "StudySession" WHERE "id" = ANY($1::uuid[])`,
      [studySessionIds]
    )
    await adminClient.query(
      `DELETE FROM "ReviewSchedule"
       WHERE "wrongNoteId" IN (
         SELECT "id" FROM "WrongNote"
         WHERE "userId" = ANY($1::uuid[]) OR "questionId" = ANY($2::uuid[])
       )`,
      [actorIds, questionIds]
    )
    await adminClient.query(
      `DELETE FROM "WrongNote"
       WHERE "userId" = ANY($1::uuid[]) OR "questionId" = ANY($2::uuid[])`,
      [actorIds, questionIds]
    )
    await adminClient.query(
      `DELETE FROM "Bookmark"
       WHERE "userId" = ANY($1::uuid[]) OR "questionId" = ANY($2::uuid[])`,
      [actorIds, questionIds]
    )
    await adminClient.query(
      `DELETE FROM "Phase7OperationIntent"
       WHERE "actorUserId" = ANY($1::uuid[])`,
      [actorIds]
    )
    await adminClient.query(
      `DELETE FROM "AdminAuditLog"
       WHERE "actorUserId" = ANY($1::uuid[])
          OR "targetId" = ANY($2::uuid[])
          OR "targetId" = ANY($3::uuid[])`,
      [actorIds, questionIds, versionIds]
    )
    await adminClient.query(
      `DELETE FROM "ContentReview"
       WHERE "questionId" = ANY($1::uuid[])
          OR "questionVersionId" = ANY($2::uuid[])`,
      [questionIds, versionIds]
    )
    await adminClient.query(
      `DELETE FROM "QuestionVersionTag"
       WHERE "questionVersionId" = ANY($1::uuid[])`,
      [versionIds]
    )
    await adminClient.query(
      `DELETE FROM "QuestionOption"
       WHERE "questionVersionId" = ANY($1::uuid[])`,
      [versionIds]
    )
    await adminClient.query(
      `DELETE FROM "QuestionVersion" WHERE "id" = ANY($1::uuid[])`,
      [versionIds]
    )
    await adminClient.query(
      `DELETE FROM "Question" WHERE "id" = ANY($1::uuid[])`,
      [questionIds]
    )
    if (baseQuestionId !== '') {
      await adminClient.query(
        `UPDATE "Question"
         SET "rowVersion" = $2, "updatedAt" = $3
         WHERE "id" = $1`,
        [baseQuestionId, baseQuestionRowVersion, baseQuestionUpdatedAt]
      )
    }
    await adminClient.query(
      `DELETE FROM "Session" WHERE "userId" = ANY($1::uuid[])`,
      [actorIds]
    )
    await adminClient.query(
      `DELETE FROM "AuthSessionFamily" WHERE "userId" = ANY($1::uuid[])`,
      [actorIds]
    )
    await adminClient.query(
      `DELETE FROM "Account" WHERE "userId" = ANY($1::uuid[])`,
      [actorIds]
    )
    await adminClient.query(`DELETE FROM "User" WHERE "id" = ANY($1::uuid[])`, [
      actorIds
    ])
    await adminClient.query('SET LOCAL session_replication_role = origin')
    await adminClient.query('COMMIT')
  } catch (error: unknown) {
    await adminClient.query('ROLLBACK')
    throw error
  }
}

beforeAll(async () => {
  await adminClient.connect()
  adminConnected = true
  applicationRuntime = createDatabaseRuntime(applicationDatabaseUrl, {
    migrationProfile: 'current',
    startupRole: 'nihongo_app'
  })
  authGatewayRuntime = createRoleDatabaseRuntime(
    authGatewayDatabaseUrl,
    'nihongo_auth_gateway'
  )
  await erasureWorkerClient.connect()
  erasureWorkerConnected = true
  await erasureWorkerClient.query(`SET ROLE "nihongo_erasure_worker"`)
  await insertCredentialUser(authorId)
  await insertCredentialUser(reviewerId)
  await insertCredentialUser(learnerId, 'USER')
  await loadCanonicalContentFixture()
  await issueSession(authorId, authorToken)
  await issueSession(reviewerId, reviewerToken)
  await issueSession(learnerId, learnerToken, 'USER')
  const preparedRepository = createPreparedAdminQuestionCommandRepository({
    auditEnvironment: 'TEST',
    client: applicationRuntime.client
  })
  commandService = {
    ...createAdminQuestionCommandService(preparedRepository),
    ...createAdminQuestionPublicationCommandService(preparedRepository)
  }
  const slice5Repository = createPrismaAdminQuestionSlice5Repository({
    auditEnvironment: 'TEST',
    client: applicationRuntime.client
  })
  slice5CommandService =
    createAdminQuestionSlice5CommandService(slice5Repository)
  questionReportService = createQuestionReportService({
    rateLimiter: { consume: async () => undefined },
    repository: createPrismaQuestionReportRepository(applicationRuntime.client)
  })
}, 30_000)

afterAll(async () => {
  let cleanupError: unknown
  try {
    await cleanupFixtures()
  } catch (error: unknown) {
    cleanupError = error
  }
  await applicationRuntime?.disconnect()
  await authGatewayRuntime?.disconnect()
  if (erasureWorkerConnected) await erasureWorkerClient.end()
  if (adminConnected) await adminClient.end()
  if (cleanupError !== undefined) throw cleanupError
}, 30_000)

describe('Phase 7 ADMIN command TEST database integration', () => {
  it('executes the five Slice 3A command types with concurrency, SoD and atomic evidence', async () => {
    if (!commandService) throw new Error('Command service is unavailable.')
    const suffix = randomUUID()
    const content = createContent(suffix)
    const createAuthority = authority(authorId, authorToken)
    const createdRaw = await commandService.createQuestion(
      createAuthority,
      content
    )
    const created = assertCreateAdminQuestionResponse(content, createdRaw)
    const createdVersionId = created.questionVersionId
    if (!createdVersionId) throw new Error('Created version ID is unavailable.')

    const competingRequests = await Promise.all([
      loadUpdateRequest({
        expectedRowVersion: 1,
        questionText: `${content.questionText} 동시 수정 A`,
        versionId: createdVersionId
      }),
      loadUpdateRequest({
        expectedRowVersion: 1,
        questionText: `${content.questionText} 동시 수정 B`,
        versionId: createdVersionId
      })
    ])
    const updateAuthorities = [
      authority(authorId, authorToken),
      authority(authorId, authorToken)
    ] as const
    const outcomes = await Promise.allSettled(
      competingRequests.map((request, index) =>
        commandService!.updateVersion(
          updateAuthorities[index]!,
          createdVersionId,
          request
        )
      )
    )
    const winnerIndex = outcomes.findIndex(
      (outcome) => outcome.status === 'fulfilled'
    )
    const loser = outcomes.find((outcome) => outcome.status === 'rejected')
    expect(
      outcomes.filter(({ status }) => status === 'fulfilled')
    ).toHaveLength(1)
    expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(
      1
    )
    if (winnerIndex < 0 || !loser || loser.status !== 'rejected') {
      throw new Error('Concurrent update winner/loser is unavailable.')
    }
    assertUpdateQuestionVersionResponse(
      { versionId: createdVersionId },
      competingRequests[winnerIndex],
      (
        outcomes[
          winnerIndex
        ] as PromiseFulfilledResult<AdminQuestionMutationResult>
      ).value
    )
    const loserError: unknown = loser.reason
    expect(loserError).toBeInstanceOf(ApplicationError)
    expect(loserError).toMatchObject({ code: 'VERSION_CONFLICT' })

    const reviewRequest = requestContentReviewRequestSchema.parse({
      expectedRowVersion: 2,
      comment: '실제 DB 검수를 요청합니다.'
    })
    const reviewAuthority = authority(authorId, authorToken)
    const reviewRequested = assertRequestContentReviewResponse(
      { versionId: createdVersionId },
      reviewRequest,
      await commandService.requestReview(
        reviewAuthority,
        createdVersionId,
        reviewRequest
      )
    )
    expect(reviewRequested.versionStatus).toBe('IN_REVIEW')

    const beforeSelfDecision = await readVersionWriteCounts(createdVersionId)
    const selfChangeRequest = requestQuestionChangesRequestSchema.parse({
      expectedRowVersion: 3,
      reason: '작성자 본인의 검수 결정을 거부합니다.'
    })
    await expect(
      commandService.requestChanges(
        authority(authorId, authorToken),
        createdVersionId,
        selfChangeRequest
      )
    ).rejects.toMatchObject({
      code: 'SEPARATION_OF_DUTIES_VIOLATION',
      phase7Disposition: 'DEFINITE_ROLLBACK'
    })
    expect(await readVersionWriteCounts(createdVersionId)).toEqual(
      beforeSelfDecision
    )

    const changeRequest = requestQuestionChangesRequestSchema.parse({
      expectedRowVersion: 3,
      reason: '해설 근거 보완',
      comment: '근거를 더 명확히 적어 주세요.'
    })
    const changeAuthority = authority(reviewerId, reviewerToken)
    assertRequestQuestionChangesResponse(
      { versionId: createdVersionId },
      changeRequest,
      await commandService.requestChanges(
        changeAuthority,
        createdVersionId,
        changeRequest
      )
    )

    const revisedRequest = await loadUpdateRequest({
      expectedRowVersion: 4,
      questionText: `${content.questionText} 검수 반영`,
      versionId: createdVersionId
    })
    const revisedAuthority = authority(authorId, authorToken)
    assertUpdateQuestionVersionResponse(
      { versionId: createdVersionId },
      revisedRequest,
      await commandService.updateVersion(
        revisedAuthority,
        createdVersionId,
        revisedRequest
      )
    )

    const rereviewRequest = requestContentReviewRequestSchema.parse({
      expectedRowVersion: 5
    })
    const rereviewAuthority = authority(authorId, authorToken)
    assertRequestContentReviewResponse(
      { versionId: createdVersionId },
      rereviewRequest,
      await commandService.requestReview(
        rereviewAuthority,
        createdVersionId,
        rereviewRequest
      )
    )

    const versionContent = createContent(`new-version-${randomUUID()}`)
    const createVersionRequest = createAdminQuestionVersionRequestSchema.parse({
      ...versionContent,
      expectedQuestionRowVersion: 1
    })
    const createVersionAuthority = authority(authorId, authorToken)
    const createdVersion = assertCreateAdminQuestionVersionResponse(
      { questionId: baseQuestionId },
      createVersionRequest,
      await commandService.createVersion(
        createVersionAuthority,
        baseQuestionId,
        createVersionRequest
      )
    )
    expect(createdVersion).toMatchObject({
      questionId: baseQuestionId,
      questionRowVersion: 2,
      versionStatus: 'DRAFT',
      versionRowVersion: 1
    })

    const successfulAuthorities = [
      createAuthority,
      updateAuthorities[winnerIndex]!,
      reviewAuthority,
      changeAuthority,
      revisedAuthority,
      rereviewAuthority,
      createVersionAuthority
    ]
    const successfulRequestIds = successfulAuthorities.map(
      ({ requestId }) => requestId
    )
    const evidence = await adminClient.query<{
      auditCount: number
      environmentCount: number
      intentCount: number
      reviewCount: number
    }>(
      `SELECT
         (SELECT COUNT(*)::int FROM "AdminAuditLog"
          WHERE "requestId" = ANY($1::uuid[])) AS "auditCount",
         (SELECT COUNT(*)::int FROM "AdminAuditLog"
          WHERE "requestId" = ANY($1::uuid[]) AND "environment" = 'TEST')
            AS "environmentCount",
         (SELECT COUNT(*)::int FROM "ContentReview"
          WHERE "questionVersionId" = $2) AS "reviewCount",
         (SELECT COUNT(*)::int FROM "Phase7OperationIntent"
          WHERE "requestId" = ANY($1::uuid[])) AS "intentCount"`,
      [successfulRequestIds, createdVersionId]
    )
    expect(evidence.rows).toEqual([
      {
        auditCount: 7,
        environmentCount: 7,
        intentCount: 0,
        reviewCount: 3
      }
    ])

    const finalState = await adminClient.query<{
      fingerprint: string
      optionCount: number
      rowVersion: number
      status: string
      tagCount: number
    }>(
      `SELECT version."status", version."rowVersion",
         version."contentFingerprint" AS fingerprint,
         (SELECT COUNT(*)::int FROM "QuestionOption"
          WHERE "questionVersionId" = version."id") AS "optionCount",
         (SELECT COUNT(*)::int FROM "QuestionVersionTag"
          WHERE "questionVersionId" = version."id") AS "tagCount"
       FROM "QuestionVersion" AS version WHERE version."id" = $1`,
      [createdVersionId]
    )
    expect(finalState.rows).toEqual([
      expect.objectContaining({
        status: 'IN_REVIEW',
        rowVersion: 6,
        optionCount: 4,
        tagCount: 1,
        fingerprint: createHash('sha256')
          .update(
            createPhase7QuestionDuplicateIdentity({
              correctOptionText:
                revisedRequest.options.find(
                  ({ id }) => id === revisedRequest.correctOptionId
                )?.text ?? '',
              optionTexts: revisedRequest.options.map(({ text }) => text),
              passage: revisedRequest.passage,
              questionText: revisedRequest.questionText,
              questionType: revisedRequest.questionType,
              subject: revisedRequest.subject
            }),
            'utf8'
          )
          .digest('hex')
      })
    ])
    expect(finalState.rows[0]?.fingerprint).not.toBe('0'.repeat(64))

    const beforeDuplicate = await adminClient.query<{
      audit: number
      question: number
      review: number
      version: number
    }>(
      `SELECT
         (SELECT COUNT(*)::int FROM "Question") AS question,
         (SELECT COUNT(*)::int FROM "QuestionVersion") AS version,
         (SELECT COUNT(*)::int FROM "ContentReview") AS review,
         (SELECT COUNT(*)::int FROM "AdminAuditLog") AS audit`
    )
    await expect(
      commandService.createQuestion(
        authority(authorId, authorToken),
        versionContent
      )
    ).rejects.toMatchObject({
      code: 'DUPLICATE_QUESTION_CONTENT',
      phase7Disposition: 'NO_TX'
    })
    expect(
      await adminClient.query<{
        audit: number
        question: number
        review: number
        version: number
      }>(
        `SELECT
           (SELECT COUNT(*)::int FROM "Question") AS question,
           (SELECT COUNT(*)::int FROM "QuestionVersion") AS version,
           (SELECT COUNT(*)::int FROM "ContentReview") AS review,
           (SELECT COUNT(*)::int FROM "AdminAuditLog") AS audit`
      )
    ).toMatchObject({ rows: beforeDuplicate.rows })
  }, 60_000)

  it('executes publication, retirement and all archive shapes atomically', async () => {
    if (!commandService) throw new Error('Command service is unavailable.')

    const initial = await prepareApprovedQuestion(`publish-${randomUUID()}`)
    const publishRequest = publishQuestionVersionRequestSchema.parse({
      expectedRowVersion: initial.versionRowVersion,
      expectedQuestionRowVersion: initial.questionRowVersion
    })
    const publishAuthorities = [
      authority(authorId, authorToken),
      authority(authorId, authorToken)
    ] as const
    const publishOutcomes = await Promise.allSettled(
      publishAuthorities.map((commandAuthority) =>
        commandService!.publishVersion(
          commandAuthority,
          initial.versionId,
          publishRequest
        )
      )
    )
    const publishWinnerIndex = publishOutcomes.findIndex(
      ({ status }) => status === 'fulfilled'
    )
    const publishLoserIndex = publishOutcomes.findIndex(
      ({ status }) => status === 'rejected'
    )
    expect(
      publishOutcomes.filter(({ status }) => status === 'fulfilled')
    ).toHaveLength(1)
    expect(
      publishOutcomes.filter(({ status }) => status === 'rejected')
    ).toHaveLength(1)
    if (publishWinnerIndex < 0 || publishLoserIndex < 0) {
      throw new Error('Concurrent publication winner/loser is unavailable.')
    }
    const publishWinner = publishOutcomes[publishWinnerIndex]
    const publishLoser = publishOutcomes[publishLoserIndex]
    if (
      publishWinner?.status !== 'fulfilled' ||
      publishLoser?.status !== 'rejected'
    ) {
      throw new Error('Concurrent publication outcome is malformed.')
    }
    assertPublishQuestionVersionResponse(
      { versionId: initial.versionId },
      publishRequest,
      publishWinner.value
    )
    expect(publishLoser.reason).toBeInstanceOf(ApplicationError)
    expect(publishLoser.reason).toMatchObject({
      code: 'VERSION_CONFLICT',
      phase7Disposition: 'DEFINITE_ROLLBACK'
    })
    expect(
      await readCommandEvidence(
        publishAuthorities[publishLoserIndex]!.requestId
      )
    ).toEqual({ audit: [], intents: 0, reviews: [] })

    const initialPublicationEvidence = await readCommandEvidence(
      publishAuthorities[publishWinnerIndex]!.requestId
    )
    expect(initialPublicationEvidence).toMatchObject({
      audit: [
        {
          command: 'PUBLICATION',
          changedFields: ['VERSION_STATUS', 'CURRENT_PUBLISHED_VERSION_ID'],
          metadata: { kind: 'NONE_V1' },
          contentDigestValid: true
        }
      ],
      intents: 0,
      reviews: [
        {
          action: 'PUBLISHED',
          counterpartActorId: reviewerId,
          fromState: 'APPROVED',
          reason: null,
          toState: 'PUBLISHED'
        }
      ]
    })

    const learnerSnapshot = await insertLearnerSnapshot(
      initial.questionId,
      initial.versionId
    )
    expect(
      await readLearnerSnapshot(
        initial.questionId,
        learnerSnapshot.studySessionId
      )
    ).toEqual(learnerSnapshot)
    const learnerContractsBeforeReplacement = await readActualLearnerContracts(
      initial.questionId,
      learnerSnapshot.studySessionId
    )
    expect(learnerContractsBeforeReplacement.publicQuestion).toMatchObject({
      id: initial.questionId,
      questionVersionId: initial.versionId
    })
    expect(
      learnerContractsBeforeReplacement.publicQuestions.items.find(
        ({ id }) => id === initial.questionId
      )
    ).toMatchObject({
      id: initial.questionId,
      questionVersionId: initial.versionId
    })
    expect(learnerContractsBeforeReplacement.bookmark).toMatchObject({
      id: learnerSnapshot.bookmarkId,
      questionId: initial.questionId,
      availability: 'AVAILABLE',
      question: { questionVersionId: initial.versionId }
    })
    expect(learnerContractsBeforeReplacement.wrongNote).toMatchObject({
      lastWrongQuestionVersionId: initial.versionId,
      currentReviewQuestionVersionId: initial.versionId,
      question: { questionVersionId: initial.versionId },
      wrongNote: { reviewAvailability: 'AVAILABLE' }
    })
    expect(
      learnerContractsBeforeReplacement.studySession.questions[0]?.question
        .questionVersionId
    ).toBe(initial.versionId)
    expect(learnerContractsBeforeReplacement.studyResult).toMatchObject({
      kind: 'READY',
      response: {
        items: [
          {
            sessionQuestionId: learnerSnapshot.sessionQuestionId,
            question: { questionVersionId: initial.versionId }
          }
        ]
      }
    })
    const initialPractice = await createBookmarkPractice()
    expect(initialPractice.session.questions[0]?.question).toMatchObject({
      id: initial.questionId,
      questionVersionId: initial.versionId
    })

    const replacement = await prepareApprovedVersion(
      initial.questionId,
      initial.questionRowVersion + 1,
      `replacement-${randomUUID()}`
    )
    const replacementRequest = publishQuestionVersionRequestSchema.parse({
      expectedRowVersion: replacement.versionRowVersion,
      expectedQuestionRowVersion: replacement.questionRowVersion
    })
    const replacementAuthority = authority(authorId, authorToken)
    assertPublishQuestionVersionResponse(
      { versionId: replacement.versionId },
      replacementRequest,
      await commandService.publishVersion(
        replacementAuthority,
        replacement.versionId,
        replacementRequest
      )
    )
    const replacementEvidence = await readCommandEvidence(
      replacementAuthority.requestId
    )
    expect(replacementEvidence.audit).toEqual([
      expect.objectContaining({
        command: 'PUBLICATION',
        changedFields: ['VERSION_STATUS', 'CURRENT_PUBLISHED_VERSION_ID'],
        metadata: { kind: 'NONE_V1' },
        contentDigestValid: true
      })
    ])
    expect(replacementEvidence.intents).toBe(0)
    expect(replacementEvidence.reviews).toEqual(
      expect.arrayContaining([
        {
          action: 'PUBLISHED',
          counterpartActorId: reviewerId,
          fromState: 'APPROVED',
          reason: null,
          toState: 'PUBLISHED'
        },
        {
          action: 'RETIRED',
          counterpartActorId: null,
          fromState: 'PUBLISHED',
          reason: 'PUBLISHED_REPLACEMENT',
          toState: 'RETIRED'
        }
      ])
    )
    expect(replacementEvidence.reviews).toHaveLength(2)
    expect(
      await readLearnerSnapshot(
        initial.questionId,
        learnerSnapshot.studySessionId
      )
    ).toEqual(learnerSnapshot)
    const learnerContractsAfterReplacement = await readActualLearnerContracts(
      initial.questionId,
      learnerSnapshot.studySessionId
    )
    expect(learnerContractsAfterReplacement.publicQuestion).toMatchObject({
      id: initial.questionId,
      questionVersionId: replacement.versionId
    })
    expect(
      learnerContractsAfterReplacement.publicQuestions.items.find(
        ({ id }) => id === initial.questionId
      )
    ).toMatchObject({
      id: initial.questionId,
      questionVersionId: replacement.versionId
    })
    expect(learnerContractsAfterReplacement.bookmark).toMatchObject({
      id: learnerSnapshot.bookmarkId,
      createdAt: learnerContractsBeforeReplacement.bookmark.createdAt,
      availability: 'AVAILABLE',
      question: { questionVersionId: replacement.versionId }
    })
    expect(learnerContractsAfterReplacement.wrongNote).toMatchObject({
      lastWrongQuestionVersionId: initial.versionId,
      currentReviewQuestionVersionId: initial.versionId,
      question: { questionVersionId: initial.versionId },
      wrongNote: { reviewAvailability: 'AVAILABLE' }
    })
    expect(learnerContractsAfterReplacement.studySession).toEqual(
      learnerContractsBeforeReplacement.studySession
    )
    expect(learnerContractsAfterReplacement.studyResult).toEqual(
      learnerContractsBeforeReplacement.studyResult
    )
    const replacementPractice = await createBookmarkPractice()
    expect(replacementPractice.session.questions[0]?.question).toMatchObject({
      id: initial.questionId,
      questionVersionId: replacement.versionId
    })

    const openCandidateRequest = createAdminQuestionVersionRequestSchema.parse({
      ...createContent(`archive-candidate-${randomUUID()}`),
      expectedQuestionRowVersion: replacement.questionRowVersion + 1
    })
    const openCandidate = assertCreateAdminQuestionVersionResponse(
      { questionId: initial.questionId },
      openCandidateRequest,
      await commandService.createVersion(
        authority(authorId, authorToken),
        initial.questionId,
        openCandidateRequest
      )
    )
    const openCandidateId = openCandidate.questionVersionId
    if (!openCandidateId || openCandidate.versionRowVersion === null) {
      throw new Error('Open candidate identity is unavailable.')
    }
    const archiveBothRequest = archiveAdminQuestionRequestSchema.parse({
      expectedQuestionRowVersion: openCandidate.questionRowVersion,
      expectedOpenCandidateVersionId: openCandidateId,
      expectedOpenCandidateRowVersion: openCandidate.versionRowVersion
    })
    const archiveBothAuthorities = [
      authority(reviewerId, reviewerToken),
      authority(reviewerId, reviewerToken)
    ]
    const archiveBothOutcomes = await Promise.allSettled(
      archiveBothAuthorities.map((commandAuthority) =>
        commandService!.archiveQuestion(
          commandAuthority,
          initial.questionId,
          archiveBothRequest
        )
      )
    )
    expect(
      archiveBothOutcomes.filter(({ status }) => status === 'fulfilled')
    ).toHaveLength(1)
    const archiveBothWinnerIndex = archiveBothOutcomes.findIndex(
      ({ status }) => status === 'fulfilled'
    )
    const archiveBothLoserIndex = archiveBothOutcomes.findIndex(
      ({ status }) => status === 'rejected'
    )
    const archiveBothWinner = archiveBothOutcomes[archiveBothWinnerIndex]
    const archiveBothLoser = archiveBothOutcomes[archiveBothLoserIndex]
    if (
      archiveBothWinner?.status !== 'fulfilled' ||
      archiveBothLoser?.status !== 'rejected'
    ) {
      throw new Error('Concurrent archive outcome is malformed.')
    }
    assertArchiveAdminQuestionResponse(
      { questionId: initial.questionId },
      archiveBothRequest,
      archiveBothWinner.value
    )
    expect(archiveBothLoser.reason).toBeInstanceOf(ApplicationError)
    expect(archiveBothLoser.reason).toMatchObject({
      code: 'VERSION_CONFLICT',
      phase7Disposition: 'DEFINITE_ROLLBACK'
    })
    expect(
      await readCommandEvidence(
        archiveBothAuthorities[archiveBothLoserIndex]!.requestId
      )
    ).toEqual({ audit: [], intents: 0, reviews: [] })
    const archiveBothAuthority = archiveBothAuthorities[archiveBothWinnerIndex]!
    const archiveBothEvidence = await readCommandEvidence(
      archiveBothAuthority.requestId
    )
    expect(archiveBothEvidence.audit).toEqual([
      expect.objectContaining({
        command: 'QUESTION_ARCHIVE',
        changedFields: [
          'LIFECYCLE_STATUS',
          'VERSION_STATUS',
          'CURRENT_PUBLISHED_VERSION_ID'
        ],
        metadata: {
          kind: 'QUESTION_ARCHIVE_V1',
          retiredPublishedCount: 1,
          abandonedCandidateCount: 1
        },
        contentDigestValid: true
      })
    ])
    expect(archiveBothEvidence.intents).toBe(0)
    expect(archiveBothEvidence.reviews).toEqual(
      expect.arrayContaining([
        {
          action: 'RETIRED',
          counterpartActorId: null,
          fromState: 'PUBLISHED',
          reason: 'QUESTION_ARCHIVE',
          toState: 'RETIRED'
        },
        {
          action: 'ARCHIVE_ABANDONED',
          counterpartActorId: authorId,
          fromState: 'DRAFT',
          reason: 'QUESTION_ARCHIVE',
          toState: 'RETIRED'
        }
      ])
    )
    expect(archiveBothEvidence.reviews).toHaveLength(2)

    const archivedAggregate = await adminClient.query<{
      archivedAt: Date | null
      currentPublishedVersionId: string | null
      lifecycleStatus: string
      rowVersion: number
    }>(
      `SELECT "lifecycleStatus", "currentPublishedVersionId", "rowVersion",
         "archivedAt" FROM "Question" WHERE "id" = $1`,
      [initial.questionId]
    )
    expect(archivedAggregate.rows).toEqual([
      expect.objectContaining({
        lifecycleStatus: 'ARCHIVED',
        currentPublishedVersionId: null,
        rowVersion: openCandidate.questionRowVersion + 1,
        archivedAt: expect.any(Date)
      })
    ])
    const archivedVersions = await adminClient.query<{
      id: string
      publishedAt: Date | null
      retirementKind: string | null
      retiredAt: Date | null
      rowVersion: number
      status: string
    }>(
      `SELECT "id", "status", "rowVersion", "retirementKind",
         "publishedAt", "retiredAt" FROM "QuestionVersion"
       WHERE "id" = ANY($1::uuid[]) ORDER BY "id"`,
      [[replacement.versionId, openCandidateId]]
    )
    expect(archivedVersions.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: replacement.versionId,
          status: 'RETIRED',
          rowVersion: replacement.versionRowVersion + 2,
          retirementKind: 'PUBLISHED_RETIREMENT',
          publishedAt: expect.any(Date),
          retiredAt: expect.any(Date)
        }),
        expect.objectContaining({
          id: openCandidateId,
          status: 'RETIRED',
          rowVersion: openCandidate.versionRowVersion + 1,
          retirementKind: 'QUESTION_ARCHIVE_ABANDONED',
          publishedAt: null,
          retiredAt: expect.any(Date)
        })
      ])
    )
    expect(
      await readLearnerSnapshot(
        initial.questionId,
        learnerSnapshot.studySessionId
      )
    ).toEqual(learnerSnapshot)
    const learnerAndPublicCounts = await adminClient.query<{
      candidateLearnerReferences: number
      publicCount: number
    }>(
      `SELECT
         (SELECT COUNT(*)::int FROM "Question" AS question
          JOIN "QuestionVersion" AS version
            ON version."id" = question."currentPublishedVersionId"
          WHERE question."id" = $1
            AND question."lifecycleStatus" = 'ACTIVE'
            AND version."status" = 'PUBLISHED') AS "publicCount",
         ((SELECT COUNT(*) FROM "StudySessionQuestion"
           WHERE "questionVersionId" = $2)
          + (SELECT COUNT(*) FROM "WrongNote"
             WHERE "lastWrongQuestionVersionId" = $2
                OR "currentReviewQuestionVersionId" = $2))::int
           AS "candidateLearnerReferences"`,
      [initial.questionId, openCandidateId]
    )
    expect(learnerAndPublicCounts.rows).toEqual([
      { publicCount: 0, candidateLearnerReferences: 0 }
    ])
    const learnerContractsAfterArchive = await readActualLearnerContracts(
      initial.questionId,
      learnerSnapshot.studySessionId
    )
    expect(learnerContractsAfterArchive.publicQuestion).toBeNull()
    expect(
      learnerContractsAfterArchive.publicQuestions.items.some(
        ({ id }) => id === initial.questionId
      )
    ).toBe(false)
    expect(learnerContractsAfterArchive.bookmark).toMatchObject({
      id: learnerSnapshot.bookmarkId,
      createdAt: learnerContractsBeforeReplacement.bookmark.createdAt,
      availability: 'ARCHIVED',
      question: { questionVersionId: replacement.versionId }
    })
    expect(learnerContractsAfterArchive.bookmark.question).not.toMatchObject({
      questionVersionId: openCandidateId
    })
    expect(learnerContractsAfterArchive.wrongNote).toMatchObject({
      lastWrongQuestionVersionId: initial.versionId,
      currentReviewQuestionVersionId: initial.versionId,
      question: { questionVersionId: initial.versionId },
      wrongNote: { reviewAvailability: 'ARCHIVED' }
    })
    expect(learnerContractsAfterArchive.studySession).toEqual(
      learnerContractsBeforeReplacement.studySession
    )
    expect(learnerContractsAfterArchive.studyResult).toEqual(
      learnerContractsBeforeReplacement.studyResult
    )
    await expect(createBookmarkPractice()).rejects.toBeInstanceOf(
      NoEligibleQuestionsError
    )

    const retirementTarget = await prepareApprovedQuestion(
      `retirement-${randomUUID()}`
    )
    const retirementPublishRequest = publishQuestionVersionRequestSchema.parse({
      expectedRowVersion: retirementTarget.versionRowVersion,
      expectedQuestionRowVersion: retirementTarget.questionRowVersion
    })
    const retirementPublish = assertPublishQuestionVersionResponse(
      { versionId: retirementTarget.versionId },
      retirementPublishRequest,
      await commandService.publishVersion(
        authority(authorId, authorToken),
        retirementTarget.versionId,
        retirementPublishRequest
      )
    )
    const retirementLearnerSnapshot = await insertLearnerSnapshot(
      retirementTarget.questionId,
      retirementTarget.versionId
    )
    const retirementContractsBefore = await readActualLearnerContracts(
      retirementTarget.questionId,
      retirementLearnerSnapshot.studySessionId
    )
    expect(retirementContractsBefore.publicQuestion).toMatchObject({
      id: retirementTarget.questionId,
      questionVersionId: retirementTarget.versionId
    })
    expect(
      retirementContractsBefore.publicQuestions.items.find(
        ({ id }) => id === retirementTarget.questionId
      )
    ).toMatchObject({
      id: retirementTarget.questionId,
      questionVersionId: retirementTarget.versionId
    })
    expect(retirementContractsBefore.bookmark).toMatchObject({
      id: retirementLearnerSnapshot.bookmarkId,
      availability: 'AVAILABLE',
      question: { questionVersionId: retirementTarget.versionId }
    })
    expect(retirementContractsBefore.wrongNote).toMatchObject({
      lastWrongQuestionVersionId: retirementTarget.versionId,
      currentReviewQuestionVersionId: retirementTarget.versionId,
      question: { questionVersionId: retirementTarget.versionId },
      wrongNote: { reviewAvailability: 'AVAILABLE' }
    })
    const retirementPractice = await createBookmarkPractice()
    expect(retirementPractice.session.questions[0]?.question).toMatchObject({
      id: retirementTarget.questionId,
      questionVersionId: retirementTarget.versionId
    })
    const retirementRequest = retireQuestionVersionRequestSchema.parse({
      expectedRowVersion: retirementPublish.versionRowVersion,
      expectedQuestionRowVersion: retirementPublish.questionRowVersion
    })
    const retirementAuthorities = [
      authority(reviewerId, reviewerToken),
      authority(reviewerId, reviewerToken)
    ]
    const retirementOutcomes = await Promise.allSettled(
      retirementAuthorities.map((commandAuthority) =>
        commandService!.retireVersion(
          commandAuthority,
          retirementTarget.versionId,
          retirementRequest
        )
      )
    )
    expect(
      retirementOutcomes.filter(({ status }) => status === 'fulfilled')
    ).toHaveLength(1)
    const retirementWinnerIndex = retirementOutcomes.findIndex(
      ({ status }) => status === 'fulfilled'
    )
    const retirementLoserIndex = retirementOutcomes.findIndex(
      ({ status }) => status === 'rejected'
    )
    const retirementWinner = retirementOutcomes[retirementWinnerIndex]
    const retirementLoser = retirementOutcomes[retirementLoserIndex]
    if (
      retirementWinner?.status !== 'fulfilled' ||
      retirementLoser?.status !== 'rejected'
    ) {
      throw new Error('Concurrent retirement outcome is malformed.')
    }
    assertRetireQuestionVersionResponse(
      { versionId: retirementTarget.versionId },
      retirementRequest,
      retirementWinner.value
    )
    expect(retirementLoser.reason).toBeInstanceOf(ApplicationError)
    expect(retirementLoser.reason).toMatchObject({
      code: 'VERSION_CONFLICT',
      phase7Disposition: 'DEFINITE_ROLLBACK'
    })
    expect(
      await readCommandEvidence(
        retirementAuthorities[retirementLoserIndex]!.requestId
      )
    ).toEqual({ audit: [], intents: 0, reviews: [] })
    const retirementAuthority = retirementAuthorities[retirementWinnerIndex]!
    expect(
      await readCommandEvidence(retirementAuthority.requestId)
    ).toMatchObject({
      audit: [
        {
          command: 'RETIREMENT',
          changedFields: ['VERSION_STATUS', 'CURRENT_PUBLISHED_VERSION_ID'],
          metadata: { kind: 'NONE_V1' },
          contentDigestValid: true
        }
      ],
      intents: 0,
      reviews: [
        {
          action: 'RETIRED',
          counterpartActorId: null,
          fromState: 'PUBLISHED',
          reason: 'PUBLISHED_RETIREMENT',
          toState: 'RETIRED'
        }
      ]
    })
    expect(
      await readLearnerSnapshot(
        retirementTarget.questionId,
        retirementLearnerSnapshot.studySessionId
      )
    ).toEqual(retirementLearnerSnapshot)
    const retirementContractsAfter = await readActualLearnerContracts(
      retirementTarget.questionId,
      retirementLearnerSnapshot.studySessionId
    )
    expect(retirementContractsAfter.publicQuestion).toBeNull()
    expect(
      retirementContractsAfter.publicQuestions.items.some(
        ({ id }) => id === retirementTarget.questionId
      )
    ).toBe(false)
    expect(retirementContractsAfter.bookmark).toMatchObject({
      id: retirementLearnerSnapshot.bookmarkId,
      createdAt: retirementContractsBefore.bookmark.createdAt,
      availability: 'ARCHIVED',
      question: { questionVersionId: retirementTarget.versionId }
    })
    expect(retirementContractsAfter.wrongNote).toMatchObject({
      lastWrongQuestionVersionId: retirementTarget.versionId,
      currentReviewQuestionVersionId: retirementTarget.versionId,
      question: { questionVersionId: retirementTarget.versionId },
      wrongNote: { reviewAvailability: 'ARCHIVED' }
    })
    expect(retirementContractsAfter.studySession).toEqual(
      retirementContractsBefore.studySession
    )
    expect(retirementContractsAfter.studyResult).toEqual(
      retirementContractsBefore.studyResult
    )
    await expect(createBookmarkPractice()).rejects.toBeInstanceOf(
      NoEligibleQuestionsError
    )
    const archiveEmptyRequest = archiveAdminQuestionRequestSchema.parse({
      expectedQuestionRowVersion: retirementWinner.value.questionRowVersion,
      expectedOpenCandidateVersionId: null,
      expectedOpenCandidateRowVersion: null
    })
    const archiveEmptyAuthority = authority(authorId, authorToken)
    assertArchiveAdminQuestionResponse(
      { questionId: retirementTarget.questionId },
      archiveEmptyRequest,
      await commandService.archiveQuestion(
        archiveEmptyAuthority,
        retirementTarget.questionId,
        archiveEmptyRequest
      )
    )
    expect(
      await readCommandEvidence(archiveEmptyAuthority.requestId)
    ).toMatchObject({
      audit: [
        {
          command: 'QUESTION_ARCHIVE',
          changedFields: ['LIFECYCLE_STATUS'],
          metadata: {
            kind: 'QUESTION_ARCHIVE_V1',
            retiredPublishedCount: 0,
            abandonedCandidateCount: 0
          },
          contentDigestValid: true
        }
      ],
      intents: 0,
      reviews: []
    })

    const currentOnly = await prepareApprovedQuestion(
      `archive-current-${randomUUID()}`
    )
    const currentOnlyPublishRequest = publishQuestionVersionRequestSchema.parse(
      {
        expectedRowVersion: currentOnly.versionRowVersion,
        expectedQuestionRowVersion: currentOnly.questionRowVersion
      }
    )
    const currentOnlyPublished = assertPublishQuestionVersionResponse(
      { versionId: currentOnly.versionId },
      currentOnlyPublishRequest,
      await commandService.publishVersion(
        authority(authorId, authorToken),
        currentOnly.versionId,
        currentOnlyPublishRequest
      )
    )
    const archiveCurrentOnlyRequest = archiveAdminQuestionRequestSchema.parse({
      expectedQuestionRowVersion: currentOnlyPublished.questionRowVersion,
      expectedOpenCandidateVersionId: null,
      expectedOpenCandidateRowVersion: null
    })
    const archiveCurrentOnlyAuthority = authority(reviewerId, reviewerToken)
    assertArchiveAdminQuestionResponse(
      { questionId: currentOnly.questionId },
      archiveCurrentOnlyRequest,
      await commandService.archiveQuestion(
        archiveCurrentOnlyAuthority,
        currentOnly.questionId,
        archiveCurrentOnlyRequest
      )
    )
    expect(
      await readCommandEvidence(archiveCurrentOnlyAuthority.requestId)
    ).toMatchObject({
      audit: [
        {
          command: 'QUESTION_ARCHIVE',
          changedFields: [
            'LIFECYCLE_STATUS',
            'VERSION_STATUS',
            'CURRENT_PUBLISHED_VERSION_ID'
          ],
          metadata: {
            kind: 'QUESTION_ARCHIVE_V1',
            retiredPublishedCount: 1,
            abandonedCandidateCount: 0
          },
          contentDigestValid: true
        }
      ],
      intents: 0,
      reviews: [
        {
          action: 'RETIRED',
          counterpartActorId: null,
          fromState: 'PUBLISHED',
          reason: 'QUESTION_ARCHIVE',
          toState: 'RETIRED'
        }
      ]
    })

    const candidateContent = createContent(`archive-draft-${randomUUID()}`)
    const candidateOnlyCreated = assertCreateAdminQuestionResponse(
      candidateContent,
      await commandService.createQuestion(
        authority(authorId, authorToken),
        candidateContent
      )
    )
    const candidateOnlyId = candidateOnlyCreated.questionVersionId
    if (!candidateOnlyId) throw new Error('Candidate-only ID is unavailable.')
    const archiveCandidateOnlyRequest = archiveAdminQuestionRequestSchema.parse(
      {
        expectedQuestionRowVersion: candidateOnlyCreated.questionRowVersion,
        expectedOpenCandidateVersionId: candidateOnlyId,
        expectedOpenCandidateRowVersion: candidateOnlyCreated.versionRowVersion
      }
    )
    const archiveCandidateOnlyAuthority = authority(reviewerId, reviewerToken)
    assertArchiveAdminQuestionResponse(
      { questionId: candidateOnlyCreated.questionId },
      archiveCandidateOnlyRequest,
      await commandService.archiveQuestion(
        archiveCandidateOnlyAuthority,
        candidateOnlyCreated.questionId,
        archiveCandidateOnlyRequest
      )
    )
    expect(
      await readCommandEvidence(archiveCandidateOnlyAuthority.requestId)
    ).toMatchObject({
      audit: [
        {
          command: 'QUESTION_ARCHIVE',
          changedFields: ['LIFECYCLE_STATUS', 'VERSION_STATUS'],
          metadata: {
            kind: 'QUESTION_ARCHIVE_V1',
            retiredPublishedCount: 0,
            abandonedCandidateCount: 1
          },
          contentDigestValid: true
        }
      ],
      intents: 0,
      reviews: [
        {
          action: 'ARCHIVE_ABANDONED',
          counterpartActorId: authorId,
          fromState: 'DRAFT',
          reason: 'QUESTION_ARCHIVE',
          toState: 'RETIRED'
        }
      ]
    })
  }, 120_000)

  it('executes Slice 5 review batches atomically with one operation evidence set', async () => {
    if (!commandService || !slice5CommandService) {
      throw new Error('Slice 5 command services are unavailable.')
    }
    const first = await createDraftQuestion(`batch-first-${randomUUID()}`)
    const second = await createDraftQuestion(`batch-second-${randomUUID()}`)
    if (!first.questionVersionId || !second.questionVersionId) {
      throw new Error('Batch target IDs are unavailable.')
    }
    const request = requestContentReviewBatchRequestSchema.parse({
      items: [
        {
          versionId: first.questionVersionId,
          expectedRowVersion: first.versionRowVersion,
          comment: '첫 번째 일괄 검수 요청'
        },
        {
          versionId: second.questionVersionId,
          expectedRowVersion: second.versionRowVersion
        }
      ]
    })
    const batchAuthority = authority(authorId, authorToken)
    const result = assertRequestContentReviewBatchResponse(
      request,
      await slice5CommandService.requestReviewBatch(batchAuthority, request)
    )
    expect(
      result.items.map(({ questionVersionId }) => questionVersionId)
    ).toEqual(request.items.map(({ versionId }) => versionId))
    expect(new Set(result.items.map(({ occurredAt }) => occurredAt)).size).toBe(
      1
    )
    const evidence = await adminClient.query<{
      auditCount: number
      batchCount: number
      operationCount: number
      reviewCount: number
    }>(
      `SELECT
         COUNT(*)::int AS "auditCount",
         COUNT(*) FILTER (
           WHERE "command" = 'REVIEW_REQUEST_BATCH'
         )::int AS "batchCount",
         COUNT(DISTINCT "operationId")::int AS "operationCount",
         (SELECT COUNT(*)::int FROM "ContentReview"
          WHERE "requestId" = $1) AS "reviewCount"
       FROM "AdminAuditLog" WHERE "requestId" = $1`,
      [batchAuthority.requestId]
    )
    expect(evidence.rows[0]).toEqual({
      auditCount: 3,
      batchCount: 1,
      operationCount: 1,
      reviewCount: 2
    })

    const rollbackTarget = await createDraftQuestion(
      `batch-rollback-${randomUUID()}`
    )
    if (!rollbackTarget.questionVersionId) {
      throw new Error('Batch rollback target ID is unavailable.')
    }
    const rollbackAuthority = authority(authorId, authorToken)
    await expect(
      slice5CommandService.requestReviewBatch(
        rollbackAuthority,
        requestContentReviewBatchRequestSchema.parse({
          items: [
            {
              versionId: rollbackTarget.questionVersionId,
              expectedRowVersion: rollbackTarget.versionRowVersion
            },
            { versionId: randomUUID(), expectedRowVersion: 1 }
          ]
        })
      )
    ).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      phase7Disposition: 'DEFINITE_ROLLBACK'
    })
    const rollbackState = await adminClient.query<{
      auditCount: number
      reviewCount: number
      rowVersion: number
      status: string
    }>(
      `SELECT version."status", version."rowVersion",
         (SELECT COUNT(*)::int FROM "AdminAuditLog"
          WHERE "requestId" = $2) AS "auditCount",
         (SELECT COUNT(*)::int FROM "ContentReview"
          WHERE "requestId" = $2) AS "reviewCount"
       FROM "QuestionVersion" AS version WHERE version."id" = $1`,
      [rollbackTarget.questionVersionId, rollbackAuthority.requestId]
    )
    expect(rollbackState.rows[0]).toEqual({
      status: 'DRAFT',
      rowVersion: rollbackTarget.versionRowVersion,
      auditCount: 0,
      reviewCount: 0
    })

    const invalidStateTarget = await createDraftQuestion(
      `batch-invalid-state-${randomUUID()}`
    )
    const staleTarget = await createDraftQuestion(
      `batch-stale-rv-${randomUUID()}`
    )
    if (
      !invalidStateTarget.questionVersionId ||
      !staleTarget.questionVersionId ||
      staleTarget.versionRowVersion === null
    ) {
      throw new Error('Batch precedence target IDs are unavailable.')
    }
    const invalidStateRequest = requestContentReviewRequestSchema.parse({
      expectedRowVersion: invalidStateTarget.versionRowVersion
    })
    const invalidState = assertRequestContentReviewResponse(
      { versionId: invalidStateTarget.questionVersionId },
      invalidStateRequest,
      await commandService.requestReview(
        authority(authorId, authorToken),
        invalidStateTarget.questionVersionId,
        invalidStateRequest
      )
    )
    const stateFirstAuthority = authority(authorId, authorToken)
    await expect(
      slice5CommandService.requestReviewBatch(
        stateFirstAuthority,
        requestContentReviewBatchRequestSchema.parse({
          items: [
            {
              versionId: invalidStateTarget.questionVersionId,
              expectedRowVersion: invalidState.versionRowVersion
            },
            {
              versionId: staleTarget.questionVersionId,
              expectedRowVersion: staleTarget.versionRowVersion + 1
            }
          ]
        })
      )
    ).rejects.toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
      phase7Disposition: 'DEFINITE_ROLLBACK'
    })
    expect(await readCommandEvidence(stateFirstAuthority.requestId)).toEqual({
      audit: [],
      intents: 0,
      reviews: []
    })

    const staleFirstAuthority = authority(authorId, authorToken)
    await expect(
      slice5CommandService.requestReviewBatch(
        staleFirstAuthority,
        requestContentReviewBatchRequestSchema.parse({
          items: [
            {
              versionId: staleTarget.questionVersionId,
              expectedRowVersion: staleTarget.versionRowVersion + 1
            },
            {
              versionId: invalidStateTarget.questionVersionId,
              expectedRowVersion: invalidState.versionRowVersion
            }
          ]
        })
      )
    ).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      phase7Disposition: 'DEFINITE_ROLLBACK'
    })
    expect(await readCommandEvidence(staleFirstAuthority.requestId)).toEqual({
      audit: [],
      intents: 0,
      reviews: []
    })
  }, 120_000)

  it('validates and atomically applies imports, then exports exact canonical audited bytes', async () => {
    if (!slice5CommandService) {
      throw new Error('Slice 5 command service is unavailable.')
    }
    const validationRequest = validateQuestionImportRequestSchema.parse({
      items: [createImportItem(randomUUID()), createImportItem(randomUUID())]
    })
    const validation = await assertAdminImportValidationForRequest(
      sha256Port,
      validationRequest,
      await slice5CommandService.validateImport(validationRequest)
    )
    expect(validation).toMatchObject({
      valid: true,
      itemCount: 2,
      errors: []
    })

    const applyRequest = applyQuestionImportRequestSchema.parse({
      items: validationRequest.items,
      validationDigest: validation.validationDigest
    })
    const applyAuthority = authority(authorId, authorToken)
    const appliedRaw = await slice5CommandService.applyImport(
      applyAuthority,
      applyRequest
    )
    const applied = await assertAdminImportApplyForRequest(
      sha256Port,
      applyRequest,
      appliedRaw.response,
      appliedRaw.mappingDigest
    )
    expect(applied.response.createdCount).toBe(2)
    const applyEvidence = await adminClient.query<{
      command: string
      contentDigestValid: boolean
      operationId: string
    }>(
      `SELECT audit."command", audit."operationId",
         audit."contentDigest" = "phase7_admin_audit_content_digest"(
           audit."operationId", audit."command", audit."targetType",
           audit."targetId", audit."beforeState", audit."afterState",
           audit."beforeRowVersion", audit."afterRowVersion",
           audit."changedFields", audit."metadata"
         ) AS "contentDigestValid"
       FROM "AdminAuditLog" AS audit
       WHERE audit."requestId" = $1
       ORDER BY audit."command"::text, audit."targetId"`,
      [applyAuthority.requestId]
    )
    expect(applyEvidence.rows.map(({ command }) => command)).toEqual([
      'IMPORT_APPLY',
      'QUESTION_CREATE',
      'QUESTION_CREATE'
    ])
    expect(
      new Set(applyEvidence.rows.map(({ operationId }) => operationId)).size
    ).toBe(1)
    expect(
      applyEvidence.rows.every(({ contentDigestValid }) => contentDigestValid)
    ).toBe(true)

    const duplicateValidation =
      await slice5CommandService.validateImport(validationRequest)
    expect(duplicateValidation.valid).toBe(false)
    expect(duplicateValidation.errors.map(({ code }) => code)).toEqual([
      'DUPLICATE_QUESTION_CONTENT',
      'DUPLICATE_QUESTION_CONTENT'
    ])

    const questionIds = applied.response.items.map(
      ({ questionId }) => questionId
    )
    const exportRequest = exportAdminQuestionsRequestSchema.parse({
      questionIds
    })
    const exportAuthority = authority(reviewerId, reviewerToken)
    const exported = await slice5CommandService.exportQuestions(
      exportAuthority,
      exportRequest
    )
    const assertedExport = await assertAdminQuestionExportDocumentForRequest(
      sha256Port,
      exportRequest,
      exported.document,
      {
        canonicalResponseBody: exported.canonicalBody,
        auditEvidence: exported.auditEvidence
      }
    )
    expect(assertedExport.questionCount).toBe(2)
    expect(assertedExport.versionCount).toBe(2)
    expect(JSON.parse(exported.canonicalBody)).toEqual(exported.document)
    expect(
      Buffer.byteLength(exported.canonicalBody, 'utf8')
    ).toBeLessThanOrEqual(8 * 1024 * 1024)
    const exportEvidence = await adminClient.query<{
      command: string
      contentDigestValid: boolean
      metadata: {
        kind: string
        questionCount: number
        responseBodyDigest: string
        selectionDigest: string
        versionCount: number
      }
    }>(
      `SELECT audit."command", audit."metadata" AS metadata,
         audit."contentDigest" = "phase7_admin_audit_content_digest"(
           audit."operationId", audit."command", audit."targetType",
           audit."targetId", audit."beforeState", audit."afterState",
           audit."beforeRowVersion", audit."afterRowVersion",
           audit."changedFields", audit."metadata"
         ) AS "contentDigestValid"
       FROM "AdminAuditLog" AS audit WHERE audit."requestId" = $1`,
      [exportAuthority.requestId]
    )
    expect(exportEvidence.rows).toEqual([
      {
        command: 'EXPORT',
        contentDigestValid: true,
        metadata: {
          kind: 'EXPORT_V1',
          ...exported.auditEvidence
        }
      }
    ])

    if (!applicationRuntime) {
      throw new Error('Application runtime is unavailable.')
    }
    const concurrentRequest = validateQuestionImportRequestSchema.parse({
      items: [createImportItem(`concurrent-${randomUUID()}`)]
    })
    const concurrentValidation = await assertAdminImportValidationForRequest(
      sha256Port,
      concurrentRequest,
      await slice5CommandService.validateImport(concurrentRequest)
    )
    const concurrentApplyRequest = applyQuestionImportRequestSchema.parse({
      items: concurrentRequest.items,
      validationDigest: concurrentValidation.validationDigest
    })
    let barrierArrivals = 0
    let releaseBarrier: (() => void) | undefined
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve
    })
    const baseClient = applicationRuntime.client
    const createBarrierClient = (): PrismaClient => {
      return {
        $queryRawUnsafe: baseClient.$queryRawUnsafe.bind(baseClient),
        $transaction: async (
          callback: (transaction: Prisma.TransactionClient) => Promise<unknown>,
          options?: {
            readonly isolationLevel?: Prisma.TransactionIsolationLevel
            readonly maxWait?: number
            readonly timeout?: number
          }
        ) =>
          baseClient.$transaction(async (transaction) => {
            await transaction.$queryRawUnsafe('SELECT 1')
            barrierArrivals += 1
            if (barrierArrivals === 2) releaseBarrier?.()
            await barrier
            return callback(transaction)
          }, options)
      } as unknown as PrismaClient
    }
    const concurrentServices = [authorId, reviewerId].map(() =>
      createAdminQuestionSlice5CommandService(
        createPrismaAdminQuestionSlice5Repository({
          auditEnvironment: 'TEST',
          client: createBarrierClient()
        })
      )
    )
    const beforeConcurrent = await readGlobalWriteCounts()
    const concurrentOutcomes = await Promise.allSettled([
      concurrentServices[0]!.applyImport(
        authority(authorId, authorToken),
        concurrentApplyRequest
      ),
      concurrentServices[1]!.applyImport(
        authority(reviewerId, reviewerToken),
        concurrentApplyRequest
      )
    ])
    expect(
      concurrentOutcomes.filter(({ status }) => status === 'fulfilled')
    ).toHaveLength(1)
    const concurrentLoser = concurrentOutcomes.find(
      (outcome) => outcome.status === 'rejected'
    )
    if (!concurrentLoser || concurrentLoser.status !== 'rejected') {
      throw new Error('Concurrent import loser is unavailable.')
    }
    expect(concurrentLoser.reason).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      phase7InternalReason: 'CONTENT_DUPLICATE_CONCURRENT_RACE',
      retryable: false,
      phase7Disposition: 'DEFINITE_ROLLBACK'
    })
    const afterConcurrent = await readGlobalWriteCounts()
    expect(afterConcurrent).toEqual({
      question: beforeConcurrent.question + 1,
      version: beforeConcurrent.version + 1,
      review: beforeConcurrent.review,
      audit: beforeConcurrent.audit + 2
    })

    const faultValidationRequest = validateQuestionImportRequestSchema.parse({
      items: [
        createImportItem(`fault-first-${randomUUID()}`),
        createImportItem('SLICE5_FAULT_INJECTION_SECOND')
      ]
    })
    const faultValidation = await assertAdminImportValidationForRequest(
      sha256Port,
      faultValidationRequest,
      await slice5CommandService.validateImport(faultValidationRequest)
    )
    const faultApplyRequest = applyQuestionImportRequestSchema.parse({
      items: faultValidationRequest.items,
      validationDigest: faultValidation.validationDigest
    })
    const beforeFault = await readGlobalWriteCounts()
    await adminClient.query(
      `CREATE FUNCTION "phase7_test_fail_slice5_import"()
       RETURNS TRIGGER LANGUAGE plpgsql AS $function$
       BEGIN
         IF position('SLICE5_FAULT_INJECTION_SECOND' IN NEW."questionText") > 0
         THEN
           RAISE EXCEPTION 'Slice 5 import fault injection.';
         END IF;
         RETURN NEW;
       END;
       $function$`
    )
    await adminClient.query(
      `CREATE TRIGGER "QuestionVersion_slice5_import_fault"
       BEFORE INSERT ON "QuestionVersion"
       FOR EACH ROW EXECUTE FUNCTION "phase7_test_fail_slice5_import"()`
    )
    try {
      await expect(
        slice5CommandService.applyImport(
          authority(authorId, authorToken),
          faultApplyRequest
        )
      ).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        retryable: false,
        phase7Disposition: 'DEFINITE_ROLLBACK'
      })
      expect(await readGlobalWriteCounts()).toEqual(beforeFault)
    } finally {
      await adminClient.query(
        `DROP TRIGGER IF EXISTS "QuestionVersion_slice5_import_fault"
         ON "QuestionVersion"`
      )
      await adminClient.query(
        `DROP FUNCTION IF EXISTS "phase7_test_fail_slice5_import"()`
      )
    }
  }, 120_000)

  it('creates, reads, deduplicates, triages and resolves learner reports with audited concurrency', async () => {
    if (
      !applicationRuntime ||
      !commandService ||
      !slice5CommandService ||
      !questionReportService
    ) {
      throw new Error('Slice 5 report services are unavailable.')
    }
    const target = await prepareApprovedQuestion(`report-${randomUUID()}`)
    const publishRequest = publishQuestionVersionRequestSchema.parse({
      expectedRowVersion: target.versionRowVersion,
      expectedQuestionRowVersion: target.questionRowVersion
    })
    await commandService.publishVersion(
      authority(authorId, authorToken),
      target.versionId,
      publishRequest
    )
    const createRequest = createQuestionReportRequestSchema.parse({
      questionVersionId: target.versionId,
      reason: 'EXPLANATION_ERROR',
      description: '해설의 근거를 확인해 주세요.'
    })
    const createRepository = createPrismaQuestionReportRepository(
      applicationRuntime.client
    )
    let reportBarrierArrivals = 0
    let releaseReportBarrier: (() => void) | undefined
    const reportBarrier = new Promise<void>((resolve) => {
      releaseReportBarrier = resolve
    })
    const concurrentReportServices = [0, 1].map(() =>
      createQuestionReportService({
        rateLimiter: { consume: async () => undefined },
        repository: {
          ...createRepository,
          findEntitledDuplicateState: async (
            reporterId,
            questionVersionId,
            reason
          ) => {
            const state = await createRepository.findEntitledDuplicateState(
              reporterId,
              questionVersionId,
              reason
            )
            reportBarrierArrivals += 1
            if (reportBarrierArrivals === 2) releaseReportBarrier?.()
            await reportBarrier
            return state
          }
        }
      })
    )
    const reportCreateOutcomes = await Promise.allSettled(
      concurrentReportServices.map((service) =>
        service.createReport(
          { actorId: learnerId, rawSessionToken: learnerToken },
          createRequest
        )
      )
    )
    expect(
      reportCreateOutcomes.filter(({ status }) => status === 'fulfilled')
    ).toHaveLength(1)
    const reportCreateWinner = reportCreateOutcomes.find(
      (
        outcome
      ): outcome is PromiseFulfilledResult<
        Awaited<ReturnType<QuestionReportService['createReport']>>
      > => outcome.status === 'fulfilled'
    )
    const reportCreateLoser = reportCreateOutcomes.find(
      (outcome) => outcome.status === 'rejected'
    )
    if (
      !reportCreateWinner ||
      !reportCreateLoser ||
      reportCreateLoser.status !== 'rejected'
    ) {
      throw new Error('Concurrent report create outcome is unavailable.')
    }
    const created = assertCreateQuestionReportForRequest(
      createRequest,
      reportCreateWinner.value
    )
    expect(reportCreateLoser.reason).toMatchObject({
      code: 'QUESTION_REPORT_DUPLICATE',
      retryable: false,
      phase7Disposition: 'DEFINITE_ROLLBACK'
    })
    await expect(
      questionReportService.createReport(
        { actorId: learnerId, rawSessionToken: learnerToken },
        createRequest
      )
    ).rejects.toMatchObject({
      code: 'QUESTION_REPORT_DUPLICATE'
    })
    const duplicateCount = await adminClient.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM "QuestionReport"
       WHERE "reporterActorId" = $1 AND "questionVersionId" = $2
         AND "reason" = $3::"QuestionReportReason"
         AND "status" IN ('OPEN', 'TRIAGED')`,
      [learnerId, target.versionId, createRequest.reason]
    )
    expect(duplicateCount.rows[0]?.count).toBe(1)

    const listQuery = listAdminQuestionReportsQuerySchema.parse({
      questionId: target.questionId,
      page: 1,
      pageSize: 20
    })
    const listed = await questionReportService.listReports(listQuery)
    expect(listed.items).toContainEqual(
      expect.objectContaining({
        id: created.id,
        reporter: expect.objectContaining({ actorId: learnerId }),
        status: 'OPEN'
      })
    )
    const detail = await questionReportService.getReport(created.id)
    expect(detail).toMatchObject({
      id: created.id,
      description: createRequest.description,
      status: 'OPEN'
    })

    const triageRequest = triageAdminQuestionReportRequestSchema.parse({
      expectedRowVersion: created.rowVersion
    })
    const triageAuthority = authority(reviewerId, reviewerToken)
    const triaged = assertTriageAdminQuestionReportResponse(
      { reportId: created.id },
      triageRequest,
      await slice5CommandService.triageReport(
        triageAuthority,
        created.id,
        triageRequest
      )
    )
    const resolutionRequest = resolveAdminQuestionReportRequestSchema.parse({
      expectedRowVersion: triaged.rowVersion,
      outcome: 'DISMISSED',
      reason: '현재 설명이 학습 목표와 일치합니다.'
    })
    let releaseStalledResolution: (() => void) | undefined
    const stalledResolutionGate = new Promise<void>((resolve) => {
      releaseStalledResolution = resolve
    })
    let markStalledTransactionReached: (() => void) | undefined
    const stalledTransactionReached = new Promise<void>((resolve) => {
      markStalledTransactionReached = resolve
    })
    const baseResolutionClient = applicationRuntime.client
    const stalledResolutionClient = {
      $queryRawUnsafe:
        baseResolutionClient.$queryRawUnsafe.bind(baseResolutionClient),
      $transaction: async (
        callback: (transaction: Prisma.TransactionClient) => Promise<unknown>,
        options?: {
          readonly isolationLevel?: Prisma.TransactionIsolationLevel
          readonly maxWait?: number
          readonly timeout?: number
        }
      ) => {
        markStalledTransactionReached?.()
        await stalledResolutionGate
        return baseResolutionClient.$transaction(callback, options)
      }
    } as unknown as PrismaClient
    const stalledResolutionService = createAdminQuestionSlice5CommandService(
      createPrismaAdminQuestionSlice5Repository({
        auditEnvironment: 'TEST',
        client: stalledResolutionClient
      })
    )
    const loserAuthority = authority(reviewerId, reviewerToken)
    const loserOutcomePromise = stalledResolutionService
      .resolveReport(loserAuthority, created.id, resolutionRequest)
      .then(
        (value) => ({ status: 'fulfilled' as const, value }),
        (reason: unknown) => ({ status: 'rejected' as const, reason })
      )
    await stalledTransactionReached
    const winnerAuthority = authority(reviewerId, reviewerToken)
    let winnerResult:
      | Awaited<ReturnType<AdminQuestionSlice5CommandService['resolveReport']>>
      | undefined
    try {
      winnerResult = await slice5CommandService.resolveReport(
        winnerAuthority,
        created.id,
        resolutionRequest
      )
    } finally {
      releaseStalledResolution?.()
    }
    const loser = await loserOutcomePromise
    if (loser.status !== 'rejected') {
      throw new Error(
        `Expected stalled report resolution to fail: ${describeFailure(loser.value)}`
      )
    }
    if (!winnerResult) {
      throw new Error('Report resolution winner is unavailable.')
    }
    assertResolveAdminQuestionReportResponse(
      { reportId: created.id },
      resolutionRequest,
      winnerResult
    )
    expect(loser.reason).toMatchObject({
      code: 'VERSION_CONFLICT',
      phase7Disposition: 'DEFINITE_ROLLBACK'
    })
    expect(await readCommandEvidence(loserAuthority.requestId)).toEqual({
      audit: [],
      intents: 0,
      reviews: []
    })
    const reportEvidence = await adminClient.query<{
      command: string
      contentDigestValid: boolean
    }>(
      `SELECT audit."command",
         audit."contentDigest" = "phase7_admin_audit_content_digest"(
           audit."operationId", audit."command", audit."targetType",
           audit."targetId", audit."beforeState", audit."afterState",
           audit."beforeRowVersion", audit."afterRowVersion",
           audit."changedFields", audit."metadata"
         ) AS "contentDigestValid"
       FROM "AdminAuditLog" AS audit
       WHERE audit."targetId" = $1
         AND audit."command" IN ('REPORT_TRIAGE', 'REPORT_RESOLUTION')
       ORDER BY audit."command"::text`,
      [created.id]
    )
    expect(reportEvidence.rows).toEqual([
      { command: 'REPORT_RESOLUTION', contentDigestValid: true },
      { command: 'REPORT_TRIAGE', contentDigestValid: true }
    ])
  }, 120_000)

  it('rejects missing, self, cross-question and mutable remediation with report writes at zero', async () => {
    if (!commandService || !slice5CommandService || !questionReportService) {
      throw new Error('Slice 5 report services are unavailable.')
    }
    const target = await prepareApprovedQuestion(
      `report-remediation-${randomUUID()}`
    )
    const publishRequest = publishQuestionVersionRequestSchema.parse({
      expectedRowVersion: target.versionRowVersion,
      expectedQuestionRowVersion: target.questionRowVersion
    })
    const published = assertPublishQuestionVersionResponse(
      { versionId: target.versionId },
      publishRequest,
      await commandService.publishVersion(
        authority(authorId, authorToken),
        target.versionId,
        publishRequest
      )
    )
    const createRequest = createQuestionReportRequestSchema.parse({
      questionVersionId: target.versionId,
      reason: 'TYPO_OR_GRAMMAR',
      description: '조치 버전 검증을 위한 신고입니다.'
    })
    const created = assertCreateQuestionReportForRequest(
      createRequest,
      await questionReportService.createReport(
        { actorId: learnerId, rawSessionToken: learnerToken },
        createRequest
      )
    )
    const triageRequest = triageAdminQuestionReportRequestSchema.parse({
      expectedRowVersion: created.rowVersion
    })
    const triaged = assertTriageAdminQuestionReportResponse(
      { reportId: created.id },
      triageRequest,
      await slice5CommandService.triageReport(
        authority(reviewerId, reviewerToken),
        created.id,
        triageRequest
      )
    )
    const mutableRequest = createAdminQuestionVersionRequestSchema.parse({
      ...createContent(`report-remediation-draft-${randomUUID()}`),
      expectedQuestionRowVersion: published.questionRowVersion
    })
    const mutableVersion = assertCreateAdminQuestionVersionResponse(
      { questionId: target.questionId },
      mutableRequest,
      await commandService.createVersion(
        authority(authorId, authorToken),
        target.questionId,
        mutableRequest
      )
    )
    if (
      !mutableVersion.questionVersionId ||
      mutableVersion.versionRowVersion === null
    ) {
      throw new Error('Mutable remediation version is unavailable.')
    }
    const crossTarget = await prepareApprovedQuestion(
      `report-remediation-cross-${randomUUID()}`
    )
    const crossPublishRequest = publishQuestionVersionRequestSchema.parse({
      expectedRowVersion: crossTarget.versionRowVersion,
      expectedQuestionRowVersion: crossTarget.questionRowVersion
    })
    await commandService.publishVersion(
      authority(authorId, authorToken),
      crossTarget.versionId,
      crossPublishRequest
    )

    for (const remediationVersionId of [
      randomUUID(),
      target.versionId,
      crossTarget.versionId,
      mutableVersion.questionVersionId
    ]) {
      const resolveAuthority = authority(reviewerId, reviewerToken)
      const resolveRequest = resolveAdminQuestionReportRequestSchema.parse({
        expectedRowVersion: triaged.rowVersion,
        outcome: 'RESOLVED',
        reason: '조치 버전 연결을 검증합니다.',
        remediationVersionId
      })
      await expect(
        slice5CommandService.resolveReport(
          resolveAuthority,
          created.id,
          resolveRequest
        )
      ).rejects.toMatchObject({
        code: 'RESOURCE_NOT_FOUND',
        phase7Disposition: 'DEFINITE_ROLLBACK'
      })
      expect(await readCommandEvidence(resolveAuthority.requestId)).toEqual({
        audit: [],
        intents: 0,
        reviews: []
      })
    }
    const remediationReviewRequest = requestContentReviewRequestSchema.parse({
      expectedRowVersion: mutableVersion.versionRowVersion
    })
    const remediationInReview = assertRequestContentReviewResponse(
      { versionId: mutableVersion.questionVersionId },
      remediationReviewRequest,
      await commandService.requestReview(
        authority(authorId, authorToken),
        mutableVersion.questionVersionId,
        remediationReviewRequest
      )
    )
    const remediationApprovalRequest =
      approveQuestionVersionRequestSchema.parse({
        expectedRowVersion: remediationInReview.versionRowVersion
      })
    const remediationApproved = assertApproveQuestionVersionResponse(
      { versionId: mutableVersion.questionVersionId },
      remediationApprovalRequest,
      await commandService.approveVersion(
        authority(reviewerId, reviewerToken),
        mutableVersion.questionVersionId,
        remediationApprovalRequest
      )
    )
    if (remediationApproved.versionRowVersion === null) {
      throw new Error('Approved remediation rowVersion is unavailable.')
    }
    const remediationPublishRequest = publishQuestionVersionRequestSchema.parse(
      {
        expectedRowVersion: remediationApproved.versionRowVersion,
        expectedQuestionRowVersion: remediationApproved.questionRowVersion
      }
    )
    assertPublishQuestionVersionResponse(
      { versionId: mutableVersion.questionVersionId },
      remediationPublishRequest,
      await commandService.publishVersion(
        authority(authorId, authorToken),
        mutableVersion.questionVersionId,
        remediationPublishRequest
      )
    )
    const validResolutionRequest =
      resolveAdminQuestionReportRequestSchema.parse({
        expectedRowVersion: triaged.rowVersion,
        outcome: 'RESOLVED',
        reason: '후속 공개 버전에서 문제를 수정했습니다.',
        remediationVersionId: mutableVersion.questionVersionId
      })
    const resolved = assertResolveAdminQuestionReportResponse(
      { reportId: created.id },
      validResolutionRequest,
      await slice5CommandService.resolveReport(
        authority(reviewerId, reviewerToken),
        created.id,
        validResolutionRequest
      )
    )
    expect(resolved).toMatchObject({
      status: 'RESOLVED',
      resolution: {
        outcome: 'RESOLVED',
        reason: validResolutionRequest.reason,
        remediationVersionId: mutableVersion.questionVersionId
      }
    })

    const olderCreateRequest = createQuestionReportRequestSchema.parse({
      questionVersionId: mutableVersion.questionVersionId,
      reason: 'LEVEL_OR_TAXONOMY',
      description: '더 오래된 공개 계보 연결을 거부해야 합니다.'
    })
    const olderCreated = assertCreateQuestionReportForRequest(
      olderCreateRequest,
      await questionReportService.createReport(
        { actorId: learnerId, rawSessionToken: learnerToken },
        olderCreateRequest
      )
    )
    const olderTriageRequest = triageAdminQuestionReportRequestSchema.parse({
      expectedRowVersion: olderCreated.rowVersion
    })
    const olderTriaged = assertTriageAdminQuestionReportResponse(
      { reportId: olderCreated.id },
      olderTriageRequest,
      await slice5CommandService.triageReport(
        authority(reviewerId, reviewerToken),
        olderCreated.id,
        olderTriageRequest
      )
    )
    const olderResolutionAuthority = authority(reviewerId, reviewerToken)
    const olderResolutionRequest =
      resolveAdminQuestionReportRequestSchema.parse({
        expectedRowVersion: olderTriaged.rowVersion,
        outcome: 'RESOLVED',
        reason: '오래된 공개 계보는 조치 버전이 될 수 없습니다.',
        remediationVersionId: target.versionId
      })
    await expect(
      slice5CommandService.resolveReport(
        olderResolutionAuthority,
        olderCreated.id,
        olderResolutionRequest
      )
    ).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      phase7Disposition: 'DEFINITE_ROLLBACK'
    })
    expect(
      await readCommandEvidence(olderResolutionAuthority.requestId)
    ).toEqual({ audit: [], intents: 0, reviews: [] })
    await expect(
      questionReportService.getReport(olderCreated.id)
    ).resolves.toMatchObject({
      status: 'TRIAGED',
      rowVersion: olderTriaged.rowVersion,
      resolution: null
    })
  }, 120_000)

  it('keeps report list count and items in one repeatable-read snapshot', async () => {
    if (!applicationRuntime || !commandService || !questionReportService) {
      throw new Error('Slice 5 report snapshot services are unavailable.')
    }
    const snapshotQuestionReportService = questionReportService
    const target = await prepareApprovedQuestion(
      `report-list-snapshot-${randomUUID()}`
    )
    const publishRequest = publishQuestionVersionRequestSchema.parse({
      expectedRowVersion: target.versionRowVersion,
      expectedQuestionRowVersion: target.questionRowVersion
    })
    await commandService.publishVersion(
      authority(authorId, authorToken),
      target.versionId,
      publishRequest
    )
    const initialRequest = createQuestionReportRequestSchema.parse({
      questionVersionId: target.versionId,
      reason: 'OTHER',
      description: '목록 snapshot의 첫 신고입니다.'
    })
    const initial = assertCreateQuestionReportForRequest(
      initialRequest,
      await questionReportService.createReport(
        { actorId: learnerId, rawSessionToken: learnerToken },
        initialRequest
      )
    )
    const concurrentRequest = createQuestionReportRequestSchema.parse({
      questionVersionId: target.versionId,
      reason: 'ANSWER_ERROR',
      description: 'count 이후 commit되는 두 번째 신고입니다.'
    })
    let concurrentInserted = false
    const snapshotBaseClient = applicationRuntime.client
    const snapshotClient = {
      $queryRawUnsafe:
        snapshotBaseClient.$queryRawUnsafe.bind(snapshotBaseClient),
      $transaction: async (
        callback: (transaction: Prisma.TransactionClient) => Promise<unknown>,
        options?: {
          readonly isolationLevel?: Prisma.TransactionIsolationLevel
          readonly maxWait?: number
          readonly timeout?: number
        }
      ) =>
        snapshotBaseClient.$transaction(async (transaction) => {
          const wrappedTransaction = {
            $executeRaw: transaction.$executeRaw.bind(transaction),
            $queryRawUnsafe: async <Result = unknown>(
              statement: string,
              ...parameters: unknown[]
            ): Promise<Result> => {
              const result = await transaction.$queryRawUnsafe<Result>(
                statement,
                ...parameters
              )
              if (
                !concurrentInserted &&
                statement.includes('SELECT COUNT(*)::bigint AS "total"')
              ) {
                concurrentInserted = true
                await snapshotQuestionReportService.createReport(
                  { actorId: learnerId, rawSessionToken: learnerToken },
                  concurrentRequest
                )
              }
              return result
            }
          } as unknown as Prisma.TransactionClient
          return callback(wrappedTransaction)
        }, options)
    } as unknown as PrismaClient
    const snapshotRepository =
      createPrismaQuestionReportRepository(snapshotClient)
    const query = listAdminQuestionReportsQuerySchema.parse({
      questionId: target.questionId,
      page: 1,
      pageSize: 20
    })
    const snapshot = await snapshotRepository.list(query)
    expect(snapshot).toMatchObject({ total: 1 })
    expect(snapshot.items.map(({ id }) => id)).toEqual([initial.id])
    const afterCommit =
      await createPrismaQuestionReportRepository(snapshotBaseClient).list(query)
    expect(afterCommit.total).toBe(2)
    expect(afterCommit.items).toHaveLength(2)
  }, 120_000)

  it('rechecks learner report entitlement and reporter authority after service preflight', async () => {
    if (
      !applicationRuntime ||
      !authGatewayRuntime ||
      !erasureWorkerConnected ||
      !commandService
    ) {
      throw new Error('Slice 5 drift test services are unavailable.')
    }
    const driftCommandService = commandService
    const driftAuthGatewayRuntime = authGatewayRuntime
    const driftErasureWorkerClient = erasureWorkerClient
    const reportAuditCountBefore = await adminClient.query<{ count: number }>(
      `SELECT COUNT(*)::int AS "count"
       FROM "AdminAuditLog"
       WHERE "targetType" = 'QUESTION_REPORT'`
    )
    const entitlementTarget = await prepareApprovedQuestion(
      `report-entitlement-drift-${randomUUID()}`
    )
    const entitlementPublishRequest = publishQuestionVersionRequestSchema.parse(
      {
        expectedRowVersion: entitlementTarget.versionRowVersion,
        expectedQuestionRowVersion: entitlementTarget.questionRowVersion
      }
    )
    const entitlementPublished = assertPublishQuestionVersionResponse(
      { versionId: entitlementTarget.versionId },
      entitlementPublishRequest,
      await commandService.publishVersion(
        authority(authorId, authorToken),
        entitlementTarget.versionId,
        entitlementPublishRequest
      )
    )
    const entitlementCreateRequest = createQuestionReportRequestSchema.parse({
      questionVersionId: entitlementTarget.versionId,
      reason: 'ANSWER_ERROR',
      description: '공개 포인터 변경 경계를 검증합니다.'
    })
    const entitlementRepository = createPrismaQuestionReportRepository(
      applicationRuntime.client
    )
    let retired = false
    const entitlementDriftService = createQuestionReportService({
      rateLimiter: { consume: async () => undefined },
      repository: {
        ...entitlementRepository,
        findEntitledDuplicateState: async (
          reporterId,
          questionVersionId,
          reason
        ) => {
          const state = await entitlementRepository.findEntitledDuplicateState(
            reporterId,
            questionVersionId,
            reason
          )
          if (!retired) {
            retired = true
            const retireRequest = retireQuestionVersionRequestSchema.parse({
              expectedRowVersion: entitlementPublished.versionRowVersion,
              expectedQuestionRowVersion:
                entitlementPublished.questionRowVersion
            })
            await driftCommandService.retireVersion(
              authority(reviewerId, reviewerToken),
              entitlementTarget.versionId,
              retireRequest
            )
          }
          return state
        }
      }
    })
    await expect(
      entitlementDriftService.createReport(
        { actorId: learnerId, rawSessionToken: learnerToken },
        entitlementCreateRequest
      )
    ).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      retryable: false,
      phase7Disposition: 'DEFINITE_ROLLBACK'
    })

    const authorityTarget = await prepareApprovedQuestion(
      `report-authority-drift-${randomUUID()}`
    )
    const authorityPublishRequest = publishQuestionVersionRequestSchema.parse({
      expectedRowVersion: authorityTarget.versionRowVersion,
      expectedQuestionRowVersion: authorityTarget.questionRowVersion
    })
    await commandService.publishVersion(
      authority(authorId, authorToken),
      authorityTarget.versionId,
      authorityPublishRequest
    )
    const driftToken = `phase7-report-drift-${randomUUID()}`
    await issueSession(learnerId, driftToken, 'USER')
    const authorityCreateRequest = createQuestionReportRequestSchema.parse({
      questionVersionId: authorityTarget.versionId,
      reason: 'AMBIGUOUS',
      description: '세션 폐기 경계를 검증합니다.'
    })
    const authorityRepository = createPrismaQuestionReportRepository(
      applicationRuntime.client
    )
    let signedOut = false
    const authorityDriftService = createQuestionReportService({
      rateLimiter: { consume: async () => undefined },
      repository: {
        ...authorityRepository,
        findEntitledDuplicateState: async (
          reporterId,
          questionVersionId,
          reason
        ) => {
          const state = await authorityRepository.findEntitledDuplicateState(
            reporterId,
            questionVersionId,
            reason
          )
          if (!signedOut) {
            signedOut = true
            await driftAuthGatewayRuntime.client.$queryRawUnsafe(
              'SELECT "phase7_owned_sign_out"($1)',
              driftToken
            )
          }
          return state
        }
      }
    })
    await expect(
      authorityDriftService.createReport(
        { actorId: learnerId, rawSessionToken: driftToken },
        authorityCreateRequest
      )
    ).rejects.toMatchObject({
      code: 'AUTH_SESSION_EXPIRED',
      retryable: false,
      phase7Disposition: 'DEFINITE_ROLLBACK'
    })

    await insertCredentialUser(revocationLearnerId, 'USER')
    const revocationToken = `phase7-report-revocation-${randomUUID()}`
    const revocationTriggerToken = `phase7-report-revocation-trigger-${randomUUID()}`
    await issueSession(revocationLearnerId, revocationToken, 'USER')
    await issueSession(revocationLearnerId, revocationTriggerToken, 'USER')
    const revocationCreateRequest = createQuestionReportRequestSchema.parse({
      questionVersionId: authorityTarget.versionId,
      reason: 'ANSWER_ERROR',
      description: '전체 세션 폐기 경계를 검증합니다.'
    })
    const revocationRepository = createPrismaQuestionReportRepository(
      applicationRuntime.client
    )
    let revoked = false
    const revocationDriftService = createQuestionReportService({
      rateLimiter: { consume: async () => undefined },
      repository: {
        ...revocationRepository,
        findEntitledDuplicateState: async (
          reporterId,
          questionVersionId,
          reason
        ) => {
          const state = await revocationRepository.findEntitledDuplicateState(
            reporterId,
            questionVersionId,
            reason
          )
          if (!revoked) {
            revoked = true
            const rows = await driftAuthGatewayRuntime.client.$queryRawUnsafe<
              Array<{ changed: boolean }>
            >(
              `SELECT "phase7_change_password_v1"($1, $2, $3) AS changed`,
              revocationTriggerToken,
              'integration-password-hash',
              `integration-password-hash-${randomUUID()}`
            )
            expect(rows).toEqual([{ changed: true }])
          }
          return state
        }
      }
    })
    await expect(
      revocationDriftService.createReport(
        { actorId: revocationLearnerId, rawSessionToken: revocationToken },
        revocationCreateRequest
      )
    ).rejects.toMatchObject({
      code: 'AUTH_SESSION_EXPIRED',
      retryable: false,
      phase7Disposition: 'DEFINITE_ROLLBACK'
    })

    await insertCredentialUser(erasureLearnerId, 'USER')
    const erasureToken = `phase7-report-erasure-${randomUUID()}`
    await issueSession(erasureLearnerId, erasureToken, 'USER')
    const erasureCreateRequest = createQuestionReportRequestSchema.parse({
      questionVersionId: authorityTarget.versionId,
      reason: 'EXPLANATION_ERROR',
      description: '계정 삭제 경계를 검증합니다.'
    })
    const erasureRepository = createPrismaQuestionReportRepository(
      applicationRuntime.client
    )
    let erased = false
    const erasureDriftService = createQuestionReportService({
      rateLimiter: { consume: async () => undefined },
      repository: {
        ...erasureRepository,
        findEntitledDuplicateState: async (
          reporterId,
          questionVersionId,
          reason
        ) => {
          const state = await erasureRepository.findEntitledDuplicateState(
            reporterId,
            questionVersionId,
            reason
          )
          if (!erased) {
            erased = true
            await driftErasureWorkerClient.query(
              `SELECT "phase7_erase_user"($1, 'TEST')`,
              [erasureLearnerId]
            )
          }
          return state
        }
      }
    })
    await expect(
      erasureDriftService.createReport(
        { actorId: erasureLearnerId, rawSessionToken: erasureToken },
        erasureCreateRequest
      )
    ).rejects.toMatchObject({
      code: 'AUTH_SESSION_EXPIRED',
      retryable: false,
      phase7Disposition: 'DEFINITE_ROLLBACK'
    })

    const wrongNoteTarget = await prepareApprovedQuestion(
      `report-wrong-note-drift-${randomUUID()}`
    )
    const wrongNotePublishRequest = publishQuestionVersionRequestSchema.parse({
      expectedRowVersion: wrongNoteTarget.versionRowVersion,
      expectedQuestionRowVersion: wrongNoteTarget.questionRowVersion
    })
    const wrongNotePublished = assertPublishQuestionVersionResponse(
      { versionId: wrongNoteTarget.versionId },
      wrongNotePublishRequest,
      await driftCommandService.publishVersion(
        authority(authorId, authorToken),
        wrongNoteTarget.versionId,
        wrongNotePublishRequest
      )
    )
    const wrongNoteSuccessor = await prepareApprovedVersion(
      wrongNoteTarget.questionId,
      wrongNotePublished.questionRowVersion,
      `report-wrong-note-successor-${randomUUID()}`
    )
    const wrongNoteSuccessorPublishRequest =
      publishQuestionVersionRequestSchema.parse({
        expectedRowVersion: wrongNoteSuccessor.versionRowVersion,
        expectedQuestionRowVersion: wrongNoteSuccessor.questionRowVersion
      })
    await driftCommandService.publishVersion(
      authority(authorId, authorToken),
      wrongNoteSuccessor.versionId,
      wrongNoteSuccessorPublishRequest
    )
    const wrongNoteId = randomUUID()
    const wrongNoteAt = new Date()
    await adminClient.query('BEGIN')
    try {
      await adminClient.query('SET LOCAL session_replication_role = replica')
      await adminClient.query(
        `INSERT INTO "WrongNote" (
           "id", "userId", "questionId", "lastWrongQuestionVersionId",
           "currentReviewQuestionVersionId", "wrongCount", "correctStreak",
           "status", "lastWrongAt", "createdAt", "updatedAt"
         ) VALUES ($1, $2, $3, $4, $4, 1, 0, 'NEW', $5, $5, $5)`,
        [
          wrongNoteId,
          learnerId,
          wrongNoteTarget.questionId,
          wrongNoteTarget.versionId,
          wrongNoteAt
        ]
      )
      await adminClient.query('COMMIT')
    } catch (error: unknown) {
      await adminClient.query('ROLLBACK')
      throw error
    }
    const wrongNoteCreateRequest = createQuestionReportRequestSchema.parse({
      questionVersionId: wrongNoteTarget.versionId,
      reason: 'OTHER',
      description: '오답노트 단독 entitlement 변경을 검증합니다.'
    })
    const wrongNoteRepository = createPrismaQuestionReportRepository(
      applicationRuntime.client
    )
    let wrongNoteRemoved = false
    const wrongNoteDriftService = createQuestionReportService({
      rateLimiter: { consume: async () => undefined },
      repository: {
        ...wrongNoteRepository,
        findEntitledDuplicateState: async (
          reporterId,
          questionVersionId,
          reason
        ) => {
          const state = await wrongNoteRepository.findEntitledDuplicateState(
            reporterId,
            questionVersionId,
            reason
          )
          if (!wrongNoteRemoved) {
            wrongNoteRemoved = true
            await adminClient.query('BEGIN')
            try {
              await adminClient.query(
                'SET LOCAL session_replication_role = replica'
              )
              await adminClient.query(
                `DELETE FROM "WrongNote" WHERE "id" = $1`,
                [wrongNoteId]
              )
              await adminClient.query('COMMIT')
            } catch (error: unknown) {
              await adminClient.query('ROLLBACK')
              throw error
            }
          }
          return state
        }
      }
    })
    await expect(
      wrongNoteDriftService.createReport(
        { actorId: learnerId, rawSessionToken: learnerToken },
        wrongNoteCreateRequest
      )
    ).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      retryable: false,
      phase7Disposition: 'DEFINITE_ROLLBACK'
    })
    const reportCounts = await adminClient.query<{
      authorityCount: number
      entitlementCount: number
      wrongNoteCount: number
    }>(
      `SELECT
         COUNT(*) FILTER (
           WHERE "questionVersionId" = $1
         )::int AS "entitlementCount",
         COUNT(*) FILTER (
           WHERE "questionVersionId" = $2
         )::int AS "authorityCount",
         COUNT(*) FILTER (
           WHERE "questionVersionId" = $3
         )::int AS "wrongNoteCount"
       FROM "QuestionReport"`,
      [
        entitlementTarget.versionId,
        authorityTarget.versionId,
        wrongNoteTarget.versionId
      ]
    )
    expect(reportCounts.rows[0]).toEqual({
      entitlementCount: 0,
      authorityCount: 0,
      wrongNoteCount: 0
    })
    const reportAuditCountAfter = await adminClient.query<{ count: number }>(
      `SELECT COUNT(*)::int AS "count"
       FROM "AdminAuditLog"
       WHERE "targetType" = 'QUESTION_REPORT'`
    )
    expect(reportAuditCountAfter.rows[0]).toEqual(
      reportAuditCountBefore.rows[0]
    )
  }, 120_000)

  it('classifies unknown and revoked tokens through the app-role resolver with write 0', async () => {
    if (!commandService) throw new Error('Command service is unavailable.')
    const before = await readGlobalWriteCounts()
    const unknownToken = `phase7-command-unknown-${randomUUID()}`

    await expect(
      commandService.createQuestion(
        authority(authorId, unknownToken),
        createContent(`unknown-token-${randomUUID()}`)
      )
    ).rejects.toMatchObject({
      code: 'AUTH_SESSION_EXPIRED',
      phase7Disposition: 'DEFINITE_ROLLBACK'
    })

    const revokedToken = `phase7-command-revoked-${randomUUID()}`
    await issueSession(authorId, revokedToken)
    if (!authGatewayRuntime) {
      throw new Error('Phase 7 auth gateway runtime is unavailable.')
    }
    await authGatewayRuntime.client.$queryRawUnsafe(
      'SELECT "phase7_owned_sign_out"($1)',
      revokedToken
    )
    await expect(
      commandService.createQuestion(
        authority(authorId, revokedToken),
        createContent(`revoked-token-${randomUUID()}`)
      )
    ).rejects.toMatchObject({
      code: 'AUTH_SESSION_EXPIRED',
      phase7Disposition: 'DEFINITE_ROLLBACK'
    })

    expect(await readGlobalWriteCounts()).toEqual(before)
  })
})
