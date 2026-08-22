import { randomUUID } from 'node:crypto'
import type {
  ReviewEventCursorV1,
  ReviewEventHistoryItem
} from '@nihongo/contracts/wrong-note/list-review-events'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'

export interface UserMemoReadRecord {
  readonly createdAt: Date
  readonly questionId: string
  readonly text: string
  readonly updatedAt: Date
}

export type OwnedUserMemoResult =
  | { readonly found: false }
  | {
      readonly found: true
      readonly memo: UserMemoReadRecord | null
    }

export interface ReviewEventHistoryRecord
  extends Omit<ReviewEventHistoryItem, 'occurredAt'> {
  readonly occurredAt: Date
}

export type OwnedReviewEventHistoryResult =
  | { readonly found: false }
  | {
      readonly found: true
      readonly items: readonly ReviewEventHistoryRecord[]
    }

export interface UpdateOwnedUserMemoInput {
  readonly memo: string | null
  readonly questionId: string
  readonly userId: string
}

export interface ListOwnedReviewEventsInput {
  readonly cursor: ReviewEventCursorV1 | null
  readonly limit: number
  readonly questionId: string
  readonly userId: string
}

export interface WrongNoteReviewCenterRepository {
  findOwnedMemo: (
    userId: string,
    questionId: string
  ) => Promise<OwnedUserMemoResult>
  listOwnedReviewEvents: (
    input: ListOwnedReviewEventsInput
  ) => Promise<OwnedReviewEventHistoryResult>
  updateOwnedMemo: (
    input: UpdateOwnedUserMemoInput
  ) => Promise<OwnedUserMemoResult>
}

export class WrongNoteReviewCenterRepositoryUnavailableError extends Error {
  constructor(options: ErrorOptions) {
    super('WrongNote review-center repository is unavailable.', options)
    this.name = 'WrongNoteReviewCenterRepositoryUnavailableError'
  }
}

export class WrongNoteReviewCenterRepositoryIntegrityError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'WrongNoteReviewCenterRepositoryIntegrityError'
  }
}

interface CreateWrongNoteReviewCenterRepositoryOptions {
  afterOwnedWrongNoteLocked?: () => Promise<void>
  beforeOwnedWrongNoteLock?: (backendPid: number) => Promise<void>
  createId?: () => string
}

interface BackendPidRow {
  readonly backendPid: number
}

interface OwnedWrongNoteRow {
  readonly questionId: string
  readonly wrongNoteId: string
}

interface LockedOwnedWrongNoteRow extends OwnedWrongNoteRow {
  readonly observedAt: Date
}

interface MemoRow {
  readonly createdAt: Date
  readonly memoId: string
  readonly text: string
  readonly updatedAt: Date
}

interface OwnedMemoRow extends OwnedWrongNoteRow {
  readonly createdAt: Date | null
  readonly memoId: string | null
  readonly text: string | null
  readonly updatedAt: Date | null
}

interface ReviewEventHistoryRow {
  readonly algorithmVersion: number
  readonly elapsedSec: number | null
  readonly id: string
  readonly isCorrect: boolean | null
  readonly nextCorrectStreak: number
  readonly nextStatus: ReviewEventHistoryItem['nextStatus']
  readonly occurredAt: Date
  readonly previousCorrectStreak: number | null
  readonly previousStatus: ReviewEventHistoryItem['previousStatus']
  readonly previousWrongCount: number | null
  readonly questionVersionId: string
  readonly selectedOptionId: string | null
  readonly source: ReviewEventHistoryItem['source']
  readonly wrongCountAfter: number
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
      throw new WrongNoteReviewCenterRepositoryUnavailableError({
        cause: error
      })
    }
    throw error
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

export const createOwnedWrongNoteReadQuery = (
  userId: string,
  questionId: string
): Prisma.Sql => Prisma.sql`
  SELECT
    note."id" AS "wrongNoteId",
    note."questionId"
  FROM "WrongNote" AS note
  WHERE note."userId" = ${userId}::uuid
    AND note."questionId" = ${questionId}::uuid
  LIMIT 1
`

export const createOwnedMemoReadQuery = (
  userId: string,
  questionId: string
): Prisma.Sql => Prisma.sql`
  SELECT
    note."id" AS "wrongNoteId",
    note."questionId",
    memo."id" AS "memoId",
    memo."text",
    memo."createdAt",
    memo."updatedAt"
  FROM "WrongNote" AS note
  LEFT JOIN "UserMemo" AS memo
    ON memo."wrongNoteId" = note."id"
  WHERE note."userId" = ${userId}::uuid
    AND note."questionId" = ${questionId}::uuid
  LIMIT 1
`

export const createOwnedWrongNoteLockQuery = (
  userId: string,
  questionId: string
): Prisma.Sql => Prisma.sql`
  SELECT
    note."id" AS "wrongNoteId",
    note."questionId",
    CURRENT_TIMESTAMP AS "observedAt"
  FROM "WrongNote" AS note
  WHERE note."userId" = ${userId}::uuid
    AND note."questionId" = ${questionId}::uuid
  FOR UPDATE OF note
`

export const createOwnedMemoLockQuery = (
  wrongNoteId: string
): Prisma.Sql => Prisma.sql`
  SELECT
    memo."id" AS "memoId",
    memo."text",
    memo."createdAt",
    memo."updatedAt"
  FROM "UserMemo" AS memo
  WHERE memo."wrongNoteId" = ${wrongNoteId}::uuid
  FOR UPDATE OF memo
`

export const createReviewEventHistoryBatchQuery = ({
  cursor,
  limit,
  wrongNoteId
}: {
  readonly cursor: ReviewEventCursorV1 | null
  readonly limit: number
  readonly wrongNoteId: string
}): Prisma.Sql => {
  const projection = Prisma.sql`
    SELECT
      event."id",
      event."source"::text AS "source",
      event."questionVersionId",
      event."selectedOptionId",
      event."isCorrect",
      answer."elapsedSec",
      event."previousStatus"::text AS "previousStatus",
      event."nextStatus"::text AS "nextStatus",
      event."previousCorrectStreak",
      event."nextCorrectStreak",
      event."previousWrongCount",
      event."wrongCountAfter",
      event."algorithmVersion",
      event."occurredAt"
    FROM "ReviewEvent" AS event
    LEFT JOIN "StudyAnswer" AS answer
      ON answer."id" = event."studyAnswerId"
      AND answer."questionVersionId" = event."questionVersionId"
    WHERE event."wrongNoteId" = ${wrongNoteId}::uuid
  `

  return cursor
    ? Prisma.sql`
        ${projection}
          AND (event."occurredAt", event."id") <
            (${new Date(cursor.occurredAt)}, ${cursor.id}::uuid)
        ORDER BY event."occurredAt" DESC, event."id" DESC
        LIMIT ${limit}
      `
    : Prisma.sql`
        ${projection}
        ORDER BY event."occurredAt" DESC, event."id" DESC
        LIMIT ${limit}
      `
}

const toMemoRecord = (
  questionId: string,
  row: MemoRow
): UserMemoReadRecord => ({
  questionId,
  text: row.text,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
})

const toReviewEventHistoryRecord = (
  row: ReviewEventHistoryRow
): ReviewEventHistoryRecord => {
  if (row.algorithmVersion !== 1) {
    throw new WrongNoteReviewCenterRepositoryIntegrityError(
      'ReviewEvent history has an unsupported algorithm version.'
    )
  }

  return {
    id: row.id,
    source: row.source,
    questionVersionId: row.questionVersionId,
    selectedOptionId: row.selectedOptionId,
    isCorrect: row.isCorrect,
    elapsedSec: row.elapsedSec,
    previousStatus: row.previousStatus,
    nextStatus: row.nextStatus,
    previousCorrectStreak: row.previousCorrectStreak,
    nextCorrectStreak: row.nextCorrectStreak,
    previousWrongCount: row.previousWrongCount,
    wrongCountAfter: row.wrongCountAfter,
    algorithmVersion: 1,
    occurredAt: row.occurredAt
  }
}

const toOwnedMemoResult = (row: OwnedMemoRow): OwnedUserMemoResult => {
  if (row.memoId === null) {
    if (row.text !== null || row.createdAt !== null || row.updatedAt !== null) {
      throw new WrongNoteReviewCenterRepositoryIntegrityError(
        'UserMemo projection is internally inconsistent.'
      )
    }
    return { found: true, memo: null }
  }

  if (row.text === null || row.createdAt === null || row.updatedAt === null) {
    throw new WrongNoteReviewCenterRepositoryIntegrityError(
      'UserMemo projection is incomplete.'
    )
  }

  return {
    found: true,
    memo: toMemoRecord(row.questionId, {
      memoId: row.memoId,
      text: row.text,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    })
  }
}

const expectAtMostOne = <Row>(
  rows: readonly Row[],
  entityName: string
): Row | undefined => {
  if (rows.length > 1) {
    throw new WrongNoteReviewCenterRepositoryIntegrityError(
      `${entityName} lookup returned multiple rows.`
    )
  }
  return rows[0]
}

export const createPrismaWrongNoteReviewCenterRepository = (
  client: PrismaClient,
  {
    afterOwnedWrongNoteLocked,
    beforeOwnedWrongNoteLock,
    createId = randomUUID
  }: CreateWrongNoteReviewCenterRepositoryOptions = {}
): WrongNoteReviewCenterRepository => ({
  findOwnedMemo: (userId, questionId) =>
    executeRepositoryOperation(async () =>
      runReadOnlySnapshot(client, async (transaction) => {
        const rows = await transaction.$queryRaw<OwnedMemoRow[]>(
          createOwnedMemoReadQuery(userId, questionId)
        )
        const row = expectAtMostOne(rows, 'Owned WrongNote memo')
        return row ? toOwnedMemoResult(row) : { found: false }
      })
    ),
  listOwnedReviewEvents: (input) =>
    executeRepositoryOperation(async () =>
      runReadOnlySnapshot(client, async (transaction) => {
        const noteRows = await transaction.$queryRaw<OwnedWrongNoteRow[]>(
          createOwnedWrongNoteReadQuery(input.userId, input.questionId)
        )
        const note = expectAtMostOne(noteRows, 'Owned WrongNote')
        if (!note) {
          return { found: false }
        }
        const rows = await transaction.$queryRaw<ReviewEventHistoryRow[]>(
          createReviewEventHistoryBatchQuery({
            wrongNoteId: note.wrongNoteId,
            cursor: input.cursor,
            limit: input.limit
          })
        )
        return {
          found: true,
          items: rows.map(toReviewEventHistoryRecord)
        }
      })
    ),
  updateOwnedMemo: (input) =>
    executeRepositoryOperation(async () =>
      client.$transaction(
        async (transaction) => {
          if (beforeOwnedWrongNoteLock) {
            const backendPidRows = await transaction.$queryRaw<BackendPidRow[]>`
              SELECT pg_backend_pid()::int AS "backendPid"
            `
            const backendPid = expectAtMostOne(
              backendPidRows,
              'Memo writer backend PID'
            )?.backendPid
            if (backendPid === undefined) {
              throw new WrongNoteReviewCenterRepositoryIntegrityError(
                'Memo writer backend PID is unavailable.'
              )
            }
            await beforeOwnedWrongNoteLock(backendPid)
          }

          const noteRows = await transaction.$queryRaw<
            LockedOwnedWrongNoteRow[]
          >(createOwnedWrongNoteLockQuery(input.userId, input.questionId))
          const note = expectAtMostOne(noteRows, 'Locked owned WrongNote')
          if (!note) {
            return { found: false }
          }

          await afterOwnedWrongNoteLocked?.()

          const memoRows = await transaction.$queryRaw<MemoRow[]>(
            createOwnedMemoLockQuery(note.wrongNoteId)
          )
          const existing = expectAtMostOne(memoRows, 'Locked UserMemo')

          if (input.memo === null) {
            if (existing) {
              await transaction.userMemo.delete({
                where: { id: existing.memoId }
              })
            }
            return { found: true, memo: null }
          }

          if (existing?.text === input.memo) {
            return {
              found: true,
              memo: toMemoRecord(note.questionId, existing)
            }
          }

          if (!existing) {
            const created = await transaction.userMemo.create({
              data: {
                id: createId(),
                wrongNoteId: note.wrongNoteId,
                text: input.memo,
                createdAt: note.observedAt,
                updatedAt: note.observedAt
              },
              select: {
                id: true,
                text: true,
                createdAt: true,
                updatedAt: true
              }
            })
            return {
              found: true,
              memo: toMemoRecord(note.questionId, {
                memoId: created.id,
                text: created.text,
                createdAt: created.createdAt,
                updatedAt: created.updatedAt
              })
            }
          }

          const updatedAt =
            note.observedAt > existing.updatedAt
              ? note.observedAt
              : existing.updatedAt
          const updated = await transaction.userMemo.update({
            where: { id: existing.memoId },
            data: { text: input.memo, updatedAt },
            select: {
              id: true,
              text: true,
              createdAt: true,
              updatedAt: true
            }
          })
          return {
            found: true,
            memo: toMemoRecord(note.questionId, {
              memoId: updated.id,
              text: updated.text,
              createdAt: updated.createdAt,
              updatedAt: updated.updatedAt
            })
          }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
      )
    )
})
