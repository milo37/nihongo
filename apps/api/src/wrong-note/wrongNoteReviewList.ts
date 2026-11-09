import type {
  ListReviewListResponse,
  ParsedListReviewListQuery,
  ReviewListItem
} from '@nihongo/contracts/wrong-note/list-review-list'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { ApplicationError } from '../errors/applicationError.js'
import { createCurrentReviewCandidatePredicate } from '../review/currentReviewCandidateQuery.js'
import { createWrongNoteQuestionPreview } from './wrongNoteMapper.js'

type ReviewState = ParsedListReviewListQuery['state']

interface ReviewListRow {
  readonly questionId: string
  readonly currentQuestionVersionId: string
  readonly level: ReviewListItem['level']
  readonly subject: ReviewListItem['subject']
  readonly questionType: ReviewListItem['questionType']
  readonly questionText: string
  readonly wrongCount: number
  readonly lastWrongAt: Date
  readonly lastReviewedAt: Date | null
}

export interface ReviewListResult {
  readonly counts: { readonly toReview: number; readonly reviewed: number }
  readonly oldestToReview: Pick<ReviewListItem, 'level' | 'subject'> | null
  readonly rows: readonly ReviewListRow[]
  readonly observedAt: Date
}

export interface WrongNoteReviewListRepository {
  listOwned: (
    userId: string,
    query: ParsedListReviewListQuery
  ) => Promise<ReviewListResult>
}

export interface WrongNoteReviewListService {
  listReviewList: (
    userId: string,
    query: ParsedListReviewListQuery
  ) => Promise<ListReviewListResponse>
}

export class WrongNoteReviewListUnavailableError extends Error {
  constructor(options: ErrorOptions) {
    super('WrongNote review list is unavailable.', options)
    this.name = 'WrongNoteReviewListUnavailableError'
  }
}

const UNAVAILABLE_PRISMA_CODES = new Set(['P1001', 'P1002', 'P2024', 'P2034'])

// JLP-812: the four stored statuses read as two states.
const TO_REVIEW = Prisma.sql`note."status" IN ('NEW', 'AGAIN')`
const REVIEWED = Prisma.sql`note."status" IN ('REVIEWING', 'SOLVED')`

const FROM_CANDIDATES = Prisma.sql`
  FROM "WrongNote" AS note
  JOIN "Question" AS question
    ON question."id" = note."questionId"
  JOIN "QuestionVersion" AS version
    ON version."questionId" = question."id"
    AND version."id" = question."currentPublishedVersionId"
`

const toCount = (value: bigint): number => {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Review list count exceeds the safe integer range.')
  }
  return Number(value)
}

export const createPrismaWrongNoteReviewListRepository = (
  client: PrismaClient
): WrongNoteReviewListRepository => ({
  listOwned: async (userId, query) => {
    const predicate = createCurrentReviewCandidatePredicate({
      userId,
      ...(query.level ? { level: query.level } : {})
    })
    const state: Record<ReviewState, Prisma.Sql> = {
      TO_REVIEW,
      REVIEWED
    }
    const order: Record<ReviewState, Prisma.Sql> = {
      TO_REVIEW: Prisma.sql`note."lastWrongAt" DESC, note."questionId" ASC`,
      REVIEWED: Prisma.sql`note."lastReviewedAt" DESC NULLS LAST, note."questionId" ASC`
    }
    try {
      return await client.$transaction(
        async (transaction) => {
          await transaction.$executeRaw`SET TRANSACTION READ ONLY`
          const [clock] = await transaction.$queryRaw<
            Array<{ observedAt: Date }>
          >`SELECT CURRENT_TIMESTAMP AS "observedAt"`
          const [countRow] = await transaction.$queryRaw<
            Array<{ toReview: bigint; reviewed: bigint }>
          >(Prisma.sql`
            SELECT
              COUNT(*) FILTER (WHERE ${TO_REVIEW})::bigint AS "toReview",
              COUNT(*) FILTER (WHERE ${REVIEWED})::bigint AS "reviewed"
            ${FROM_CANDIDATES}
            WHERE ${predicate}
          `)
          const [oldest] = await transaction.$queryRaw<
            Array<Pick<ReviewListItem, 'level' | 'subject'>>
          >(Prisma.sql`
            SELECT version."level"::text AS "level",
                   version."subject"::text AS "subject"
            ${FROM_CANDIDATES}
            WHERE ${predicate} AND ${TO_REVIEW}
            ORDER BY note."lastWrongAt" ASC, note."questionId" ASC
            LIMIT 1
          `)
          if (!clock || !countRow) {
            throw new Error('Review list snapshot returned no row.')
          }
          const counts = {
            toReview: toCount(countRow.toReview),
            reviewed: toCount(countRow.reviewed)
          }
          const total =
            query.state === 'TO_REVIEW' ? counts.toReview : counts.reviewed
          const offset = (BigInt(query.page) - 1n) * BigInt(query.pageSize)
          const rows =
            offset >= BigInt(total)
              ? []
              : await transaction.$queryRaw<ReviewListRow[]>(Prisma.sql`
                  SELECT
                    note."questionId",
                    version."id" AS "currentQuestionVersionId",
                    version."level"::text AS "level",
                    version."subject"::text AS "subject",
                    version."questionType"::text AS "questionType",
                    version."questionText",
                    note."wrongCount",
                    note."lastWrongAt",
                    note."lastReviewedAt"
                  ${FROM_CANDIDATES}
                  WHERE ${predicate} AND ${state[query.state]}
                  ORDER BY ${order[query.state]}
                  OFFSET ${Number(offset)}
                  LIMIT ${query.pageSize}
                `)
          return {
            counts,
            oldestToReview: oldest ?? null,
            rows,
            observedAt: clock.observedAt
          }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
      )
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientInitializationError ||
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          UNAVAILABLE_PRISMA_CODES.has(error.code))
      ) {
        throw new WrongNoteReviewListUnavailableError({ cause: error })
      }
      throw error
    }
  }
})

export const createWrongNoteReviewListService = (
  repository: WrongNoteReviewListRepository
): WrongNoteReviewListService => ({
  listReviewList: async (userId, query) => {
    let result: ReviewListResult
    try {
      result = await repository.listOwned(userId, query)
    } catch (error: unknown) {
      if (error instanceof WrongNoteReviewListUnavailableError) {
        throw new ApplicationError({
          code: 'SERVICE_UNAVAILABLE',
          message: '오답노트 저장소에 연결할 수 없습니다.',
          retryable: true,
          cause: error
        })
      }
      throw error
    }
    return {
      items: result.rows.map((row) => ({
        questionId: row.questionId,
        currentQuestionVersionId: row.currentQuestionVersionId,
        level: row.level,
        subject: row.subject,
        questionType: row.questionType,
        questionPreview: createWrongNoteQuestionPreview(row.questionText),
        reviewState: query.state,
        wrongCount: row.wrongCount,
        lastWrongAt: row.lastWrongAt.toISOString(),
        lastReviewedAt: row.lastReviewedAt?.toISOString() ?? null
      })),
      page: query.page,
      pageSize: query.pageSize,
      total:
        query.state === 'TO_REVIEW'
          ? result.counts.toReview
          : result.counts.reviewed,
      state: query.state,
      counts: result.counts,
      oldestToReview: result.oldestToReview,
      observedAt: result.observedAt.toISOString()
    }
  }
})
