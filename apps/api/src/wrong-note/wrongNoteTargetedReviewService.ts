import type { CreateTargetedReviewSessionResponse } from '@nihongo/contracts/wrong-note/create-targeted-review-session'
import { ApplicationError } from '../errors/applicationError.js'
import {
  TargetedReviewIdempotencyKeyReusedError,
  TargetedReviewQuestionNotAvailableError,
  TargetedReviewWrongNoteNotFoundError,
  WrongNoteTargetedReviewRepositoryIntegrityError,
  WrongNoteTargetedReviewRepositoryUnavailableError,
  type WrongNoteTargetedReviewRepository
} from './wrongNoteTargetedReviewRepository.js'

export interface CreateTargetedReviewServiceResult {
  readonly replayed: boolean
  readonly response: CreateTargetedReviewSessionResponse
}

export interface WrongNoteTargetedReviewService {
  readonly createTargetedReviewSession: (
    userId: string,
    questionId: string,
    idempotencyKey: string
  ) => Promise<CreateTargetedReviewServiceResult>
}

const throwMappedError = (error: unknown): never => {
  if (error instanceof TargetedReviewWrongNoteNotFoundError) {
    throw new ApplicationError({
      code: 'RESOURCE_NOT_FOUND',
      message: '복습할 오답 노트를 찾을 수 없습니다.',
      retryable: false
    })
  }
  if (error instanceof TargetedReviewQuestionNotAvailableError) {
    throw new ApplicationError({
      code: 'QUESTION_NOT_AVAILABLE',
      message: '현재 복습할 수 없는 문제입니다.',
      retryable: false
    })
  }
  if (error instanceof TargetedReviewIdempotencyKeyReusedError) {
    throw new ApplicationError({
      code: 'IDEMPOTENCY_KEY_REUSED',
      message: '같은 멱등 키를 다른 targeted 복습 요청에 사용할 수 없습니다.',
      retryable: false
    })
  }
  if (error instanceof WrongNoteTargetedReviewRepositoryUnavailableError) {
    throw new ApplicationError({
      code: 'SERVICE_UNAVAILABLE',
      message: 'targeted 복습 저장소에 연결할 수 없습니다.',
      retryable: true,
      cause: error
    })
  }
  if (error instanceof WrongNoteTargetedReviewRepositoryIntegrityError) {
    throw new ApplicationError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'targeted 복습 무결성을 확인하지 못했습니다.',
      retryable: true,
      cause: error
    })
  }
  throw error
}

export const createWrongNoteTargetedReviewService = (
  repository: WrongNoteTargetedReviewRepository,
  now: () => Date = () => new Date()
): WrongNoteTargetedReviewService => ({
  createTargetedReviewSession: async (userId, questionId, idempotencyKey) => {
    try {
      return await repository.createAtomic({
        userId,
        questionId,
        idempotencyKey,
        observedAt: now()
      })
    } catch (error: unknown) {
      return throwMappedError(error)
    }
  }
})
