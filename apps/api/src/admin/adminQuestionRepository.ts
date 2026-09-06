import { compareUnicodeScalars } from '@nihongo/contracts/admin/phase7'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'

export type AdminAccountActorRecord = {
  kind: 'ACCOUNT'
  actorId: string
  role: 'USER' | 'ADMIN'
  label: 'ACTIVE_USER' | 'DELETED_USER' | 'ACTIVE_ADMIN' | 'DELETED_ADMIN'
}

export type AdminSystemActorRecord = {
  kind: 'SYSTEM'
  actorId: null
  role: 'SYSTEM'
  label: 'ACCOUNT_ERASURE'
}

export type AdminSafeActorRecord =
  | AdminAccountActorRecord
  | AdminSystemActorRecord

export interface AdminTagRecord {
  id: string
  label: string
  normalizedName: string
}

export interface AdminOptionRecord {
  id: string
  label: string
  ordinal: number
  text: string
}

export interface AdminVersionSummaryRecord {
  id: string
  questionId: string
  versionNumber: number
  status:
    | 'DRAFT'
    | 'IN_REVIEW'
    | 'CHANGES_REQUESTED'
    | 'APPROVED'
    | 'PUBLISHED'
    | 'RETIRED'
  retirementKind:
    | 'PUBLISHED_RETIREMENT'
    | 'AUTHOR_ERASURE_ABANDONED'
    | 'QUESTION_ARCHIVE_ABANDONED'
    | null
  rowVersion: number
  level: 'N5' | 'N4' | 'N3' | 'N2' | 'N1'
  subject: 'VOCABULARY' | 'GRAMMAR' | 'READING'
  questionType:
    | 'KANJI_READING'
    | 'ORTHOGRAPHY'
    | 'CONTEXT_VOCABULARY'
    | 'PARAPHRASE'
    | 'WORD_USAGE'
    | 'GRAMMAR_SELECT'
    | 'SENTENCE_ORDER'
    | 'TEXT_GRAMMAR'
    | 'SHORT_READING'
    | 'MEDIUM_READING'
    | 'LONG_READING'
    | 'INFO_RETRIEVAL'
  questionText: string
  difficulty: 'EASY' | 'NORMAL' | 'HARD'
  createdByActorId: string | null
  createdByRoleSnapshot: 'USER' | 'ADMIN' | null
  createdByLabelSnapshot: 'ACTIVE_ADMIN' | 'DELETED_ADMIN' | 'SYSTEM_SEED'
  createdAt: Date
  updatedAt: Date
  publishedAt: Date | null
  retiredAt: Date | null
  tags: readonly AdminTagRecord[]
  latestReviewer: AdminAccountActorRecord | null
}

export interface AdminVersionRecord extends AdminVersionSummaryRecord {
  passage: string | null
  correctOptionId: string
  explanationKo: string
  explanationJa: string | null
  options: readonly AdminOptionRecord[]
}

export interface AdminQuestionListRecord {
  questionId: string
  lifecycleStatus: 'ACTIVE' | 'ARCHIVED'
  currentPublishedVersionId: string | null
  openCandidateVersionId: string | null
  questionRowVersion: number
  questionCreatedAt: Date
  selectedVersion: AdminVersionSummaryRecord
  answerCount: number
  correctCount: number
  openReportCount: number
}

export interface ListAdminQuestionRecordsInput {
  q?: string
  level?: AdminVersionSummaryRecord['level']
  subject?: AdminVersionSummaryRecord['subject']
  questionType?: AdminVersionSummaryRecord['questionType']
  difficulty?: AdminVersionSummaryRecord['difficulty']
  lifecycleStatus?: AdminQuestionListRecord['lifecycleStatus']
  versionStatus?: AdminVersionSummaryRecord['status']
  normalizedTag?: string
  authorActorId?: string
  reviewerActorId?: string
  createdFrom?: Date
  createdTo?: Date
  updatedFrom?: Date
  updatedTo?: Date
  sort: 'UPDATED_DESC' | 'CREATED_DESC' | 'LEVEL_ASC' | 'REPORT_COUNT_DESC'
  page: number
  pageSize: number
}

export type AdminAuditCommand =
  | 'QUESTION_CREATE'
  | 'QUESTION_VERSION_CREATE'
  | 'QUESTION_VERSION_UPDATE'
  | 'REVIEW_REQUEST'
  | 'CHANGE_REQUEST'
  | 'APPROVAL'
  | 'APPROVAL_WITHDRAWAL'
  | 'PUBLICATION'
  | 'RETIREMENT'
  | 'QUESTION_ARCHIVE'
  | 'REVIEW_REQUEST_BATCH'
  | 'IMPORT_APPLY'
  | 'EXPORT'
  | 'REPORT_TRIAGE'
  | 'REPORT_RESOLUTION'
  | 'REAUTHENTICATION'
  | 'AUTHOR_ERASURE_ABANDON'

export interface AdminQuestionDetailRecord {
  questionId: string
  lifecycleStatus: 'ACTIVE' | 'ARCHIVED'
  rowVersion: number
  currentPublishedVersionId: string | null
  openCandidateVersionId: string | null
  createdAt: Date
  updatedAt: Date
  versions: readonly AdminVersionSummaryRecord[]
  hasMoreVersions: boolean
  auditSummary: {
    lastCommand: AdminAuditCommand | null
    lastActor: AdminSafeActorRecord | null
    lastOccurredAt: Date | null
    totalCount: number
  }
}

export interface AdminReviewRecord {
  id: string
  questionId: string
  questionVersionId: string
  action:
    | 'REQUESTED'
    | 'CHANGES_REQUESTED'
    | 'APPROVED'
    | 'APPROVAL_WITHDRAWN'
    | 'PUBLISHED'
    | 'RETIRED'
    | 'ARCHIVE_ABANDONED'
    | 'AUTHOR_ERASURE_ABANDONED'
  fromState: AdminVersionSummaryRecord['status']
  toState: AdminVersionSummaryRecord['status']
  actor: AdminSafeActorRecord
  counterpart: AdminAccountActorRecord | null
  reason: string | null
  comment: string | null
  operationId: string
  requestId: string
  occurredAt: Date
}

export type AdminAuditTargetType =
  | 'QUESTION'
  | 'QUESTION_VERSION'
  | 'QUESTION_REPORT'
  | 'REVIEW_REQUEST_BATCH'
  | 'IMPORT_REQUEST'
  | 'EXPORT_REQUEST'
  | 'ADMIN_SESSION'
  | 'USER_ERASURE'

export interface AdminAuditRecord {
  id: string
  command: AdminAuditCommand
  targetType: AdminAuditTargetType
  targetId: string
  actor: AdminSafeActorRecord
  beforeState: string | null
  afterState: string | null
  beforeRowVersion: number | null
  afterRowVersion: number | null
  changedFields: unknown
  metadata: unknown
  contentDigest: string
  operationId: string
  requestId: string
  environment: 'TEST' | 'DEVELOPMENT'
  occurredAt: Date
}

export interface OccurredAtCursorInput {
  occurredAt: Date
  id: string
}

export interface ListAdminAuditRecordsInput {
  command?: AdminAuditCommand
  targetType?: AdminAuditTargetType
  targetId?: string
  actorId?: string
  environment?: AdminAuditRecord['environment']
  occurredFrom?: Date
  occurredTo?: Date
  cursor?: OccurredAtCursorInput
  limit: number
}

export interface AdminQuestionRepository {
  listQuestions: (
    input: ListAdminQuestionRecordsInput
  ) => Promise<{ items: readonly AdminQuestionListRecord[]; total: number }>
  getQuestion: (questionId: string) => Promise<AdminQuestionDetailRecord | null>
  listVersions: (input: {
    questionId: string
    cursor?: { versionNumber: number; id: string }
    limit: number
  }) => Promise<readonly AdminVersionSummaryRecord[] | null>
  findVersion: (versionId: string) => Promise<AdminVersionRecord | null>
  findVersionPair: (input: {
    targetVersionId: string
    baseVersionId: string
  }) => Promise<{ target: AdminVersionRecord; base: AdminVersionRecord } | null>
  listReviews: (input: {
    versionId: string
    cursor?: OccurredAtCursorInput
    limit: number
  }) => Promise<{
    questionVersionId: string
    items: readonly AdminReviewRecord[]
  } | null>
  listTags: (input: {
    normalizedPrefix: string
    limit: number
  }) => Promise<readonly AdminTagRecord[]>
  listAuditLog: (
    input: ListAdminAuditRecordsInput
  ) => Promise<readonly AdminAuditRecord[]>
}

export class AdminQuestionRepositoryUnavailableError extends Error {
  constructor(options: ErrorOptions) {
    super('Admin question repository is unavailable.', options)
    this.name = 'AdminQuestionRepositoryUnavailableError'
  }
}

export class AdminQuestionRepositoryIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AdminQuestionRepositoryIntegrityError'
  }
}

const OPEN_CANDIDATE_STATUSES = [
  'DRAFT',
  'IN_REVIEW',
  'CHANGES_REQUESTED',
  'APPROVED'
] as const
const REVIEWER_ACTIONS = [
  'CHANGES_REQUESTED',
  'APPROVED',
  'APPROVAL_WITHDRAWN'
] as const
const UNAVAILABLE_PRISMA_CODES = new Set(['P1001', 'P1002', 'P2024', 'P2034'])

const isUnavailableError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientInitializationError ||
  (error instanceof Prisma.PrismaClientKnownRequestError &&
    UNAVAILABLE_PRISMA_CODES.has(error.code))

const execute = async <Result>(
  operation: () => Promise<Result>
): Promise<Result> => {
  try {
    return await operation()
  } catch (error: unknown) {
    if (isUnavailableError(error)) {
      throw new AdminQuestionRepositoryUnavailableError({ cause: error })
    }
    throw error
  }
}

const toAccountActor = (input: {
  actorId: string | null
  role: 'USER' | 'ADMIN' | null
  label:
    | 'ACTIVE_USER'
    | 'DELETED_USER'
    | 'ACTIVE_ADMIN'
    | 'DELETED_ADMIN'
    | null
}): AdminAccountActorRecord | null => {
  const values = [input.actorId, input.role, input.label]
  if (values.every((value) => value === null)) return null
  if (values.some((value) => value === null)) {
    throw new AdminQuestionRepositoryIntegrityError(
      'Partial account actor evidence is not allowed.'
    )
  }
  const roleMatchesLabel =
    (input.role === 'USER' && input.label?.endsWith('_USER')) ||
    (input.role === 'ADMIN' && input.label?.endsWith('_ADMIN'))
  if (!roleMatchesLabel) {
    throw new AdminQuestionRepositoryIntegrityError(
      'Account actor role and label do not match.'
    )
  }
  return {
    kind: 'ACCOUNT',
    actorId: input.actorId!,
    role: input.role!,
    label: input.label!
  }
}

const toSafeActor = (input: {
  kind: 'ACCOUNT' | 'SYSTEM'
  actorId: string | null
  role: 'USER' | 'ADMIN' | 'SYSTEM'
  label:
    | 'ACTIVE_USER'
    | 'DELETED_USER'
    | 'ACTIVE_ADMIN'
    | 'DELETED_ADMIN'
    | null
  systemLabel: 'ACCOUNT_ERASURE' | null
}): AdminSafeActorRecord => {
  if (input.kind === 'SYSTEM') {
    if (
      input.role !== 'SYSTEM' ||
      input.actorId !== null ||
      input.label !== null ||
      input.systemLabel !== 'ACCOUNT_ERASURE'
    ) {
      throw new AdminQuestionRepositoryIntegrityError(
        'Invalid system actor evidence.'
      )
    }
    return {
      kind: 'SYSTEM',
      actorId: null,
      role: 'SYSTEM',
      label: 'ACCOUNT_ERASURE'
    }
  }
  if (input.role === 'SYSTEM' || input.systemLabel !== null) {
    throw new AdminQuestionRepositoryIntegrityError(
      'Account actor contains system evidence.'
    )
  }
  const actor = toAccountActor({
    actorId: input.actorId,
    role: input.role,
    label: input.label
  })
  if (!actor) {
    throw new AdminQuestionRepositoryIntegrityError(
      'Invalid account actor evidence.'
    )
  }
  return actor
}

const versionSummarySelect = {
  id: true,
  questionId: true,
  versionNumber: true,
  status: true,
  retirementKind: true,
  rowVersion: true,
  level: true,
  subject: true,
  questionType: true,
  questionText: true,
  difficulty: true,
  createdByActorId: true,
  createdByRoleSnapshot: true,
  createdByLabelSnapshot: true,
  createdAt: true,
  updatedAt: true,
  publishedAt: true,
  retiredAt: true,
  tags: {
    select: {
      tagId: true,
      labelSnapshot: true,
      normalizedNameSnapshot: true
    }
  },
  contentReviews: {
    where: {
      action: { in: [...REVIEWER_ACTIONS] },
      actorKind: 'ACCOUNT' as const
    },
    orderBy: [{ occurredAt: 'desc' as const }, { id: 'desc' as const }],
    take: 1,
    select: { actorId: true, actorRole: true, actorLabel: true }
  }
} satisfies Prisma.QuestionVersionSelect

const versionSelect = {
  ...versionSummarySelect,
  passage: true,
  correctOptionId: true,
  explanationKo: true,
  explanationJa: true,
  options: {
    orderBy: { ordinal: 'asc' as const },
    select: { id: true, label: true, ordinal: true, text: true }
  }
} satisfies Prisma.QuestionVersionSelect

type SelectedVersionSummary = Prisma.QuestionVersionGetPayload<{
  select: typeof versionSummarySelect
}>
type SelectedVersion = Prisma.QuestionVersionGetPayload<{
  select: typeof versionSelect
}>

const compareTagRecord = (
  left: AdminTagRecord,
  right: AdminTagRecord
): number =>
  compareUnicodeScalars(left.normalizedName, right.normalizedName) ||
  compareUnicodeScalars(left.id, right.id)

const mapVersionSummary = (
  version: SelectedVersionSummary
): AdminVersionSummaryRecord => ({
  id: version.id,
  questionId: version.questionId,
  versionNumber: version.versionNumber,
  status: version.status,
  retirementKind: version.retirementKind,
  rowVersion: version.rowVersion,
  level: version.level,
  subject: version.subject,
  questionType: version.questionType,
  questionText: version.questionText,
  difficulty: version.difficulty,
  createdByActorId: version.createdByActorId,
  createdByRoleSnapshot: version.createdByRoleSnapshot,
  createdByLabelSnapshot: version.createdByLabelSnapshot,
  createdAt: version.createdAt,
  updatedAt: version.updatedAt,
  publishedAt: version.publishedAt,
  retiredAt: version.retiredAt,
  tags: version.tags
    .map((tag) => ({
      id: tag.tagId,
      label: tag.labelSnapshot,
      normalizedName: tag.normalizedNameSnapshot
    }))
    .toSorted(compareTagRecord),
  latestReviewer: toAccountActor({
    actorId: version.contentReviews[0]?.actorId ?? null,
    role:
      version.contentReviews[0]?.actorRole === 'SYSTEM'
        ? null
        : (version.contentReviews[0]?.actorRole ?? null),
    label: version.contentReviews[0]?.actorLabel ?? null
  })
})

const mapVersion = (version: SelectedVersion): AdminVersionRecord => ({
  ...mapVersionSummary(version),
  passage: version.passage,
  correctOptionId: version.correctOptionId,
  explanationKo: version.explanationKo,
  explanationJa: version.explanationJa,
  options: version.options
})

const versionCursorWhere = (
  cursor: { versionNumber: number; id: string } | undefined
): Prisma.QuestionVersionWhereInput =>
  cursor
    ? {
        OR: [
          { versionNumber: { lt: cursor.versionNumber } },
          { versionNumber: cursor.versionNumber, id: { lt: cursor.id } }
        ]
      }
    : {}

const occurredCursorWhere = (
  cursor: OccurredAtCursorInput | undefined
): Prisma.ContentReviewWhereInput =>
  cursor
    ? {
        OR: [
          { occurredAt: { lt: cursor.occurredAt } },
          { occurredAt: cursor.occurredAt, id: { lt: cursor.id } }
        ]
      }
    : {}

const inReadSnapshot = async <Result>(
  client: PrismaClient,
  operation: (transaction: Prisma.TransactionClient) => Promise<Result>
): Promise<Result> =>
  client.$transaction(
    async (transaction) => {
      await transaction.$executeRawUnsafe('SET TRANSACTION READ ONLY')
      return operation(transaction)
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
  )

interface QuestionPageRow {
  questionId: string | null
  lifecycleStatus: 'ACTIVE' | 'ARCHIVED' | null
  currentPublishedVersionId: string | null
  openCandidateVersionId: string | null
  questionRowVersion: number | null
  questionCreatedAt: Date | null
  selectedVersionId: string | null
  answerCount: bigint | null
  correctCount: bigint | null
  openReportCount: bigint | null
  total: bigint
}

const toSafeCount = (value: bigint, label: string): number => {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new AdminQuestionRepositoryIntegrityError(
      `${label} exceeds the safe integer range.`
    )
  }
  return Number(value)
}

const escapeLikePrefix = (value: string): string =>
  value.replace(/[\\%_]/gu, '\\$&')

const questionPageOrder = (
  sort: ListAdminQuestionRecordsInput['sort']
): Prisma.Sql => {
  if (sort === 'CREATED_DESC') {
    return Prisma.sql`"questionCreatedAt" DESC, "questionId" DESC`
  }
  if (sort === 'LEVEL_ASC') {
    return Prisma.sql`
      CASE "selectedLevel"
        WHEN 'N5' THEN 0 WHEN 'N4' THEN 1 WHEN 'N3' THEN 2
        WHEN 'N2' THEN 3 WHEN 'N1' THEN 4
      END ASC,
      "questionId" ASC
    `
  }
  if (sort === 'REPORT_COUNT_DESC') {
    return Prisma.sql`
      "openReportCount" DESC,
      "selectedUpdatedAt" DESC,
      "questionId" DESC
    `
  }
  return Prisma.sql`"selectedUpdatedAt" DESC, "questionId" DESC`
}

const buildQuestionPageWhere = (
  input: ListAdminQuestionRecordsInput
): Prisma.Sql => {
  const clauses: Prisma.Sql[] = [Prisma.sql`TRUE`]
  if (input.q) {
    clauses.push(
      Prisma.sql`sv."questionText" COLLATE "C" LIKE ${`${escapeLikePrefix(input.q)}%`} ESCAPE '\\'`
    )
  }
  if (input.level) clauses.push(Prisma.sql`sv."level"::text = ${input.level}`)
  if (input.subject)
    clauses.push(Prisma.sql`sv."subject"::text = ${input.subject}`)
  if (input.questionType)
    clauses.push(Prisma.sql`sv."questionType"::text = ${input.questionType}`)
  if (input.difficulty)
    clauses.push(Prisma.sql`sv."difficulty"::text = ${input.difficulty}`)
  if (input.lifecycleStatus)
    clauses.push(
      Prisma.sql`q."lifecycleStatus"::text = ${input.lifecycleStatus}`
    )
  if (input.versionStatus)
    clauses.push(Prisma.sql`sv."status"::text = ${input.versionStatus}`)
  if (input.normalizedTag) {
    clauses.push(Prisma.sql`
      EXISTS (
        SELECT 1
        FROM "QuestionVersionTag" qvt
        WHERE qvt."questionVersionId" = sv."id"
          AND qvt."normalizedNameSnapshot" = ${input.normalizedTag}
      )
    `)
  }
  if (input.authorActorId)
    clauses.push(
      Prisma.sql`sv."createdByActorId" = ${input.authorActorId}::uuid`
    )
  if (input.reviewerActorId)
    clauses.push(
      Prisma.sql`reviewer."actorId" = ${input.reviewerActorId}::uuid`
    )
  if (input.createdFrom)
    clauses.push(Prisma.sql`q."createdAt" >= ${input.createdFrom}`)
  if (input.createdTo)
    clauses.push(Prisma.sql`q."createdAt" < ${input.createdTo}`)
  if (input.updatedFrom)
    clauses.push(Prisma.sql`sv."updatedAt" >= ${input.updatedFrom}`)
  if (input.updatedTo)
    clauses.push(Prisma.sql`sv."updatedAt" < ${input.updatedTo}`)
  return Prisma.join(clauses, ' AND ')
}

export const buildAdminQuestionPageQuery = (
  input: ListAdminQuestionRecordsInput
): Prisma.Sql => {
  const offset = (BigInt(input.page) - 1n) * BigInt(input.pageSize)
  return Prisma.sql`
    WITH selected AS MATERIALIZED (
      SELECT
        q."id" AS "questionId",
        q."lifecycleStatus" AS "lifecycleStatus",
        q."currentPublishedVersionId" AS "currentPublishedVersionId",
        candidate."openCandidateVersionId" AS "openCandidateVersionId",
        q."rowVersion" AS "questionRowVersion",
        q."createdAt" AS "questionCreatedAt",
        sv."id" AS "selectedVersionId",
        sv."level" AS "selectedLevel",
        sv."updatedAt" AS "selectedUpdatedAt",
        COALESCE(answer_stats."answerCount", 0)::bigint AS "answerCount",
        COALESCE(answer_stats."correctCount", 0)::bigint AS "correctCount",
        COALESCE(report_stats."openReportCount", 0)::bigint AS "openReportCount"
      FROM "Question" q
      LEFT JOIN LATERAL (
        SELECT v."id" AS "openCandidateVersionId"
        FROM "QuestionVersion" v
        WHERE v."questionId" = q."id"
          AND v."status" IN (
            'DRAFT'::"QuestionVersionStatus",
            'IN_REVIEW'::"QuestionVersionStatus",
            'CHANGES_REQUESTED'::"QuestionVersionStatus",
            'APPROVED'::"QuestionVersionStatus"
          )
        ORDER BY v."versionNumber" DESC, v."id" DESC
        LIMIT 1
      ) candidate ON TRUE
      JOIN LATERAL (
        SELECT
          v."id",
          v."status",
          v."level",
          v."subject",
          v."questionType",
          v."questionText",
          v."difficulty",
          v."createdByActorId",
          v."updatedAt",
          v."versionNumber"
        FROM "QuestionVersion" v
        WHERE v."questionId" = q."id"
        ORDER BY
          CASE
            WHEN v."id" = candidate."openCandidateVersionId" THEN 0
            WHEN v."id" = q."currentPublishedVersionId" THEN 1
            ELSE 2
          END ASC,
          v."versionNumber" DESC,
          v."id" DESC
        LIMIT 1
      ) sv ON TRUE
      LEFT JOIN LATERAL (
        SELECT cr."actorId"
        FROM "ContentReview" cr
        WHERE cr."questionVersionId" = sv."id"
          AND cr."actorKind" = 'ACCOUNT'::"EvidenceActorKind"
          AND cr."action" IN (
            'CHANGES_REQUESTED'::"ContentReviewAction",
            'APPROVED'::"ContentReviewAction",
            'APPROVAL_WITHDRAWN'::"ContentReviewAction"
          )
        ORDER BY cr."occurredAt" DESC, cr."id" DESC
        LIMIT 1
      ) reviewer ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          count(*)::bigint AS "answerCount",
          count(*) FILTER (WHERE sa."isCorrect")::bigint AS "correctCount"
        FROM "StudyAnswer" sa
        WHERE sa."questionVersionId" = sv."id"
      ) answer_stats ON TRUE
      LEFT JOIN LATERAL (
        SELECT count(*)::bigint AS "openReportCount"
        FROM "QuestionReport" qr
        WHERE qr."questionId" = q."id"
          AND qr."status" IN (
            'OPEN'::"QuestionReportStatus",
            'TRIAGED'::"QuestionReportStatus"
          )
      ) report_stats ON TRUE
      WHERE ${buildQuestionPageWhere(input)}
    ),
    page AS (
      SELECT * FROM selected
      ORDER BY ${questionPageOrder(input.sort)}
      OFFSET ${offset}
      LIMIT ${input.pageSize}
    ),
    totals AS (SELECT count(*)::bigint AS total FROM selected)
    SELECT page.*, totals.total
    FROM totals
    LEFT JOIN page ON TRUE
    ORDER BY ${questionPageOrder(input.sort)}
  `
}

const listQuestionPage = async (
  transaction: Prisma.TransactionClient,
  input: ListAdminQuestionRecordsInput
): Promise<{ items: readonly AdminQuestionListRecord[]; total: number }> => {
  const rows = await transaction.$queryRaw<QuestionPageRow[]>(
    buildAdminQuestionPageQuery(input)
  )
  const totalValue = rows[0]?.total ?? 0n
  const total = toSafeCount(totalValue, 'Admin question count')
  const pageRows = rows.filter(
    (row): row is QuestionPageRow & { selectedVersionId: string } =>
      row.selectedVersionId !== null
  )
  if (pageRows.length === 0) return { items: [], total }

  const versions = await transaction.questionVersion.findMany({
    where: {
      id: { in: pageRows.map(({ selectedVersionId }) => selectedVersionId) }
    },
    select: versionSummarySelect
  })
  const versionById = new Map(
    versions.map((version) => [version.id, mapVersionSummary(version)])
  )
  return {
    total,
    items: pageRows.map((row) => {
      const version = versionById.get(row.selectedVersionId)
      if (
        !version ||
        !row.questionId ||
        !row.lifecycleStatus ||
        row.questionRowVersion === null ||
        !row.questionCreatedAt
      ) {
        throw new AdminQuestionRepositoryIntegrityError(
          'Selected admin question projection is incomplete.'
        )
      }
      return {
        questionId: row.questionId,
        lifecycleStatus: row.lifecycleStatus,
        currentPublishedVersionId: row.currentPublishedVersionId,
        openCandidateVersionId: row.openCandidateVersionId,
        questionRowVersion: row.questionRowVersion,
        questionCreatedAt: row.questionCreatedAt,
        selectedVersion: version,
        answerCount: toSafeCount(row.answerCount ?? 0n, 'Answer count'),
        correctCount: toSafeCount(row.correctCount ?? 0n, 'Correct count'),
        openReportCount: toSafeCount(
          row.openReportCount ?? 0n,
          'Open report count'
        )
      }
    })
  }
}

interface AuditSummaryRow {
  command: AdminAuditCommand
  actorKind: 'ACCOUNT' | 'SYSTEM'
  actorId: string | null
  actorRole: 'USER' | 'ADMIN' | 'SYSTEM'
  actorLabel:
    | 'ACTIVE_USER'
    | 'DELETED_USER'
    | 'ACTIVE_ADMIN'
    | 'DELETED_ADMIN'
    | null
  actorSystemLabel: 'ACCOUNT_ERASURE' | null
  occurredAt: Date
  totalCount: bigint
}

const getQuestionDetail = async (
  transaction: Prisma.TransactionClient,
  questionId: string
): Promise<AdminQuestionDetailRecord | null> => {
  const question = await transaction.question.findUnique({
    where: { id: questionId },
    select: {
      id: true,
      lifecycleStatus: true,
      currentPublishedVersionId: true,
      rowVersion: true,
      createdAt: true,
      updatedAt: true,
      versions: {
        orderBy: [{ versionNumber: 'desc' }, { id: 'desc' }],
        take: 21,
        select: versionSummarySelect
      }
    }
  })
  if (!question) return null
  const openCandidate = await transaction.questionVersion.findFirst({
    where: {
      questionId,
      status: { in: [...OPEN_CANDIDATE_STATUSES] }
    },
    orderBy: [{ versionNumber: 'desc' }, { id: 'desc' }],
    select: { id: true }
  })
  const auditRows = await transaction.$queryRaw<AuditSummaryRow[]>(Prisma.sql`
    SELECT
      audit."command",
      audit."actorKind",
      audit."actorId",
      audit."actorRole",
      audit."actorLabel",
      audit."actorSystemLabel",
      audit."occurredAt",
      count(*) OVER ()::bigint AS "totalCount"
    FROM "AdminAuditLog" audit
    WHERE
      (
        audit."targetType" = 'QUESTION'::"AdminAuditTargetType"
        AND audit."targetId" = ${questionId}::uuid
      )
      OR (
        audit."targetType" = 'QUESTION_VERSION'::"AdminAuditTargetType"
        AND audit."targetId" IN (
          SELECT version."id"
          FROM "QuestionVersion" version
          WHERE version."questionId" = ${questionId}::uuid
        )
      )
    ORDER BY audit."occurredAt" DESC, audit."id" DESC
    LIMIT 1
  `)
  const lastAudit = auditRows[0]
  return {
    questionId: question.id,
    lifecycleStatus: question.lifecycleStatus,
    rowVersion: question.rowVersion,
    currentPublishedVersionId: question.currentPublishedVersionId,
    openCandidateVersionId: openCandidate?.id ?? null,
    createdAt: question.createdAt,
    updatedAt: question.updatedAt,
    versions: question.versions.slice(0, 20).map(mapVersionSummary),
    hasMoreVersions: question.versions.length > 20,
    auditSummary: {
      lastCommand: lastAudit?.command ?? null,
      lastActor: lastAudit
        ? toSafeActor({
            kind: lastAudit.actorKind,
            actorId: lastAudit.actorId,
            role: lastAudit.actorRole,
            label: lastAudit.actorLabel,
            systemLabel: lastAudit.actorSystemLabel
          })
        : null,
      lastOccurredAt: lastAudit?.occurredAt ?? null,
      totalCount: toSafeCount(
        lastAudit?.totalCount ?? 0n,
        'Question audit count'
      )
    }
  }
}

const listQuestionVersions = async (
  transaction: Prisma.TransactionClient,
  input: {
    questionId: string
    cursor?: { versionNumber: number; id: string }
    limit: number
  }
): Promise<readonly AdminVersionSummaryRecord[] | null> => {
  const exists = await transaction.question.count({
    where: { id: input.questionId }
  })
  if (exists === 0) return null
  const versions = await transaction.questionVersion.findMany({
    where: {
      questionId: input.questionId,
      ...versionCursorWhere(input.cursor)
    },
    orderBy: [{ versionNumber: 'desc' }, { id: 'desc' }],
    take: input.limit + 1,
    select: versionSummarySelect
  })
  return versions.map(mapVersionSummary)
}

const findQuestionVersion = async (
  transaction: Prisma.TransactionClient,
  versionId: string
): Promise<AdminVersionRecord | null> => {
  const version = await transaction.questionVersion.findUnique({
    where: { id: versionId },
    select: versionSelect
  })
  return version ? mapVersion(version) : null
}

const findQuestionVersionPair = async (
  transaction: Prisma.TransactionClient,
  input: { targetVersionId: string; baseVersionId: string }
): Promise<{ target: AdminVersionRecord; base: AdminVersionRecord } | null> => {
  const target = await transaction.questionVersion.findUnique({
    where: { id: input.targetVersionId },
    select: versionSelect
  })
  if (!target) return null
  const base = await transaction.questionVersion.findFirst({
    where: { id: input.baseVersionId, questionId: target.questionId },
    select: versionSelect
  })
  return base ? { target: mapVersion(target), base: mapVersion(base) } : null
}

const listQuestionVersionReviews = async (
  transaction: Prisma.TransactionClient,
  input: {
    versionId: string
    cursor?: OccurredAtCursorInput
    limit: number
  }
): Promise<{
  questionVersionId: string
  items: readonly AdminReviewRecord[]
} | null> => {
  const versionExists = await transaction.questionVersion.count({
    where: { id: input.versionId }
  })
  if (versionExists === 0) return null
  const rows = await transaction.contentReview.findMany({
    where: {
      questionVersionId: input.versionId,
      ...occurredCursorWhere(input.cursor)
    },
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    take: input.limit + 1
  })
  return {
    questionVersionId: input.versionId,
    items: rows.map((row) => ({
      id: row.id,
      questionId: row.questionId,
      questionVersionId: row.questionVersionId,
      action: row.action,
      fromState: row.fromState,
      toState: row.toState,
      actor: toSafeActor({
        kind: row.actorKind,
        actorId: row.actorId,
        role: row.actorRole,
        label: row.actorLabel,
        systemLabel: row.actorSystemLabel
      }),
      counterpart: toAccountActor({
        actorId: row.counterpartActorId,
        role: row.counterpartRole,
        label: row.counterpartLabel
      }),
      reason: row.reason,
      comment: row.comment,
      operationId: row.operationId,
      requestId: row.requestId,
      occurredAt: row.occurredAt
    }))
  }
}

const listAdminTags = async (
  transaction: Prisma.TransactionClient,
  input: { normalizedPrefix: string; limit: number }
): Promise<readonly AdminTagRecord[]> => {
  const prefix = `${escapeLikePrefix(input.normalizedPrefix)}%`
  return transaction.$queryRaw<AdminTagRecord[]>(Prisma.sql`
    SELECT "id", "label", "normalizedName"
    FROM "Tag"
    WHERE "normalizedName" COLLATE "C" LIKE ${prefix} ESCAPE '\\'
    ORDER BY "normalizedName" COLLATE "C" ASC, "id" ASC
    LIMIT ${input.limit}
  `)
}

const listAuditRecords = async (
  transaction: Prisma.TransactionClient,
  input: ListAdminAuditRecordsInput
): Promise<readonly AdminAuditRecord[]> => {
  const rows = await transaction.adminAuditLog.findMany({
    where: {
      ...(input.command ? { command: input.command } : {}),
      ...(input.targetType ? { targetType: input.targetType } : {}),
      ...(input.targetId ? { targetId: input.targetId } : {}),
      ...(input.actorId
        ? { actorKind: 'ACCOUNT', actorId: input.actorId }
        : {}),
      ...(input.environment ? { environment: input.environment } : {}),
      ...(input.occurredFrom || input.occurredTo
        ? {
            occurredAt: {
              ...(input.occurredFrom ? { gte: input.occurredFrom } : {}),
              ...(input.occurredTo ? { lt: input.occurredTo } : {})
            }
          }
        : {}),
      ...(input.cursor
        ? {
            OR: [
              { occurredAt: { lt: input.cursor.occurredAt } },
              {
                occurredAt: input.cursor.occurredAt,
                id: { lt: input.cursor.id }
              }
            ]
          }
        : {})
    },
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    take: input.limit + 1
  })
  return rows.map((row) => ({
    id: row.id,
    command: row.command,
    targetType: row.targetType,
    targetId: row.targetId,
    actor: toSafeActor({
      kind: row.actorKind,
      actorId: row.actorId,
      role: row.actorRole,
      label: row.actorLabel,
      systemLabel: row.actorSystemLabel
    }),
    beforeState: row.beforeState,
    afterState: row.afterState,
    beforeRowVersion: row.beforeRowVersion,
    afterRowVersion: row.afterRowVersion,
    changedFields: row.changedFields,
    metadata: row.metadata,
    contentDigest: row.contentDigest,
    operationId: row.operationId,
    requestId: row.requestId,
    environment: row.environment,
    occurredAt: row.occurredAt
  }))
}

export const createPrismaAdminQuestionRepository = (
  client: PrismaClient
): AdminQuestionRepository => ({
  listQuestions: (input) =>
    execute(() =>
      inReadSnapshot(client, (transaction) =>
        listQuestionPage(transaction, input)
      )
    ),
  getQuestion: (questionId) =>
    execute(() =>
      inReadSnapshot(client, (transaction) =>
        getQuestionDetail(transaction, questionId)
      )
    ),
  listVersions: (input) =>
    execute(() =>
      inReadSnapshot(client, (transaction) =>
        listQuestionVersions(transaction, input)
      )
    ),
  findVersion: (versionId) =>
    execute(() =>
      inReadSnapshot(client, (transaction) =>
        findQuestionVersion(transaction, versionId)
      )
    ),
  findVersionPair: (input) =>
    execute(() =>
      inReadSnapshot(client, (transaction) =>
        findQuestionVersionPair(transaction, input)
      )
    ),
  listReviews: (input) =>
    execute(() =>
      inReadSnapshot(client, (transaction) =>
        listQuestionVersionReviews(transaction, input)
      )
    ),
  listTags: (input) =>
    execute(() =>
      inReadSnapshot(client, (transaction) => listAdminTags(transaction, input))
    ),
  listAuditLog: (input) =>
    execute(() =>
      inReadSnapshot(client, (transaction) =>
        listAuditRecords(transaction, input)
      )
    )
})
