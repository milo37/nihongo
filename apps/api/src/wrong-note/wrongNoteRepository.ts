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
    | 'IN_REVIEW'
    | 'CHANGES_REQUESTED'
    | 'APPROVED'
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

const wrongNoteBaseSelect = {
  id: true,
  questionId: true,
  lastWrongQuestionVersionId: true,
  currentReviewQuestionVersionId: true,
  wrongCount: true,
  correctStreak: true,
  status: true,
  lastWrongAt: true,
  lastReviewedAt: true,
  schedule: { select: { nextReviewAt: true } }
} satisfies Prisma.WrongNoteSelect

const questionAvailabilitySelect = {
  id: true,
  lifecycleStatus: true,
  currentPublishedVersion: { select: { status: true } }
} satisfies Prisma.QuestionSelect

const summaryVersionSelect = {
  id: true,
  level: true,
  subject: true,
  questionType: true,
  questionText: true,
  tags: {
    orderBy: [{ labelSnapshot: 'asc' }, { tagId: 'asc' }],
    select: { tagId: true, labelSnapshot: true }
  }
} satisfies Prisma.QuestionVersionSelect

const detailVersionSelect = {
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
  }
} satisfies Prisma.QuestionVersionSelect

type WrongNoteBaseRow = Prisma.WrongNoteGetPayload<{
  select: typeof wrongNoteBaseSelect
}>
type QuestionAvailabilityRow = Prisma.QuestionGetPayload<{
  select: typeof questionAvailabilitySelect
}>
type WrongNoteSummaryVersionRow = Prisma.QuestionVersionGetPayload<{
  select: typeof summaryVersionSelect
}>
type WrongNoteDetailVersionRow = Prisma.QuestionVersionGetPayload<{
  select: typeof detailVersionSelect
}>

const toTags = (
  tags: readonly { readonly labelSnapshot: string; readonly tagId: string }[]
): readonly HistoricalQuestionTagRecord[] =>
  tags.map(({ labelSnapshot, tagId }) => ({
    id: tagId,
    label: labelSnapshot
  }))

const toSummaryRecord = (
  row: WrongNoteBaseRow,
  question: QuestionAvailabilityRow,
  version: WrongNoteSummaryVersionRow
): WrongNoteReadRecord => ({
  id: row.id,
  questionId: row.questionId,
  currentReviewQuestionVersionId: row.currentReviewQuestionVersionId,
  wrongCount: row.wrongCount,
  correctStreak: row.correctStreak,
  status: row.status,
  lastWrongAt: row.lastWrongAt,
  lastReviewedAt: row.lastReviewedAt,
  nextReviewAt: row.schedule?.nextReviewAt ?? null,
  questionLifecycleStatus: question.lifecycleStatus,
  currentPublishedVersionStatus:
    question.currentPublishedVersion?.status ?? null,
  question: {
    id: row.questionId,
    questionVersionId: version.id,
    level: version.level,
    subject: version.subject,
    questionType: version.questionType,
    questionText: version.questionText,
    tags: toTags(version.tags)
  }
})

const toDetailRecord = (
  row: WrongNoteBaseRow,
  question: QuestionAvailabilityRow,
  version: WrongNoteDetailVersionRow,
  tags: readonly { readonly labelSnapshot: string; readonly tagId: string }[]
): WrongNoteDetailRecord => ({
  id: row.id,
  questionId: row.questionId,
  currentReviewQuestionVersionId: row.currentReviewQuestionVersionId,
  wrongCount: row.wrongCount,
  correctStreak: row.correctStreak,
  status: row.status,
  lastWrongAt: row.lastWrongAt,
  lastReviewedAt: row.lastReviewedAt,
  nextReviewAt: row.schedule?.nextReviewAt ?? null,
  questionLifecycleStatus: question.lifecycleStatus,
  currentPublishedVersionStatus:
    question.currentPublishedVersion?.status ?? null,
  question: {
    id: row.questionId,
    questionVersionId: version.id,
    level: version.level,
    subject: version.subject,
    questionType: version.questionType,
    passage: version.passage,
    questionText: version.questionText,
    correctOptionId: version.correctOptionId,
    explanationKo: version.explanationKo,
    explanationJa: version.explanationJa,
    difficulty: version.difficulty,
    options: version.options,
    tags: toTags(tags)
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
          select: wrongNoteBaseSelect
        })
        if (!row) {
          return null
        }
        const question = await transaction.question.findUnique({
          where: { id: row.questionId },
          select: questionAvailabilitySelect
        })
        const version = await transaction.questionVersion.findUnique({
          where: { id: row.lastWrongQuestionVersionId },
          select: detailVersionSelect
        })
        const tags = await transaction.questionVersionTag.findMany({
          where: { questionVersionId: row.lastWrongQuestionVersionId },
          orderBy: [{ labelSnapshot: 'asc' }, { tagId: 'asc' }],
          select: { tagId: true, labelSnapshot: true }
        })
        if (!question || !version) {
          throw new WrongNoteRepositoryIntegrityError(
            'WrongNote references a missing question projection.'
          )
        }
        return toDetailRecord(row, question, version, tags)
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
                select: wrongNoteBaseSelect
              })
        const questionIds = rows.map(({ questionId }) => questionId)
        const versionIds = rows.map(
          ({ lastWrongQuestionVersionId }) => lastWrongQuestionVersionId
        )
        const questions =
          questionIds.length === 0
            ? []
            : await transaction.question.findMany({
                where: { id: { in: questionIds } },
                select: questionAvailabilitySelect
              })
        const versions =
          versionIds.length === 0
            ? []
            : await transaction.questionVersion.findMany({
                where: { id: { in: versionIds } },
                select: summaryVersionSelect
              })
        const questionsById = new Map(
          questions.map((question) => [question.id, question])
        )
        const versionsById = new Map(
          versions.map((version) => [version.id, version])
        )
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
          items: rows.map((row) => {
            const question = questionsById.get(row.questionId)
            const version = versionsById.get(row.lastWrongQuestionVersionId)
            if (!question || !version) {
              throw new WrongNoteRepositoryIntegrityError(
                'WrongNote references a missing question projection.'
              )
            }
            return toSummaryRecord(row, question, version)
          }),
          total,
          availableTagLabels: tagRows.map(({ label }) => label)
        }
      })
    )
})
