import { randomUUID } from 'node:crypto'
import type {
  CreateQuestionReportRequest,
  ListAdminQuestionReportsQuery,
  ListAdminQuestionReportsResponse,
  Phase7ExecutionDisposition,
  QuestionReportDetail,
  QuestionReportMutationResult,
  QuestionReportSummary
} from '@nihongo/contracts/admin/phase7'
import type { StableErrorCode } from '@nihongo/contracts/common/error'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'

export interface QuestionReportCreateAuthority {
  readonly actorId: string
  readonly rawSessionToken: string
}

export class QuestionReportRepositoryError extends Error {
  readonly code: StableErrorCode
  readonly disposition: Phase7ExecutionDisposition

  constructor(input: {
    readonly code: StableErrorCode
    readonly message: string
    readonly disposition: Phase7ExecutionDisposition
    readonly cause?: unknown
  }) {
    super(input.message, { cause: input.cause })
    this.name = 'QuestionReportRepositoryError'
    this.code = input.code
    this.disposition = input.disposition
  }
}

interface ReportRow {
  readonly id: string
  readonly questionId: string
  readonly questionVersionId: string
  readonly reason: QuestionReportSummary['reason']
  readonly description: string | null
  readonly descriptionDigest: string
  readonly status: QuestionReportSummary['status']
  readonly rowVersion: number
  readonly reporterActorId: string
  readonly reporterRole: 'USER' | 'ADMIN'
  readonly reporterLabel:
    | 'ACTIVE_USER'
    | 'DELETED_USER'
    | 'ACTIVE_ADMIN'
    | 'DELETED_ADMIN'
  readonly assigneeActorId: string | null
  readonly assigneeRole: 'ADMIN' | null
  readonly assigneeLabel: 'ACTIVE_ADMIN' | 'DELETED_ADMIN' | null
  readonly resolutionOutcome: 'RESOLVED' | 'DISMISSED' | null
  readonly resolutionReason: string | null
  readonly remediationVersionId: string | null
  readonly resolvedAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

interface EntitledTargetRow {
  readonly questionId: string
}

interface CountRow {
  readonly total: bigint
}

interface EntitledDuplicateStateRow extends EntitledTargetRow {
  readonly hasOpenDuplicate: boolean
}

interface ReporterAuthorityRow {
  readonly role: 'USER' | 'ADMIN'
  readonly userId: string
}

const reportSelection = `report."id", report."questionId",
  report."questionVersionId", report."reason", report."description",
  report."descriptionDigest", report."status", report."rowVersion",
  report."reporterActorId", report."reporterRole", report."reporterLabel",
  report."assigneeActorId", report."assigneeRole", report."assigneeLabel",
  report."resolutionOutcome", report."resolutionReason",
  report."remediationVersionId", report."resolvedAt",
  report."createdAt", report."updatedAt"`

const toActor = (
  actorId: string,
  role: 'USER' | 'ADMIN',
  label: ReportRow['reporterLabel']
) => ({ kind: 'ACCOUNT' as const, actorId, role, label })

const toAssignee = (row: ReportRow) =>
  row.assigneeActorId && row.assigneeRole && row.assigneeLabel
    ? toActor(row.assigneeActorId, row.assigneeRole, row.assigneeLabel)
    : null

const toResolution = (row: ReportRow) =>
  row.resolutionOutcome && row.resolutionReason && row.resolvedAt
    ? {
        outcome: row.resolutionOutcome,
        reason: row.resolutionReason,
        remediationVersionId: row.remediationVersionId,
        resolvedAt: row.resolvedAt.toISOString()
      }
    : null

const toSummary = (row: ReportRow): QuestionReportSummary => ({
  id: row.id,
  questionId: row.questionId,
  questionVersionId: row.questionVersionId,
  reason: row.reason,
  status: row.status,
  rowVersion: row.rowVersion,
  reporter: toActor(row.reporterActorId, row.reporterRole, row.reporterLabel),
  assignee: toAssignee(row),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString()
})

const toDetail = (row: ReportRow): QuestionReportDetail => ({
  ...toSummary(row),
  description: row.description,
  descriptionDigest: row.descriptionDigest,
  resolution: toResolution(row)
})

const toMutation = (row: ReportRow): QuestionReportMutationResult => ({
  id: row.id,
  questionId: row.questionId,
  questionVersionId: row.questionVersionId,
  status: row.status,
  rowVersion: row.rowVersion,
  assignee: toAssignee(row),
  resolution: toResolution(row),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString()
})

const rawDatabaseIdentity = (
  error: unknown
): { readonly sqlState: string; readonly message: string } | undefined => {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2010' ||
    typeof error.meta !== 'object' ||
    error.meta === null
  ) {
    return undefined
  }
  const meta = error.meta as Record<string, unknown>
  const identities: Array<{ sqlState: string; message: string }> = []
  if (typeof meta.code === 'string' && typeof meta.message === 'string') {
    identities.push({ sqlState: meta.code, message: meta.message })
  }
  const driver = meta.driverAdapterError
  if (typeof driver === 'object' && driver !== null) {
    const cause = (driver as Record<string, unknown>).cause
    if (typeof cause === 'object' && cause !== null) {
      const record = cause as Record<string, unknown>
      if (
        typeof record.originalCode === 'string' &&
        typeof record.originalMessage === 'string'
      ) {
        identities.push({
          sqlState: record.originalCode,
          message: record.originalMessage
        })
      }
    }
  }
  const [first, ...rest] = identities
  if (
    !first ||
    rest.some(
      (identity) =>
        identity.sqlState !== first.sqlState ||
        identity.message !== first.message
    )
  ) {
    return undefined
  }
  return {
    sqlState: first.sqlState,
    message:
      first.message
        .split('\n', 1)[0]
        ?.replace(/^ERROR:\s*/u, '')
        .trim() ?? ''
  }
}

const mapCreateError = (error: unknown): QuestionReportRepositoryError => {
  if (error instanceof QuestionReportRepositoryError) return error
  const identity = rawDatabaseIdentity(error)
  const prismaUniqueConstraint =
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    typeof error.meta === 'object' &&
    error.meta !== null &&
    JSON.stringify(error.meta).includes('QuestionReport_open_duplicate_key')
  if (
    (identity?.sqlState === '23505' &&
      identity.message.includes('QuestionReport_open_duplicate_key')) ||
    prismaUniqueConstraint
  ) {
    return new QuestionReportRepositoryError({
      code: 'QUESTION_REPORT_DUPLICATE',
      message: '같은 문제 버전과 사유의 처리 중 신고가 이미 있습니다.',
      disposition: 'DEFINITE_ROLLBACK',
      cause: error
    })
  }
  if (
    identity?.sqlState === '23503' &&
    identity.message.startsWith('QuestionReport target')
  ) {
    return new QuestionReportRepositoryError({
      code: 'RESOURCE_NOT_FOUND',
      message: '신고할 수 있는 문제 버전을 찾을 수 없습니다.',
      disposition: 'DEFINITE_ROLLBACK',
      cause: error
    })
  }
  if (
    identity?.sqlState === '42501' &&
    identity.message.startsWith('QuestionReport reporter')
  ) {
    return new QuestionReportRepositoryError({
      code: 'AUTH_SESSION_EXPIRED',
      message: '로그인 세션이 만료됐습니다.',
      disposition: 'DEFINITE_ROLLBACK',
      cause: error
    })
  }
  const definiteRollback =
    identity !== undefined ||
    (error instanceof Prisma.PrismaClientKnownRequestError &&
      ['P2002', 'P2003', 'P2034'].includes(error.code))
  return new QuestionReportRepositoryError({
    code: 'SERVICE_UNAVAILABLE',
    message: '문제 신고 결과를 확인할 수 없습니다.',
    disposition: definiteRollback ? 'DEFINITE_ROLLBACK' : 'COMMIT_UNKNOWN',
    cause: error
  })
}

const loadReport = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'> | Prisma.TransactionClient,
  reportId: string
): Promise<ReportRow | null> => {
  const rows = await client.$queryRawUnsafe<ReportRow[]>(
    `SELECT ${reportSelection} FROM "QuestionReport" AS report
     WHERE report."id" = $1`,
    reportId
  )
  return rows[0] ?? null
}

export interface QuestionReportRepository {
  readonly findEntitledTarget: (
    reporterId: string,
    questionVersionId: string
  ) => Promise<{ readonly questionId: string } | null>
  readonly findEntitledDuplicateState: (
    reporterId: string,
    questionVersionId: string,
    reason: CreateQuestionReportRequest['reason']
  ) => Promise<{
    readonly questionId: string
    readonly hasOpenDuplicate: boolean
  } | null>
  readonly create: (
    authority: QuestionReportCreateAuthority,
    questionId: string,
    request: CreateQuestionReportRequest
  ) => Promise<QuestionReportMutationResult>
  readonly list: (
    query: ListAdminQuestionReportsQuery
  ) => Promise<ListAdminQuestionReportsResponse>
  readonly get: (reportId: string) => Promise<QuestionReportDetail | null>
}

export const createPrismaQuestionReportRepository = (
  client: PrismaClient
): QuestionReportRepository => ({
  findEntitledTarget: async (reporterId, questionVersionId) => {
    const rows = await client.$queryRawUnsafe<EntitledTargetRow[]>(
      `SELECT version."questionId"
       FROM "QuestionVersion" AS version
       JOIN "Question" AS question ON question."id" = version."questionId"
       WHERE version."id" = $2
         AND (
           question."lifecycleStatus" = 'ACTIVE'
             AND question."currentPublishedVersionId" = version."id"
           OR EXISTS (
             SELECT 1
             FROM "StudySessionQuestion" AS session_question
             JOIN "StudySession" AS study_session
               ON study_session."id" = session_question."studySessionId"
             WHERE study_session."userId" = $1
               AND session_question."questionId" = version."questionId"
               AND session_question."questionVersionId" = version."id"
           )
           OR EXISTS (
             SELECT 1 FROM "WrongNote" AS note
             WHERE note."userId" = $1
               AND note."questionId" = version."questionId"
               AND version."id" IN (
                 note."lastWrongQuestionVersionId",
                 note."currentReviewQuestionVersionId"
               )
           )
         )`,
      reporterId,
      questionVersionId
    )
    return rows[0] ?? null
  },

  findEntitledDuplicateState: async (reporterId, questionVersionId, reason) => {
    const rows = await client.$queryRawUnsafe<EntitledDuplicateStateRow[]>(
      `SELECT version."questionId",
       EXISTS (
         SELECT 1 FROM "QuestionReport" AS report
         WHERE report."reporterActorId" = $1
           AND report."questionVersionId" = $2
           AND report."reason" = $3::"QuestionReportReason"
           AND report."status" IN ('OPEN', 'TRIAGED')
       ) AS "hasOpenDuplicate"
       FROM "QuestionVersion" AS version
       JOIN "Question" AS question ON question."id" = version."questionId"
       WHERE version."id" = $2
         AND (
           question."lifecycleStatus" = 'ACTIVE'
             AND question."currentPublishedVersionId" = version."id"
           OR EXISTS (
             SELECT 1
             FROM "StudySessionQuestion" AS session_question
             JOIN "StudySession" AS study_session
               ON study_session."id" = session_question."studySessionId"
             WHERE study_session."userId" = $1
               AND session_question."questionId" = version."questionId"
               AND session_question."questionVersionId" = version."id"
           )
           OR EXISTS (
             SELECT 1 FROM "WrongNote" AS note
             WHERE note."userId" = $1
               AND note."questionId" = version."questionId"
               AND version."id" IN (
                 note."lastWrongQuestionVersionId",
                 note."currentReviewQuestionVersionId"
               )
           )
         )`,
      reporterId,
      questionVersionId,
      reason
    )
    return rows[0] ?? null
  },

  create: async (authority, questionId, request) => {
    const reportId = randomUUID()
    let callbackCompleted = false
    try {
      return await client.$transaction(
        async (transaction) => {
          const created = await transaction.$queryRawUnsafe<
            Array<{ id: string; rowVersion: number }>
          >(
            `SELECT * FROM "phase7_create_question_report"(
               $1, $2, $3, $4, $5::"QuestionReportReason", $6
             )`,
            authority.rawSessionToken,
            reportId,
            questionId,
            request.questionVersionId,
            request.reason,
            request.description
          )
          if (
            created.length !== 1 ||
            created[0]?.id !== reportId ||
            created[0].rowVersion !== 1
          ) {
            throw new QuestionReportRepositoryError({
              code: 'SERVICE_UNAVAILABLE',
              message: '문제 신고 생성 결과가 완전하지 않습니다.',
              disposition: 'DEFINITE_ROLLBACK'
            })
          }
          const row = await loadReport(transaction, reportId)
          if (!row || row.reporterActorId !== authority.actorId) {
            throw new QuestionReportRepositoryError({
              code: 'SERVICE_UNAVAILABLE',
              message: '문제 신고 신고자 권위를 확정할 수 없습니다.',
              disposition: 'DEFINITE_ROLLBACK'
            })
          }
          const result = toMutation(row)
          const authorityRows = await transaction.$queryRawUnsafe<
            ReporterAuthorityRow[]
          >(
            `SELECT principal."userId", principal."role"
             FROM "phase7_resolve_v1_principal"($1) AS principal`,
            authority.rawSessionToken
          )
          if (
            authorityRows.length !== 1 ||
            authorityRows[0]?.userId !== authority.actorId ||
            authorityRows[0].role !== row.reporterRole
          ) {
            throw new QuestionReportRepositoryError({
              code: 'AUTH_SESSION_EXPIRED',
              message: '로그인 세션이 만료됐습니다.',
              disposition: 'DEFINITE_ROLLBACK'
            })
          }
          callbackCompleted = true
          return result
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
      )
    } catch (error: unknown) {
      const mapped = mapCreateError(error)
      if (!callbackCompleted && mapped.disposition === 'COMMIT_UNKNOWN') {
        throw new QuestionReportRepositoryError({
          code: 'SERVICE_UNAVAILABLE',
          message: '문제 신고 생성 트랜잭션을 완료하지 못했습니다.',
          disposition: 'DEFINITE_ROLLBACK',
          cause: error
        })
      }
      throw mapped
    }
  },

  list: async (query) => {
    const offset = (BigInt(query.page) - 1n) * BigInt(query.pageSize)
    const where = `($1::"QuestionReportStatus" IS NULL OR report."status" = $1)
      AND ($2::"QuestionReportReason" IS NULL OR report."reason" = $2)
      AND ($3::uuid IS NULL OR report."questionId" = $3)
      AND ($4::uuid IS NULL OR report."assigneeActorId" = $4)
      AND ($5::timestamptz IS NULL OR report."createdAt" >= $5)
      AND ($6::timestamptz IS NULL OR report."createdAt" < $6)
      AND ($7::timestamptz IS NULL OR report."updatedAt" >= $7)
      AND ($8::timestamptz IS NULL OR report."updatedAt" < $8)`
    const parameters = [
      query.status ?? null,
      query.reason ?? null,
      query.questionId ?? null,
      query.assigneeActorId ?? null,
      query.createdFrom ?? null,
      query.createdTo ?? null,
      query.updatedFrom ?? null,
      query.updatedTo ?? null
    ] as const
    const order =
      query.sort === 'CREATED_DESC'
        ? 'report."createdAt" DESC, report."id" DESC'
        : 'report."updatedAt" DESC, report."id" DESC'

    return client.$transaction(
      async (transaction) => {
        await transaction.$executeRaw`SET TRANSACTION READ ONLY`
        const countRows = await transaction.$queryRawUnsafe<CountRow[]>(
          `SELECT COUNT(*)::bigint AS "total"
           FROM "QuestionReport" AS report WHERE ${where}`,
          ...parameters
        )
        const rows = await transaction.$queryRawUnsafe<ReportRow[]>(
          `SELECT ${reportSelection} FROM "QuestionReport" AS report
           WHERE ${where} ORDER BY ${order} LIMIT $9 OFFSET $10`,
          ...parameters,
          query.pageSize,
          offset
        )
        const total = countRows[0]?.total
        if (
          typeof total !== 'bigint' ||
          total > BigInt(Number.MAX_SAFE_INTEGER)
        ) {
          throw new Error(
            'QuestionReport total is unavailable or out of bounds.'
          )
        }
        return {
          items: rows.map(toSummary),
          page: query.page,
          pageSize: query.pageSize,
          total: Number(total)
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
    )
  },

  get: async (reportId) => {
    const row = await loadReport(client, reportId)
    return row ? toDetail(row) : null
  }
})
