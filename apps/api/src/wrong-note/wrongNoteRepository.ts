import type {
  ParsedListWrongNotesQuery,
  WrongNoteSummary
} from '@nihongo/contracts/wrong-note/list-wrong-notes'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'

export interface HistoricalQuestionTagRecord {
  readonly id: string
  readonly label: string
}

export interface HistoricalQuestionOptionRecord {
  readonly id: string
  readonly label: string
  readonly text: string
}

export interface HistoricalQuestionSummaryRecord {
  readonly id: string
  readonly level: WrongNoteSummary['level']
  readonly questionText: string
  readonly questionType: WrongNoteSummary['questionType']
  readonly questionVersionId: string
  readonly subject: WrongNoteSummary['subject']
  readonly tags: readonly HistoricalQuestionTagRecord[]
}

export interface HistoricalReviewedQuestionRecord
  extends HistoricalQuestionSummaryRecord {
  readonly correctOptionId: string | null
  readonly difficulty: 'EASY' | 'NORMAL' | 'HARD'
  readonly explanationJa: string | null
  readonly explanationKo: string
  readonly options: readonly HistoricalQuestionOptionRecord[]
  readonly passage: string | null
}

export interface WrongNoteReadRecord {
  readonly correctStreak: number
  readonly currentPublishedVersionStatus:
    | 'DRAFT'
    | 'PUBLISHED'
    | 'RETIRED'
    | null
  readonly currentReviewQuestionVersionId: string | null
  readonly id: string
  readonly lastReviewedAt: Date | null
  readonly lastWrongAt: Date
  readonly nextReviewAt: Date | null
  readonly questionLifecycleStatus: 'ACTIVE' | 'ARCHIVED'
  readonly question: HistoricalQuestionSummaryRecord
  readonly questionId: string
  readonly status: WrongNoteSummary['status']
  readonly wrongCount: number
}

export interface WrongNoteDetailRecord
  extends Omit<WrongNoteReadRecord, 'question'> {
  readonly question: HistoricalReviewedQuestionRecord
}

export interface ListOwnedWrongNotesInput extends ParsedListWrongNotesQuery {
  readonly userId: string
}

export interface ListOwnedWrongNotesResult {
  readonly availableTagLabels: readonly string[]
  readonly items: readonly WrongNoteReadRecord[]
  readonly total: number
}

interface AvailableTagLabelRow {
  readonly label: string
}

export interface WrongNoteRepository {
  findOwnedDetail: (
    userId: string,
    questionId: string
  ) => Promise<WrongNoteDetailRecord | null>
  listOwned: (
    input: ListOwnedWrongNotesInput
  ) => Promise<ListOwnedWrongNotesResult>
}

export class WrongNoteRepositoryUnavailableError extends Error {
  constructor(options: ErrorOptions) {
    super('WrongNote repository is unavailable.', options)
    this.name = 'WrongNoteRepositoryUnavailableError'
  }
}

export class WrongNoteRepositoryIntegrityError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'WrongNoteRepositoryIntegrityError'
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
      throw new WrongNoteRepositoryUnavailableError({ cause: error })
    }
    throw error
  }
}

const summarySelect = {
  id: true,
  questionId: true,
  currentReviewQuestionVersionId: true,
  wrongCount: true,
  correctStreak: true,
  status: true,
  lastWrongAt: true,
  lastReviewedAt: true,
  schedule: { select: { nextReviewAt: true } },
  question: {
    select: {
      lifecycleStatus: true,
      currentPublishedVersion: { select: { status: true } }
    }
  },
  lastWrongQuestionVersion: {
    select: {
      id: true,
      level: true,
      subject: true,
      questionType: true,
      questionText: true,
      tags: {
        orderBy: [{ labelSnapshot: 'asc' }, { tagId: 'asc' }],
        select: { tagId: true, labelSnapshot: true }
      }
    }
  }
} satisfies Prisma.WrongNoteSelect

const detailSelect = {
  id: true,
  questionId: true,
  currentReviewQuestionVersionId: true,
  wrongCount: true,
  correctStreak: true,
  status: true,
  lastWrongAt: true,
  lastReviewedAt: true,
  schedule: { select: { nextReviewAt: true } },
  question: {
    select: {
      lifecycleStatus: true,
      currentPublishedVersion: { select: { status: true } }
    }
  },
  lastWrongQuestionVersion: {
    select: {
      id: true,
      level: true,
      subject: true,
      questionType: true,
      passage: true,
      questionText: true,
      correctOptionId: true,
      explanationKo: true,
      explanationJa: true,
      difficulty: true,
      options: {
        orderBy: { ordinal: 'asc' },
        select: { id: true, label: true, text: true }
      },
      tags: {
        orderBy: [{ labelSnapshot: 'asc' }, { tagId: 'asc' }],
        select: { tagId: true, labelSnapshot: true }
      }
    }
  }
} satisfies Prisma.WrongNoteSelect

type WrongNoteSummaryRow = Prisma.WrongNoteGetPayload<{
  select: typeof summarySelect
}>
type WrongNoteDetailRow = Prisma.WrongNoteGetPayload<{
  select: typeof detailSelect
}>

const toTags = (
  tags: readonly { readonly labelSnapshot: string; readonly tagId: string }[]
): readonly HistoricalQuestionTagRecord[] =>
  tags.map(({ labelSnapshot, tagId }) => ({
    id: tagId,
    label: labelSnapshot
  }))

const toSummaryRecord = (row: WrongNoteSummaryRow): WrongNoteReadRecord => ({
  id: row.id,
  questionId: row.questionId,
  currentReviewQuestionVersionId: row.currentReviewQuestionVersionId,
  wrongCount: row.wrongCount,
  correctStreak: row.correctStreak,
  status: row.status,
  lastWrongAt: row.lastWrongAt,
  lastReviewedAt: row.lastReviewedAt,
  nextReviewAt: row.schedule?.nextReviewAt ?? null,
  questionLifecycleStatus: row.question.lifecycleStatus,
  currentPublishedVersionStatus:
    row.question.currentPublishedVersion?.status ?? null,
  question: {
    id: row.questionId,
    questionVersionId: row.lastWrongQuestionVersion.id,
    level: row.lastWrongQuestionVersion.level,
    subject: row.lastWrongQuestionVersion.subject,
    questionType: row.lastWrongQuestionVersion.questionType,
    questionText: row.lastWrongQuestionVersion.questionText,
    tags: toTags(row.lastWrongQuestionVersion.tags)
  }
})

const toDetailRecord = (row: WrongNoteDetailRow): WrongNoteDetailRecord => ({
  id: row.id,
  questionId: row.questionId,
  currentReviewQuestionVersionId: row.currentReviewQuestionVersionId,
  wrongCount: row.wrongCount,
  correctStreak: row.correctStreak,
  status: row.status,
  lastWrongAt: row.lastWrongAt,
  lastReviewedAt: row.lastReviewedAt,
  nextReviewAt: row.schedule?.nextReviewAt ?? null,
  questionLifecycleStatus: row.question.lifecycleStatus,
  currentPublishedVersionStatus:
    row.question.currentPublishedVersion?.status ?? null,
  question: {
    id: row.questionId,
    questionVersionId: row.lastWrongQuestionVersion.id,
    level: row.lastWrongQuestionVersion.level,
    subject: row.lastWrongQuestionVersion.subject,
    questionType: row.lastWrongQuestionVersion.questionType,
    passage: row.lastWrongQuestionVersion.passage,
    questionText: row.lastWrongQuestionVersion.questionText,
    correctOptionId: row.lastWrongQuestionVersion.correctOptionId,
    explanationKo: row.lastWrongQuestionVersion.explanationKo,
    explanationJa: row.lastWrongQuestionVersion.explanationJa,
    difficulty: row.lastWrongQuestionVersion.difficulty,
    options: row.lastWrongQuestionVersion.options,
    tags: toTags(row.lastWrongQuestionVersion.tags)
  }
})

const toOrderBy = (
  sort: ParsedListWrongNotesQuery['sort']
): Prisma.WrongNoteOrderByWithRelationInput[] => {
  switch (sort) {
    case 'MOST_WRONG':
      return [{ wrongCount: 'desc' }, { lastWrongAt: 'desc' }, { id: 'asc' }]
    case 'OLDEST':
      return [{ lastWrongAt: 'asc' }, { id: 'asc' }]
    case 'RECENT':
      return [{ lastWrongAt: 'desc' }, { id: 'asc' }]
  }
}

const toBaseWhere = (
  input: ListOwnedWrongNotesInput
): Prisma.WrongNoteWhereInput => {
  const versionFilter: Prisma.QuestionVersionWhereInput = {
    ...(input.level ? { level: input.level } : {}),
    ...(input.subject ? { subject: input.subject } : {}),
    ...(input.tag ? { tags: { some: { labelSnapshot: input.tag } } } : {})
  }

  return {
    userId: input.userId,
    ...(input.status ? { status: input.status } : {}),
    ...(Object.keys(versionFilter).length > 0
      ? { lastWrongQuestionVersion: versionFilter }
      : {})
  }
}

const runReadOnlySnapshot = async <Result>(
  client: PrismaClient,
  operation: (transaction: Prisma.TransactionClient) => Promise<Result>
): Promise<Result> =>
  client.$transaction(
    async (transaction) => {
      await transaction.$executeRaw`SET TRANSACTION READ ONLY`
      return await operation(transaction)
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
  )

const assertSafeTotal = (total: number): number => {
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new WrongNoteRepositoryIntegrityError(
      'WrongNote pagination total exceeds the safe integer range.'
    )
  }
  return total
}

export const createPrismaWrongNoteRepository = (
  client: PrismaClient
): WrongNoteRepository => ({
  findOwnedDetail: (userId, questionId) =>
    executeRepositoryOperation(async () =>
      runReadOnlySnapshot(client, async (transaction) => {
        const row = await transaction.wrongNote.findFirst({
          where: { userId, questionId },
          select: detailSelect
        })
        return row ? toDetailRecord(row) : null
      })
    ),
  listOwned: (input) =>
    executeRepositoryOperation(async () =>
      runReadOnlySnapshot(client, async (transaction) => {
        const where = toBaseWhere(input)
        const total = assertSafeTotal(
          await transaction.wrongNote.count({ where })
        )
        const offset = (BigInt(input.page) - 1n) * BigInt(input.pageSize)
        const rows =
          offset >= BigInt(total)
            ? []
            : await transaction.wrongNote.findMany({
                where,
                orderBy: toOrderBy(input.sort),
                skip: Number(offset),
                take: input.pageSize,
                select: summarySelect
              })
        const tagRows = await transaction.$queryRaw<AvailableTagLabelRow[]>(
          Prisma.sql`
            SELECT DISTINCT version_tag."labelSnapshot" AS "label"
            FROM "WrongNote" AS note
            JOIN "QuestionVersionTag" AS version_tag
              ON version_tag."questionVersionId" =
                note."lastWrongQuestionVersionId"
            WHERE note."userId" = ${input.userId}::uuid`
        )

        return {
          items: rows.map(toSummaryRecord),
          total,
          availableTagLabels: tagRows.map(({ label }) => label)
        }
      })
    )
})
