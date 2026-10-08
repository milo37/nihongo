import type { GetWrongNoteMemoResponse } from '@nihongo/contracts/wrong-note/get-wrong-note-memo'
import {
  decodeReviewEventCursor,
  encodeReviewEventCursor,
  type ListReviewEventsResponse,
  type ParsedListReviewEventsQuery,
  type ReviewEventHistoryItem
} from '@nihongo/contracts/wrong-note/list-review-events'
import type {
  ParsedUpdateWrongNoteMemoBody,
  UpdateWrongNoteMemoResponse
} from '@nihongo/contracts/wrong-note/update-wrong-note-memo'
import { ApplicationError } from '../errors/applicationError.js'
import {
  WrongNoteReviewCenterRepositoryIntegrityError,
  WrongNoteReviewCenterRepositoryUnavailableError,
  type ReviewEventHistoryRecord,
  type UserMemoReadRecord,
  type WrongNoteReviewCenterRepository
} from './wrongNoteReviewCenterRepository.js'

export interface WrongNoteReviewCenterService {
  getMemo: (
    userId: string,
    questionId: string
  ) => Promise<GetWrongNoteMemoResponse>
  listReviewEvents: (
    userId: string,
    questionId: string,
    query: ParsedListReviewEventsQuery
  ) => Promise<ListReviewEventsResponse>
  updateMemo: (
    userId: string,
    questionId: string,
    body: ParsedUpdateWrongNoteMemoBody
  ) => Promise<UpdateWrongNoteMemoResponse>
}

const throwNotFound = (): never => {
  throw new ApplicationError({
    code: 'RESOURCE_NOT_FOUND',
    message: '오답 노트를 찾을 수 없습니다.',
    retryable: false
  })
}

const throwMappedError = (error: unknown): never => {
  if (error instanceof WrongNoteReviewCenterRepositoryUnavailableError) {
    throw new ApplicationError({
      code: 'SERVICE_UNAVAILABLE',
      message: '복습 센터 저장소에 연결할 수 없습니다.',
      retryable: true,
      cause: error
    })
  }
  if (error instanceof WrongNoteReviewCenterRepositoryIntegrityError) {
    throw new ApplicationError({
      code: 'INTERNAL_SERVER_ERROR',
      message: '복습 센터 데이터 무결성을 확인하지 못했습니다.',
      retryable: true,
      cause: error
    })
  }
  throw error
}

const withMappedErrors = async <Result>(
  operation: () => Promise<Result>
): Promise<Result> => {
  try {
    return await operation()
  } catch (error: unknown) {
    return throwMappedError(error)
  }
}

const toMemoResponse = (
  record: UserMemoReadRecord | null
): GetWrongNoteMemoResponse =>
  record
    ? {
        questionId: record.questionId,
        text: record.text,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString()
      }
    : null

const toHistoryItem = (
  record: ReviewEventHistoryRecord
): ReviewEventHistoryItem => ({
  id: record.id,
  source: record.source,
  questionVersionId: record.questionVersionId,
  selectedOptionId: record.selectedOptionId,
  isCorrect: record.isCorrect,
  elapsedSec: record.elapsedSec,
  previousStatus: record.previousStatus,
  nextStatus: record.nextStatus,
  previousCorrectStreak: record.previousCorrectStreak,
  nextCorrectStreak: record.nextCorrectStreak,
  previousWrongCount: record.previousWrongCount,
  wrongCountAfter: record.wrongCountAfter,
  algorithmVersion: record.algorithmVersion,
  occurredAt: record.occurredAt.toISOString()
})

export const createWrongNoteReviewCenterService = (
  repository: WrongNoteReviewCenterRepository
): WrongNoteReviewCenterService => ({
  getMemo: (userId, questionId) =>
    withMappedErrors(async () => {
      const result = await repository.findOwnedMemo(userId, questionId)
      if (!result.found) {
        return throwNotFound()
      }
      return toMemoResponse(result.memo)
    }),
  listReviewEvents: (userId, questionId, query) =>
    withMappedErrors(async () => {
      const result = await repository.listOwnedReviewEvents({
        userId,
        questionId,
        cursor: query.cursor ? decodeReviewEventCursor(query.cursor) : null,
        limit: query.pageSize + 1
      })
      if (!result.found) {
        return throwNotFound()
      }
      if (result.items.length > query.pageSize + 1) {
        throw new WrongNoteReviewCenterRepositoryIntegrityError(
          'ReviewEvent history batch exceeded its requested bound.'
        )
      }

      const hasMore = result.items.length > query.pageSize
      const items = result.items.slice(0, query.pageSize).map(toHistoryItem)
      const lastItem = items.at(-1)
      return {
        items,
        nextCursor:
          hasMore && lastItem
            ? encodeReviewEventCursor({
                v: 1,
                occurredAt: lastItem.occurredAt,
                id: lastItem.id
              })
            : null
      }
    }),
  updateMemo: (userId, questionId, body) =>
    withMappedErrors(async () => {
      const result = await repository.updateOwnedMemo({
        userId,
        questionId,
        memo: body.memo
      })
      if (!result.found) {
        return throwNotFound()
      }
      return toMemoResponse(result.memo)
    })
})
