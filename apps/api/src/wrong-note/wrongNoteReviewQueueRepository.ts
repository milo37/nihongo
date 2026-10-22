import type {
  ParsedListReviewQueueQuery,
  ReviewQueueCounts,
  ReviewQueueItem
} from '@nihongo/contracts/wrong-note/list-review-queue'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import {
  createCurrentReviewCandidatePredicate,
  createReviewQueueOrder,
  createReviewQueueViewCondition,
  type CurrentReviewCandidateFilter
} from '../review/currentReviewCandidateQuery.js'

export interface ReviewQueueRecord
  extends Omit<
    ReviewQueueItem,
    | 'currentQuestionVersionId'
    | 'lastReviewedAt'
    | 'lastWrongAt'
    | 'nextReviewAt'
  > {
  readonly currentQuestionVersionId: string
  readonly lastReviewedAt: Date | null
  readonly lastWrongAt: Date
  readonly nextReviewAt: Date
}

export interface ListOwnedReviewQueueResult {
  readonly availableTags: readonly string[]
  readonly counts: ReviewQueueCounts
  readonly items: readonly ReviewQueueRecord[]
  readonly observedAt: Date
  readonly total: number
}

export interface ListOwnedReviewQueueInput extends ParsedListReviewQueueQuery {
  readonly observedAt?: Date
  readonly userId: string
}

type ResolvedListOwnedReviewQueueInput = ListOwnedReviewQueueInput & {
  readonly observedAt: Date
}

export interface WrongNoteReviewQueueRepository {
  listOwned: (
    input: ListOwnedReviewQueueInput
  ) => Promise<ListOwnedReviewQueueResult>
}

export class WrongNoteReviewQueueRepositoryUnavailableError extends Error {
  constructor(options: ErrorOptions) {
    super('WrongNote review queue repository is unavailable.', options)
    this.name = 'WrongNoteReviewQueueRepositoryUnavailableError'
  }
}

export class WrongNoteReviewQueueRepositoryIntegrityError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'WrongNoteReviewQueueRepositoryIntegrityError'
  }
}

interface ReviewQueueCountRow {
  readonly due: bigint
  readonly repeated: bigint
  readonly selectedTotal: bigint
  readonly solved: bigint
  readonly unreviewed: bigint
}

interface ReviewQueueTagRow {
  readonly label: string
}

interface ReviewQueueRow {
  readonly correctStreak: number
  readonly currentQuestionVersionId: string
  readonly hasMemo: boolean
  readonly lastReviewedAt: Date | null
  readonly lastWrongAt: Date
  readonly level: ReviewQueueItem['level']
  readonly nextReviewAt: Date
  readonly questionId: string
  readonly questionPreview: string
  readonly questionType: ReviewQueueItem['questionType']
  readonly status: ReviewQueueItem['status']
  readonly subject: ReviewQueueItem['subject']
  readonly tags: string[]
  readonly wrongCount: number
}

interface WrongNoteReviewQueueRepositoryOptions {
  readonly afterCountsLoaded?: () => Promise<void>
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
      throw new WrongNoteReviewQueueRepositoryUnavailableError({
        cause: error
      })
    }
    throw error
  }
}

const toSafeCount = (value: bigint, field: string): number => {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new WrongNoteReviewQueueRepositoryIntegrityError(
      `Review queue ${field} exceeds the safe integer range.`
    )
  }
  return Number(value)
}

const toBaseFilter = (
  input: ResolvedListOwnedReviewQueueInput,
  includeTag = true
): CurrentReviewCandidateFilter => ({
  userId: input.userId,
  ...(input.level ? { level: input.level } : {}),
  ...(input.subject ? { subject: input.subject } : {}),
  ...(input.questionType ? { questionType: input.questionType } : {}),
  ...(includeTag && input.tag ? { tag: input.tag } : {})
})

export const createReviewQueueCountsQuery = (
  input: ResolvedListOwnedReviewQueueInput
): Prisma.Sql => {
  const basePredicate = createCurrentReviewCandidatePredicate(
    toBaseFilter(input)
  )
  const selectedView = createReviewQueueViewCondition(
    input.view,
    input.observedAt
  )

  return Prisma.sql`
    SELECT
      COUNT(*) FILTER (
        WHERE schedule."nextReviewAt" <= ${input.observedAt}
      )::bigint AS "due",
      COUNT(*) FILTER (
        WHERE note."lastReviewedAt" IS NULL
      )::bigint AS "unreviewed",
      COUNT(*) FILTER (
        WHERE note."wrongCount" >= 2
      )::bigint AS "repeated",
      COUNT(*) FILTER (
        WHERE note."status" = 'SOLVED'
      )::bigint AS "solved",
      COUNT(*) FILTER (WHERE ${selectedView})::bigint AS "selectedTotal"
    FROM "WrongNote" AS note
    JOIN "ReviewSchedule" AS schedule
      ON schedule."wrongNoteId" = note."id"
    JOIN "Question" AS question
      ON question."id" = note."questionId"
    JOIN "QuestionVersion" AS version
      ON version."questionId" = question."id"
      AND version."id" = question."currentPublishedVersionId"
    WHERE ${basePredicate}
  `
}

export const createReviewQueueAvailableTagsQuery = (
  input: ResolvedListOwnedReviewQueueInput
): Prisma.Sql => {
  const basePredicate = createCurrentReviewCandidatePredicate(
    toBaseFilter(input, false)
  )

  return Prisma.sql`
    SELECT DISTINCT
      version_tag."labelSnapshot" COLLATE "C" AS "label"
    FROM "WrongNote" AS note
    JOIN "ReviewSchedule" AS schedule
      ON schedule."wrongNoteId" = note."id"
    JOIN "Question" AS question
      ON question."id" = note."questionId"
    JOIN "QuestionVersion" AS version
      ON version."questionId" = question."id"
      AND version."id" = question."currentPublishedVersionId"
    JOIN "QuestionVersionTag" AS version_tag
      ON version_tag."questionVersionId" = version."id"
    WHERE ${basePredicate}
    ORDER BY "label" ASC
  `
}

export const createReviewQueueItemsQuery = (
  input: ResolvedListOwnedReviewQueueInput,
  offset: number
): Prisma.Sql => {
  const basePredicate = createCurrentReviewCandidatePredicate(
    toBaseFilter(input)
  )
  const selectedView = createReviewQueueViewCondition(
    input.view,
    input.observedAt
  )
  const order = createReviewQueueOrder(input.sort)

  return Prisma.sql`
    SELECT
      note."questionId",
      version."id" AS "currentQuestionVersionId",
      version."level"::text AS "level",
      version."subject"::text AS "subject",
      version."questionType"::text AS "questionType",
      version."questionText" AS "questionPreview",
      note."status"::text AS "status",
      note."wrongCount",
      note."correctStreak",
      note."lastWrongAt",
      note."lastReviewedAt",
      schedule."nextReviewAt",
      EXISTS (
        SELECT 1
        FROM "UserMemo" AS memo
        WHERE memo."wrongNoteId" = note."id"
      ) AS "hasMemo",
      ARRAY(
        SELECT labels."label"
        FROM (
          SELECT DISTINCT item_tag."labelSnapshot" AS "label"
          FROM "QuestionVersionTag" AS item_tag
          WHERE item_tag."questionVersionId" = version."id"
        ) AS labels
        ORDER BY labels."label" COLLATE "C" ASC
      ) AS "tags"
    FROM "WrongNote" AS note
    JOIN "ReviewSchedule" AS schedule
      ON schedule."wrongNoteId" = note."id"
    JOIN "Question" AS question
      ON question."id" = note."questionId"
    JOIN "QuestionVersion" AS version
      ON version."questionId" = question."id"
      AND version."id" = question."currentPublishedVersionId"
    WHERE ${basePredicate}
      AND ${selectedView}
    ORDER BY ${order}
    OFFSET ${offset}
    LIMIT ${input.pageSize}
  `
}

const toRecord = (row: ReviewQueueRow): ReviewQueueRecord => ({
  questionId: row.questionId,
  currentQuestionVersionId: row.currentQuestionVersionId,
  level: row.level,
  subject: row.subject,
  questionType: row.questionType,
  questionPreview: row.questionPreview,
  tags: row.tags,
  status: row.status,
  wrongCount: row.wrongCount,
  correctStreak: row.correctStreak,
  lastWrongAt: row.lastWrongAt,
  lastReviewedAt: row.lastReviewedAt,
  nextReviewAt: row.nextReviewAt,
  hasMemo: row.hasMemo
})

export const createPrismaWrongNoteReviewQueueRepository = (
  client: PrismaClient,
  { afterCountsLoaded }: WrongNoteReviewQueueRepositoryOptions = {}
): WrongNoteReviewQueueRepository => ({
  listOwned: (input) =>
    executeRepositoryOperation(async () =>
      client.$transaction(
        async (transaction) => {
          await transaction.$executeRaw`SET TRANSACTION READ ONLY`
          const observedRows = input.observedAt
            ? await transaction.$queryRaw<Array<{ observedAt: Date }>>`
                SELECT ${input.observedAt}::timestamptz AS "observedAt"
              `
            : await transaction.$queryRaw<Array<{ observedAt: Date }>>`
                SELECT CURRENT_TIMESTAMP AS "observedAt"
              `
          const observedAt = observedRows[0]?.observedAt
          if (!observedAt || observedRows.length !== 1) {
            throw new WrongNoteReviewQueueRepositoryIntegrityError(
              'Review queue snapshot clock returned an invalid cardinality.'
            )
          }
          const snapshotInput: ResolvedListOwnedReviewQueueInput = {
            ...input,
            observedAt
          }
          const countRows = await transaction.$queryRaw<ReviewQueueCountRow[]>(
            createReviewQueueCountsQuery(snapshotInput)
          )
          const countRow = countRows[0]
          if (!countRow || countRows.length !== 1) {
            throw new WrongNoteReviewQueueRepositoryIntegrityError(
              'Review queue count query returned an invalid cardinality.'
            )
          }
          const counts = {
            due: toSafeCount(countRow.due, 'due count'),
            unreviewed: toSafeCount(countRow.unreviewed, 'unreviewed count'),
            repeated: toSafeCount(countRow.repeated, 'repeated count'),
            solved: toSafeCount(countRow.solved, 'solved count')
          }
          const total = toSafeCount(countRow.selectedTotal, 'total')
          await afterCountsLoaded?.()

          const tagRows = await transaction.$queryRaw<ReviewQueueTagRow[]>(
            createReviewQueueAvailableTagsQuery(snapshotInput)
          )
          const offset = (BigInt(input.page) - 1n) * BigInt(input.pageSize)
          const itemRows =
            offset >= BigInt(total)
              ? []
              : await transaction.$queryRaw<ReviewQueueRow[]>(
                  createReviewQueueItemsQuery(snapshotInput, Number(offset))
                )

          return {
            counts,
            total,
            observedAt,
            availableTags: tagRows.map(({ label }) => label),
            items: itemRows.map(toRecord)
          }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
      )
    )
})
