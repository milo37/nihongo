import type { ParsedListBookmarksQuery } from '@nihongo/contracts/bookmark/list-bookmarks'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import type { PublishedQuestionSummaryRecord } from '../question/questionRepository.js'

export interface BookmarkReadRecord {
  readonly availability: 'AVAILABLE' | 'ARCHIVED'
  readonly createdAt: Date
  readonly id: string
  readonly question: PublishedQuestionSummaryRecord
  readonly questionId: string
}

export interface CreateOwnedBookmarkInput {
  readonly createdAt: Date
  readonly id: string
  readonly questionId: string
  readonly userId: string
}

export interface ListOwnedBookmarksInput extends ParsedListBookmarksQuery {
  readonly userId: string
}

export interface BookmarkRepository {
  createOwned: (input: CreateOwnedBookmarkInput) => Promise<{
    bookmark: BookmarkReadRecord
    created: boolean
  }>
  deleteOwned: (userId: string, questionId: string) => Promise<void>
  listOwned: (input: ListOwnedBookmarksInput) => Promise<{
    items: readonly BookmarkReadRecord[]
    total: number
  }>
}

export class BookmarkQuestionNotFoundError extends Error {
  constructor() {
    super('Bookmark question does not exist.')
    this.name = 'BookmarkQuestionNotFoundError'
  }
}

export class BookmarkQuestionNotAvailableError extends Error {
  constructor() {
    super('Bookmark question is not available.')
    this.name = 'BookmarkQuestionNotAvailableError'
  }
}

export class BookmarkRepositoryUnavailableError extends Error {
  constructor(options: ErrorOptions) {
    super('Bookmark repository is unavailable.', options)
    this.name = 'BookmarkRepositoryUnavailableError'
  }
}

export class BookmarkRepositoryIntegrityError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'BookmarkRepositoryIntegrityError'
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
      throw new BookmarkRepositoryUnavailableError({ cause: error })
    }
    throw error
  }
}

const assertSafeTotal = (total: number): number => {
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new BookmarkRepositoryIntegrityError(
      'Bookmark pagination total exceeds the safe integer range.'
    )
  }
  return total
}

const versionSummarySelect = {
  id: true,
  level: true,
  subject: true,
  questionType: true,
  difficulty: true,
  questionText: true,
  status: true,
  tags: {
    orderBy: [{ labelSnapshot: 'asc' }, { tagId: 'asc' }],
    select: { tagId: true, labelSnapshot: true }
  }
} satisfies Prisma.QuestionVersionSelect

const bookmarkReadSelect = {
  id: true,
  questionId: true,
  createdAt: true,
  question: {
    select: {
      lifecycleStatus: true,
      currentPublishedVersion: { select: versionSummarySelect },
      versions: {
        where: { status: { in: ['PUBLISHED', 'RETIRED'] } },
        orderBy: [{ versionNumber: 'desc' }, { id: 'asc' }],
        take: 1,
        select: versionSummarySelect
      }
    }
  }
} satisfies Prisma.BookmarkSelect

type BookmarkReadRow = Prisma.BookmarkGetPayload<{
  select: typeof bookmarkReadSelect
}>

const toQuestionRecord = (
  questionId: string,
  version: BookmarkReadRow['question']['versions'][number]
): PublishedQuestionSummaryRecord => ({
  id: questionId,
  questionVersionId: version.id,
  level: version.level,
  subject: version.subject,
  questionType: version.questionType,
  difficulty: version.difficulty,
  questionText: version.questionText,
  tags: version.tags.map(({ labelSnapshot, tagId }) => ({
    id: tagId,
    label: labelSnapshot
  }))
})

const toBookmarkRecord = (row: BookmarkReadRow): BookmarkReadRecord => {
  const current = row.question.currentPublishedVersion
  const isAvailable =
    row.question.lifecycleStatus === 'ACTIVE' && current?.status === 'PUBLISHED'
  const version = isAvailable ? current : row.question.versions[0]

  if (!version) {
    throw new BookmarkRepositoryIntegrityError(
      'Bookmark question has no retained public question version.'
    )
  }

  return {
    id: row.id,
    questionId: row.questionId,
    createdAt: row.createdAt,
    availability: isAvailable ? 'AVAILABLE' : 'ARCHIVED',
    question: toQuestionRecord(row.questionId, version)
  }
}

const findOwnedBookmark = async (
  transaction: Prisma.TransactionClient,
  userId: string,
  questionId: string
): Promise<BookmarkReadRecord | null> => {
  const bookmark = await transaction.bookmark.findUnique({
    where: { userId_questionId: { userId, questionId } },
    select: bookmarkReadSelect
  })
  return bookmark ? toBookmarkRecord(bookmark) : null
}

export const createPrismaBookmarkRepository = (
  client: PrismaClient
): BookmarkRepository => ({
  createOwned: (input) =>
    executeRepositoryOperation(
      async () =>
        await client.$transaction(
          async (transaction) => {
            const lockedQuestion = await transaction.$queryRaw<
              Array<{ id: string; lifecycleStatus: 'ACTIVE' | 'ARCHIVED' }>
            >(Prisma.sql`
            SELECT question."id", question."lifecycleStatus"
            FROM "Question" AS question
            WHERE question."id" = ${input.questionId}::uuid
            FOR SHARE OF question
          `)
            const question = lockedQuestion[0]
            if (!question) {
              throw new BookmarkQuestionNotFoundError()
            }

            const existing = await findOwnedBookmark(
              transaction,
              input.userId,
              input.questionId
            )
            if (existing) {
              return { bookmark: existing, created: false }
            }

            const available = await transaction.question.findFirst({
              where: {
                id: input.questionId,
                lifecycleStatus: 'ACTIVE',
                currentPublishedVersion: { is: { status: 'PUBLISHED' } }
              },
              select: { id: true }
            })
            if (!available) {
              throw new BookmarkQuestionNotAvailableError()
            }

            const inserted = await transaction.$queryRaw<Array<{ id: string }>>(
              Prisma.sql`
              INSERT INTO "Bookmark" ("id", "userId", "questionId", "createdAt")
              VALUES (
                ${input.id}::uuid,
                ${input.userId}::uuid,
                ${input.questionId}::uuid,
                ${input.createdAt}
              )
              ON CONFLICT ("userId", "questionId") DO NOTHING
              RETURNING "id"
            `
            )
            const bookmark = await findOwnedBookmark(
              transaction,
              input.userId,
              input.questionId
            )
            if (!bookmark) {
              throw new BookmarkRepositoryIntegrityError(
                'Bookmark upsert did not produce an owner-visible row.'
              )
            }
            return { bookmark, created: inserted.length === 1 }
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
        )
    ),
  deleteOwned: (userId, questionId) =>
    executeRepositoryOperation(async () => {
      await client.bookmark.deleteMany({ where: { userId, questionId } })
    }),
  listOwned: (input) =>
    executeRepositoryOperation(
      async () =>
        await client.$transaction(
          async (transaction) => {
            const where = {
              userId: input.userId,
              ...(input.questionIds
                ? { questionId: { in: input.questionIds } }
                : {})
            } satisfies Prisma.BookmarkWhereInput
            const total = assertSafeTotal(
              await transaction.bookmark.count({ where })
            )
            const offset = (BigInt(input.page) - 1n) * BigInt(input.pageSize)
            const rows =
              offset >= BigInt(total)
                ? []
                : await transaction.bookmark.findMany({
                    where,
                    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
                    skip: Number(offset),
                    take: input.pageSize,
                    select: bookmarkReadSelect
                  })
            return { total, items: rows.map(toBookmarkRecord) }
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
        )
    )
})
