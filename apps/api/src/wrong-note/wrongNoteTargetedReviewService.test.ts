import { randomUUID } from 'node:crypto'
import { reviewCenterConformanceFixture } from '@nihongo/contracts/testing/review-center-conformance'
import { describe, expect, it, vi } from 'vitest'
import { ApplicationError } from '../errors/applicationError.js'
import {
  TargetedReviewIdempotencyKeyReusedError,
  TargetedReviewQuestionNotAvailableError,
  TargetedReviewWrongNoteNotFoundError,
  WrongNoteTargetedReviewRepositoryIntegrityError,
  WrongNoteTargetedReviewRepositoryUnavailableError,
  type WrongNoteTargetedReviewRepository
} from './wrongNoteTargetedReviewRepository.js'
import { createWrongNoteTargetedReviewService } from './wrongNoteTargetedReviewService.js'

const NOW = new Date('2026-08-22T12:00:00.000Z')

const createRepository = () => ({
  createAtomic: vi.fn<WrongNoteTargetedReviewRepository['createAtomic']>()
})

const captureApplicationError = async (
  operation: () => Promise<unknown>
): Promise<ApplicationError> => {
  try {
    await operation()
  } catch (error: unknown) {
    if (error instanceof ApplicationError) {
      return error
    }
    throw error
  }
  throw new Error('ApplicationError가 필요합니다.')
}

describe('WrongNoteTargetedReviewService', () => {
  it('한 번 정한 observedAt과 self principal만 repository에 전달한다', async () => {
    const repository = createRepository()
    repository.createAtomic.mockResolvedValue({
      replayed: false,
      response: reviewCenterConformanceFixture.targetedSession
    })
    const service = createWrongNoteTargetedReviewService(repository, () => NOW)
    const userId = randomUUID()
    const key = randomUUID()

    await expect(
      service.createTargetedReviewSession(
        userId,
        reviewCenterConformanceFixture.targetedQuestionId,
        key
      )
    ).resolves.toEqual({
      replayed: false,
      response: reviewCenterConformanceFixture.targetedSession
    })
    expect(repository.createAtomic).toHaveBeenCalledWith({
      userId,
      questionId: reviewCenterConformanceFixture.targetedQuestionId,
      idempotencyKey: key,
      observedAt: NOW
    })
  })

  it.each([
    [new TargetedReviewWrongNoteNotFoundError(), 'RESOURCE_NOT_FOUND', false],
    [
      new TargetedReviewQuestionNotAvailableError(),
      'QUESTION_NOT_AVAILABLE',
      false
    ],
    [
      new TargetedReviewIdempotencyKeyReusedError(),
      'IDEMPOTENCY_KEY_REUSED',
      false
    ],
    [
      new WrongNoteTargetedReviewRepositoryUnavailableError({
        cause: new Error('private unavailable')
      }),
      'SERVICE_UNAVAILABLE',
      true
    ],
    [
      new WrongNoteTargetedReviewRepositoryIntegrityError('private integrity'),
      'INTERNAL_SERVER_ERROR',
      true
    ]
  ] as const)(
    '%s를 closed application error로 변환한다',
    async (repositoryError, code, retryable) => {
      const repository = createRepository()
      repository.createAtomic.mockRejectedValue(repositoryError)
      const service = createWrongNoteTargetedReviewService(
        repository,
        () => NOW
      )

      const error = await captureApplicationError(() =>
        service.createTargetedReviewSession(
          randomUUID(),
          reviewCenterConformanceFixture.targetedQuestionId,
          randomUUID()
        )
      )
      expect(error.code).toBe(code)
      expect(error.retryable).toBe(retryable)
      expect(error.message).not.toMatch(/private/u)
    }
  )
})
