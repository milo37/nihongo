import type { WrongNoteSummary } from '@nihongo/contracts/wrong-note/list-wrong-notes'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'

interface HistoricalQuestionTagRecord {
  readonly id: string
  readonly label: string
  readonly labelJa: string | null
}

interface HistoricalQuestionOptionRecord {
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

export interface WrongNoteRepository {
  findOwnedDetail: (
    userId: string,
    questionId: string
  ) => Promise<WrongNoteDetailRecord | null>
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
type WrongNoteDetailVersionRow = Prisma.QuestionVersionGetPayload<{
  select: typeof detailVersionSelect
}>

const toTags = (
  tags: readonly {
    readonly tag: {
      readonly label: string
      readonly labelJa: string | null
    }
    readonly tagId: string
  }[]
): readonly HistoricalQuestionTagRecord[] =>
  tags.map(({ tag, tagId }) => ({
    id: tagId,
    label: tag.label,
    labelJa: tag.labelJa
  }))

const toDetailRecord = (
  row: WrongNoteBaseRow,
  question: QuestionAvailabilityRow,
  version: WrongNoteDetailVersionRow,
  tags: readonly {
    readonly tag: {
      readonly label: string
      readonly labelJa: string | null
    }
    readonly tagId: string
  }[]
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
          orderBy: [{ tag: { label: 'asc' } }, { tagId: 'asc' }],
          select: {
            tagId: true,
            tag: { select: { label: true, labelJa: true } }
          }
        })
        if (!question || !version) {
          throw new WrongNoteRepositoryIntegrityError(
            'WrongNote references a missing question projection.'
          )
        }
        return toDetailRecord(row, question, version, tags)
      })
    )
})
