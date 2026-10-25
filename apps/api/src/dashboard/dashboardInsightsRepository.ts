import type {
  JlptLevel,
  QuestionSubject,
  QuestionType,
  WrongNoteStatus
} from '../generated/prisma/client.js'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { createCurrentReviewCandidatePredicate } from '../review/currentReviewCandidateQuery.js'

export interface DashboardInsightsClockRecord {
  readonly futureAnswerCount: bigint
  readonly observedAt: Date
  readonly targetLevel: JlptLevel | null
}

export type DashboardInsightsNonTagRowKind =
  | 'OVERALL'
  | 'LEVEL'
  | 'SUBJECT'
  | 'QUESTION_TYPE'
  | 'SUBJECT_WEAKNESS'
  | 'QUESTION_TYPE_WEAKNESS'

export interface DashboardInsightsNonTagRecord {
  readonly attemptedCount: bigint
  readonly correctCount: bigint
  readonly elapsedTotal: bigint
  readonly incorrectCount: bigint
  readonly kind: DashboardInsightsNonTagRowKind
  readonly lastAnsweredAt: Date | null
  readonly level: JlptLevel | null
  readonly questionType: QuestionType | null
  readonly repeatExtra: bigint
  readonly subject: QuestionSubject | null
}

export type DashboardInsightsTagRowKind = 'TAG' | 'TAG_WEAKNESS'

export interface DashboardInsightsTagRecord {
  readonly attemptedCount: bigint
  readonly correctCount: bigint
  readonly elapsedTotal: bigint
  readonly incorrectCount: bigint
  readonly kind: DashboardInsightsTagRowKind
  readonly lastAnsweredAt: Date
  readonly level: JlptLevel | null
  readonly repeatExtra: bigint
  readonly subject: QuestionSubject | null
  readonly tagId: string
  readonly tagLabel: string
}

export type DashboardInsightsReviewRowKind =
  | 'COUNTS'
  | 'DUE_GROUP'
  | 'REPEATED_CANDIDATE'
  | 'WEAKNESS_ACTIONABLE'

export interface DashboardInsightsReviewRecord {
  readonly earliestDueAt: Date | null
  readonly isDue: boolean | null
  readonly kind: DashboardInsightsReviewRowKind
  readonly lastWrongAt: Date | null
  readonly level: JlptLevel | null
  readonly questionId: string | null
  readonly questionText: string | null
  readonly repeatedCount: bigint | null
  readonly status: WrongNoteStatus | null
  readonly subject: QuestionSubject | null
  readonly totalCount: bigint
  readonly wrongCount: number | null
}

export interface DashboardInsightsTargetRecord {
  readonly catalogCount: bigint
  readonly lastStudiedAt: Date | null
  readonly level: JlptLevel
  readonly nonRecentCount: bigint
  readonly subject: QuestionSubject
}

export interface DashboardInsightsSnapshotRecord {
  readonly clock: DashboardInsightsClockRecord
  readonly nonTagRows: readonly DashboardInsightsNonTagRecord[]
  readonly reviewRows: readonly DashboardInsightsReviewRecord[]
  readonly tagRows: readonly DashboardInsightsTagRecord[]
  readonly targetRows: readonly DashboardInsightsTargetRecord[]
}

export type DashboardInsightsPrincipal =
  | {
      readonly kind: 'LEGACY'
      readonly userId: string
    }
  | {
      readonly kind: 'PHASE7'
      readonly sessionToken: string
      readonly userId: string
    }

export interface DashboardInsightsRepository {
  readOwnedSnapshot: (
    principal: DashboardInsightsPrincipal
  ) => Promise<DashboardInsightsSnapshotRecord>
}

export class DashboardInsightsRepositoryUnavailableError extends Error {
  constructor(options: ErrorOptions) {
    super('Dashboard insights repository is unavailable.', options)
    this.name = 'DashboardInsightsRepositoryUnavailableError'
  }
}

export class DashboardInsightsRepositoryIntegrityError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DashboardInsightsRepositoryIntegrityError'
  }
}

export class DashboardInsightsPrincipalLostError extends Error {
  constructor(options?: ErrorOptions) {
    super('Dashboard insights principal is no longer active.', options)
    this.name = 'DashboardInsightsPrincipalLostError'
  }
}

const UNAVAILABLE_PRISMA_CODES = new Set(['P1001', 'P1002', 'P2024', 'P2034'])

const isDatabaseUnavailableError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientInitializationError ||
  (error instanceof Prisma.PrismaClientKnownRequestError &&
    UNAVAILABLE_PRISMA_CODES.has(error.code))

const executeRepositoryOperation = async <Result>(
  operation: () => Promise<Result>
): Promise<Result> => {
  try {
    return await operation()
  } catch (error: unknown) {
    if (isDatabaseUnavailableError(error)) {
      throw new DashboardInsightsRepositoryUnavailableError({ cause: error })
    }
    throw error
  }
}

export const createDashboardInsightsClockQuery = (
  principal: DashboardInsightsPrincipal
): Prisma.Sql => {
  const activePrincipal =
    principal.kind === 'PHASE7'
      ? Prisma.sql`
          SELECT resolved."userId", resolved."targetLevel"
          FROM "phase7_resolve_v1_principal"(${principal.sessionToken})
            AS resolved
          WHERE resolved."userId" = ${principal.userId}::uuid
        `
      : Prisma.sql`
          SELECT app_user."id" AS "userId", app_user."targetLevel"
          FROM "User" AS app_user
          WHERE app_user."id" = ${principal.userId}::uuid
            AND app_user."accountStatus" = 'ACTIVE'::"UserAccountStatus"
        `

  return Prisma.sql`
    WITH active_principal AS MATERIALIZED (
      ${activePrincipal}
    )
    SELECT
      CURRENT_TIMESTAMP AS "observedAt",
      active_principal."targetLevel"::text AS "targetLevel",
      (
        SELECT COUNT(*)::bigint
        FROM "StudySession" AS future_session
        JOIN "StudySessionQuestion" AS future_item
          ON future_item."studySessionId" = future_session."id"
        JOIN "StudyAnswer" AS future_answer
          ON future_answer."studySessionQuestionId" = future_item."id"
          AND future_answer."questionVersionId" = future_item."questionVersionId"
        WHERE future_session."userId" = ${principal.userId}::uuid
          AND future_session."status" = 'SUBMITTED'::"StudySessionStatus"
          AND future_answer."answeredAt" > CURRENT_TIMESTAMP
      ) AS "futureAnswerCount"
    FROM active_principal
  `
}

export const createDashboardInsightsNonTagQuery = (
  userId: string,
  fromInclusive: Date,
  observedAt: Date
): Prisma.Sql => Prisma.sql`
  WITH fact AS MATERIALIZED (
    SELECT
      item."questionId",
      item."questionVersionId",
      version."level",
      version."subject",
      version."questionType",
      answer."isCorrect",
      answer."elapsedSec",
      answer."answeredAt"
    FROM "StudySession" AS session
    JOIN "StudySessionQuestion" AS item
      ON item."studySessionId" = session."id"
    JOIN "StudyAnswer" AS answer
      ON answer."studySessionQuestionId" = item."id"
      AND answer."questionVersionId" = item."questionVersionId"
    JOIN "QuestionVersion" AS version
      ON version."questionId" = item."questionId"
      AND version."id" = item."questionVersionId"
    WHERE session."userId" = ${userId}::uuid
      AND session."status" = 'SUBMITTED'::"StudySessionStatus"
      AND answer."answeredAt" >= ${fromInclusive}
      AND answer."answeredAt" <= ${observedAt}
  ),
  subject_question AS MATERIALIZED (
    SELECT
      fact."level",
      fact."subject",
      fact."questionId",
      COUNT(*)::bigint AS "attemptedCount",
      COUNT(*) FILTER (WHERE fact."isCorrect" = false)::bigint
        AS "incorrectCount",
      MAX(fact."answeredAt") AS "lastAnsweredAt"
    FROM fact
    GROUP BY fact."level", fact."subject", fact."questionId"
  ),
  type_question AS MATERIALIZED (
    SELECT
      fact."level",
      fact."subject",
      fact."questionType",
      fact."questionId",
      COUNT(*)::bigint AS "attemptedCount",
      COUNT(*) FILTER (WHERE fact."isCorrect" = false)::bigint
        AS "incorrectCount",
      MAX(fact."answeredAt") AS "lastAnsweredAt"
    FROM fact
    GROUP BY
      fact."level",
      fact."subject",
      fact."questionType",
      fact."questionId"
  )
  SELECT
    'OVERALL'::text AS "kind",
    NULL::text AS "level",
    NULL::text AS "subject",
    NULL::text AS "questionType",
    COUNT(*)::bigint AS "attemptedCount",
    COUNT(*) FILTER (WHERE fact."isCorrect")::bigint AS "correctCount",
    COUNT(*) FILTER (WHERE NOT fact."isCorrect")::bigint
      AS "incorrectCount",
    COALESCE(SUM(fact."elapsedSec"), 0)::bigint AS "elapsedTotal",
    MAX(fact."answeredAt") AS "lastAnsweredAt",
    0::bigint AS "repeatExtra"
  FROM fact

  UNION ALL

  SELECT
    'LEVEL'::text,
    fact."level"::text,
    NULL::text,
    NULL::text,
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE fact."isCorrect")::bigint,
    COUNT(*) FILTER (WHERE NOT fact."isCorrect")::bigint,
    COALESCE(SUM(fact."elapsedSec"), 0)::bigint,
    MAX(fact."answeredAt"),
    0::bigint
  FROM fact
  GROUP BY fact."level"

  UNION ALL

  SELECT
    'SUBJECT'::text,
    NULL::text,
    fact."subject"::text,
    NULL::text,
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE fact."isCorrect")::bigint,
    COUNT(*) FILTER (WHERE NOT fact."isCorrect")::bigint,
    COALESCE(SUM(fact."elapsedSec"), 0)::bigint,
    MAX(fact."answeredAt"),
    0::bigint
  FROM fact
  GROUP BY fact."subject"

  UNION ALL

  SELECT
    'QUESTION_TYPE'::text,
    NULL::text,
    NULL::text,
    fact."questionType"::text,
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE fact."isCorrect")::bigint,
    COUNT(*) FILTER (WHERE NOT fact."isCorrect")::bigint,
    COALESCE(SUM(fact."elapsedSec"), 0)::bigint,
    MAX(fact."answeredAt"),
    0::bigint
  FROM fact
  GROUP BY fact."questionType"

  UNION ALL

  SELECT
    'SUBJECT_WEAKNESS'::text,
    subject_question."level"::text,
    subject_question."subject"::text,
    NULL::text,
    SUM(subject_question."attemptedCount")::bigint,
    (
      SUM(subject_question."attemptedCount") -
      SUM(subject_question."incorrectCount")
    )::bigint,
    SUM(subject_question."incorrectCount")::bigint,
    0::bigint,
    MAX(subject_question."lastAnsweredAt"),
    SUM(GREATEST(subject_question."incorrectCount" - 1, 0))::bigint
  FROM subject_question
  GROUP BY subject_question."level", subject_question."subject"

  UNION ALL

  SELECT
    'QUESTION_TYPE_WEAKNESS'::text,
    type_question."level"::text,
    type_question."subject"::text,
    type_question."questionType"::text,
    SUM(type_question."attemptedCount")::bigint,
    (
      SUM(type_question."attemptedCount") -
      SUM(type_question."incorrectCount")
    )::bigint,
    SUM(type_question."incorrectCount")::bigint,
    0::bigint,
    MAX(type_question."lastAnsweredAt"),
    SUM(GREATEST(type_question."incorrectCount" - 1, 0))::bigint
  FROM type_question
  GROUP BY
    type_question."level",
    type_question."subject",
    type_question."questionType"

  ORDER BY "kind", "level", "subject", "questionType"
`

export const createDashboardInsightsTagQuery = (
  userId: string,
  fromInclusive: Date,
  observedAt: Date
): Prisma.Sql => Prisma.sql`
  WITH tag_fact AS MATERIALIZED (
    SELECT
      answer."id" AS "answerId",
      item."questionId",
      item."questionVersionId",
      version."level",
      version."subject",
      version_tag."tagId",
      version_tag."labelSnapshot" AS "tagLabel",
      answer."isCorrect",
      answer."elapsedSec",
      answer."answeredAt"
    FROM "StudySession" AS session
    JOIN "StudySessionQuestion" AS item
      ON item."studySessionId" = session."id"
    JOIN "StudyAnswer" AS answer
      ON answer."studySessionQuestionId" = item."id"
      AND answer."questionVersionId" = item."questionVersionId"
    JOIN "QuestionVersion" AS version
      ON version."questionId" = item."questionId"
      AND version."id" = item."questionVersionId"
    JOIN "QuestionVersionTag" AS version_tag
      ON version_tag."questionVersionId" = item."questionVersionId"
    WHERE session."userId" = ${userId}::uuid
      AND session."status" = 'SUBMITTED'::"StudySessionStatus"
      AND answer."answeredAt" >= ${fromInclusive}
      AND answer."answeredAt" <= ${observedAt}
  ),
  global_label AS MATERIALIZED (
    SELECT DISTINCT ON (tag_fact."tagId")
      tag_fact."tagId",
      tag_fact."tagLabel"
    FROM tag_fact
    ORDER BY
      tag_fact."tagId",
      tag_fact."answeredAt" DESC,
      tag_fact."questionVersionId" ASC,
      tag_fact."answerId" ASC
  ),
  local_label AS MATERIALIZED (
    SELECT DISTINCT ON (
      tag_fact."level",
      tag_fact."subject",
      tag_fact."tagId"
    )
      tag_fact."level",
      tag_fact."subject",
      tag_fact."tagId",
      tag_fact."tagLabel"
    FROM tag_fact
    ORDER BY
      tag_fact."level",
      tag_fact."subject",
      tag_fact."tagId",
      tag_fact."answeredAt" DESC,
      tag_fact."questionVersionId" ASC,
      tag_fact."answerId" ASC
  ),
  tag_question AS MATERIALIZED (
    SELECT
      tag_fact."level",
      tag_fact."subject",
      tag_fact."tagId",
      tag_fact."questionId",
      COUNT(*)::bigint AS "attemptedCount",
      COUNT(*) FILTER (WHERE tag_fact."isCorrect" = false)::bigint
        AS "incorrectCount",
      MAX(tag_fact."answeredAt") AS "lastAnsweredAt"
    FROM tag_fact
    GROUP BY
      tag_fact."level",
      tag_fact."subject",
      tag_fact."tagId",
      tag_fact."questionId"
  )
  SELECT
    'TAG'::text AS "kind",
    NULL::text AS "level",
    NULL::text AS "subject",
    tag_fact."tagId",
    global_label."tagLabel",
    COUNT(*)::bigint AS "attemptedCount",
    COUNT(*) FILTER (WHERE tag_fact."isCorrect")::bigint AS "correctCount",
    COUNT(*) FILTER (WHERE NOT tag_fact."isCorrect")::bigint
      AS "incorrectCount",
    COALESCE(SUM(tag_fact."elapsedSec"), 0)::bigint AS "elapsedTotal",
    MAX(tag_fact."answeredAt") AS "lastAnsweredAt",
    0::bigint AS "repeatExtra"
  FROM tag_fact
  JOIN global_label USING ("tagId")
  GROUP BY tag_fact."tagId", global_label."tagLabel"

  UNION ALL

  SELECT
    'TAG_WEAKNESS'::text,
    tag_question."level"::text,
    tag_question."subject"::text,
    tag_question."tagId",
    local_label."tagLabel",
    SUM(tag_question."attemptedCount")::bigint,
    (
      SUM(tag_question."attemptedCount") -
      SUM(tag_question."incorrectCount")
    )::bigint,
    SUM(tag_question."incorrectCount")::bigint,
    0::bigint,
    MAX(tag_question."lastAnsweredAt"),
    SUM(GREATEST(tag_question."incorrectCount" - 1, 0))::bigint
  FROM tag_question
  JOIN local_label USING ("level", "subject", "tagId")
  GROUP BY
    tag_question."level",
    tag_question."subject",
    tag_question."tagId",
    local_label."tagLabel"

  ORDER BY "kind", "level", "subject", "tagId"
`

export const createDashboardInsightsReviewQuery = (
  userId: string,
  observedAt: Date
): Prisma.Sql => {
  const currentPredicate = createCurrentReviewCandidatePredicate({ userId })
  return Prisma.sql`
    WITH current_notes AS MATERIALIZED (
      SELECT
        note."questionId",
        note."wrongCount",
        note."status",
        note."lastWrongAt",
        schedule."nextReviewAt",
        version."level",
        version."subject",
        version."questionText"
      FROM "WrongNote" AS note
      JOIN "ReviewSchedule" AS schedule
        ON schedule."wrongNoteId" = note."id"
      JOIN "Question" AS question
        ON question."id" = note."questionId"
      JOIN "QuestionVersion" AS version
        ON version."questionId" = question."id"
        AND version."id" = question."currentPublishedVersionId"
      WHERE ${currentPredicate}
    ),
    queue_counts AS MATERIALIZED (
      SELECT
        COUNT(*) FILTER (
          WHERE current_notes."nextReviewAt" <= ${observedAt}
        )::bigint AS "dueCount",
        COUNT(*) FILTER (
          WHERE current_notes."wrongCount" >= 2
        )::bigint AS "repeatedCount"
      FROM current_notes
    ),
    due_groups AS MATERIALIZED (
      SELECT
        current_notes."level",
        current_notes."subject",
        COUNT(*)::bigint AS "dueCount",
        MIN(current_notes."nextReviewAt") AS "earliestDueAt"
      FROM current_notes
      WHERE current_notes."nextReviewAt" <= ${observedAt}
      GROUP BY current_notes."level", current_notes."subject"
    ),
    repeated_candidate AS MATERIALIZED (
      SELECT
        current_notes."questionId",
        current_notes."level",
        current_notes."subject",
        current_notes."questionText",
        current_notes."wrongCount",
        current_notes."status",
        current_notes."lastWrongAt"
      FROM current_notes
      WHERE current_notes."wrongCount" >= 2
        AND current_notes."status" IN (
          'NEW'::"WrongNoteStatus",
          'REVIEWING'::"WrongNoteStatus",
          'AGAIN'::"WrongNoteStatus"
        )
        AND current_notes."nextReviewAt" > ${observedAt}
      ORDER BY
        current_notes."wrongCount" DESC,
        current_notes."lastWrongAt" DESC,
        current_notes."questionId" ASC
      LIMIT 1
    ),
    ranked_sessions AS MATERIALIZED (
      SELECT
        session."id",
        session."level",
        session."subject",
        ROW_NUMBER() OVER (
          PARTITION BY session."level", session."subject"
          ORDER BY session."submittedAt" DESC, session."id" ASC
        ) AS "rank"
      FROM "StudySession" AS session
      WHERE session."userId" = ${userId}::uuid
        AND session."status" = 'SUBMITTED'::"StudySessionStatus"
        AND session."submittedAt" IS NOT NULL
    ),
    actionable_question AS MATERIALIZED (
      SELECT
        ranked."level",
        ranked."subject",
        item."questionId"
      FROM ranked_sessions AS ranked
      JOIN "StudySessionQuestion" AS item
        ON item."studySessionId" = ranked."id"
      JOIN "StudyAnswer" AS answer
        ON answer."studySessionQuestionId" = item."id"
        AND answer."questionVersionId" = item."questionVersionId"
      JOIN "Question" AS question
        ON question."id" = item."questionId"
      JOIN "QuestionVersion" AS version
        ON version."questionId" = question."id"
        AND version."id" = question."currentPublishedVersionId"
      WHERE ranked."rank" <= 10
        AND question."lifecycleStatus" = 'ACTIVE'
        AND version."status" = 'PUBLISHED'
        AND version."level" = ranked."level"
        AND version."subject" = ranked."subject"
      GROUP BY ranked."level", ranked."subject", item."questionId"
      HAVING COUNT(*) >= 3
        AND COUNT(*) FILTER (WHERE answer."isCorrect" = false) >= 1
    ),
    actionable_counts AS MATERIALIZED (
      SELECT
        actionable_question."level",
        actionable_question."subject",
        COUNT(*)::bigint AS "candidateCount"
      FROM actionable_question
      GROUP BY actionable_question."level", actionable_question."subject"
    )
    SELECT
      'COUNTS'::text AS "kind",
      NULL::text AS "level",
      NULL::text AS "subject",
      queue_counts."dueCount" AS "totalCount",
      queue_counts."repeatedCount",
      NULL::timestamptz AS "earliestDueAt",
      NULL::uuid AS "questionId",
      NULL::text AS "questionText",
      NULL::integer AS "wrongCount",
      NULL::"WrongNoteStatus" AS "status",
      NULL::timestamptz AS "lastWrongAt",
      NULL::boolean AS "isDue"
    FROM queue_counts

    UNION ALL

    SELECT
      'DUE_GROUP'::text,
      due_groups."level"::text,
      due_groups."subject"::text,
      due_groups."dueCount",
      NULL::bigint,
      due_groups."earliestDueAt",
      NULL::uuid,
      NULL::text,
      NULL::integer,
      NULL::"WrongNoteStatus",
      NULL::timestamptz,
      NULL::boolean
    FROM due_groups

    UNION ALL

    SELECT
      'REPEATED_CANDIDATE'::text,
      repeated_candidate."level"::text,
      repeated_candidate."subject"::text,
      1::bigint,
      NULL::bigint,
      NULL::timestamptz,
      repeated_candidate."questionId",
      repeated_candidate."questionText",
      repeated_candidate."wrongCount",
      repeated_candidate."status",
      repeated_candidate."lastWrongAt",
      false
    FROM repeated_candidate

    UNION ALL

    SELECT
      'WEAKNESS_ACTIONABLE'::text,
      actionable_counts."level"::text,
      actionable_counts."subject"::text,
      actionable_counts."candidateCount",
      NULL::bigint,
      NULL::timestamptz,
      NULL::uuid,
      NULL::text,
      NULL::integer,
      NULL::"WrongNoteStatus",
      NULL::timestamptz,
      NULL::boolean
    FROM actionable_counts

    ORDER BY "kind", "level", "subject", "questionId"
  `
}

export const createDashboardInsightsTargetQuery = (
  userId: string,
  targetLevel: JlptLevel | null,
  observedAt: Date
): Prisma.Sql => {
  const recentSince = new Date(observedAt.getTime() - 7 * 86_400_000)
  return Prisma.sql`
    WITH recent_sessions AS MATERIALIZED (
      SELECT session."id"
      FROM "StudySession" AS session
      WHERE session."userId" = ${userId}::uuid
        AND session."status" = 'SUBMITTED'::"StudySessionStatus"
        AND session."submittedAt" >= ${recentSince}
        AND session."submittedAt" <= ${observedAt}
      ORDER BY session."submittedAt" DESC, session."id" ASC
      LIMIT 3
    ),
    recent_questions AS MATERIALIZED (
      SELECT DISTINCT item."questionId"
      FROM recent_sessions AS recent
      JOIN "StudySessionQuestion" AS item
        ON item."studySessionId" = recent."id"
    ),
    target_catalog AS MATERIALIZED (
      SELECT
        version."level",
        version."subject",
        question."id" AS "questionId"
      FROM "Question" AS question
      JOIN "QuestionVersion" AS version
        ON version."questionId" = question."id"
        AND version."id" = question."currentPublishedVersionId"
      WHERE question."lifecycleStatus" = 'ACTIVE'
        AND version."status" = 'PUBLISHED'
        AND version."level" = ${targetLevel}::"JlptLevel"
    ),
    last_studied AS MATERIALIZED (
      SELECT
        session."subject",
        MAX(session."submittedAt") AS "lastStudiedAt"
      FROM "StudySession" AS session
      WHERE session."userId" = ${userId}::uuid
        AND session."status" = 'SUBMITTED'::"StudySessionStatus"
        AND session."submittedAt" IS NOT NULL
        AND session."submittedAt" <= ${observedAt}
        AND session."level" = ${targetLevel}::"JlptLevel"
      GROUP BY session."subject"
    )
    SELECT
      target_catalog."level"::text AS "level",
      target_catalog."subject"::text AS "subject",
      COUNT(*)::bigint AS "catalogCount",
      COUNT(*) FILTER (
        WHERE recent_questions."questionId" IS NULL
      )::bigint AS "nonRecentCount",
      last_studied."lastStudiedAt"
    FROM target_catalog
    LEFT JOIN recent_questions
      ON recent_questions."questionId" = target_catalog."questionId"
    LEFT JOIN last_studied
      ON last_studied."subject" = target_catalog."subject"
    GROUP BY
      target_catalog."level",
      target_catalog."subject",
      last_studied."lastStudiedAt"
    ORDER BY target_catalog."subject"
  `
}

export const createPrismaDashboardInsightsRepository = (
  client: PrismaClient,
  authority: DashboardInsightsPrincipal['kind']
): DashboardInsightsRepository => ({
  readOwnedSnapshot: (principal) =>
    executeRepositoryOperation(async () =>
      client.$transaction(
        async (transaction) => {
          if (principal.kind !== authority) {
            throw new DashboardInsightsPrincipalLostError()
          }
          await transaction.$executeRaw`SET TRANSACTION READ ONLY`
          const clockRows = await transaction.$queryRaw<
            DashboardInsightsClockRecord[]
          >(createDashboardInsightsClockQuery(principal))
          const clock = clockRows[0]
          if (clockRows.length !== 1 || !clock) {
            throw new DashboardInsightsPrincipalLostError()
          }
          if (clock.futureAnswerCount !== 0n) {
            throw new DashboardInsightsRepositoryIntegrityError(
              'Dashboard insights found a future StudyAnswer.'
            )
          }
          const fromInclusive = new Date(
            clock.observedAt.getTime() - 90 * 86_400_000
          )
          const nonTagRows = await transaction.$queryRaw<
            DashboardInsightsNonTagRecord[]
          >(
            createDashboardInsightsNonTagQuery(
              principal.userId,
              fromInclusive,
              clock.observedAt
            )
          )
          const tagRows = await transaction.$queryRaw<
            DashboardInsightsTagRecord[]
          >(
            createDashboardInsightsTagQuery(
              principal.userId,
              fromInclusive,
              clock.observedAt
            )
          )
          const reviewRows = await transaction.$queryRaw<
            DashboardInsightsReviewRecord[]
          >(
            createDashboardInsightsReviewQuery(
              principal.userId,
              clock.observedAt
            )
          )
          const targetRows = await transaction.$queryRaw<
            DashboardInsightsTargetRecord[]
          >(
            createDashboardInsightsTargetQuery(
              principal.userId,
              clock.targetLevel,
              clock.observedAt
            )
          )
          return { clock, nonTagRows, tagRows, reviewRows, targetRows }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
      )
    )
})
