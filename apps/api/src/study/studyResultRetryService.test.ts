import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  GuestCredentialExpiredError,
  NoEligibleQuestionsError
} from './studySessionRepository.js'
import {
  ResultRetryIdempotencyKeyReusedError,
  ResultRetrySourceNotFoundError,
  ResultRetryStudyResultNotReadyError,
  StudyResultRetryRepositoryIntegrityError,
  StudyResultRetryRepositoryUnavailableError,
  type StudyResultRetryRepository
} from './studyResultRetryRepository.js'
import { createStudyResultRetryService } from './studyResultRetryService.js'

const NOW = new Date('2026-08-21T15:00:00.000Z')
const sourceSessionId = randomUUID()
const idempotencyKey = randomUUID()
const owner = { kind: 'USER', userId: randomUUID() } as const

describe('study result retry service', () => {
  it('서버 clock과 owner/source/key를 atomic repository에 전달한다', async () => {
    const response = { replayed: true, response: {} as never }
    const createAtomic = vi.fn().mockResolvedValue(response)
    const service = createStudyResultRetryService(
      { createAtomic } satisfies StudyResultRetryRepository,
      () => NOW
    )

    await expect(
      service.create(sourceSessionId, idempotencyKey, owner)
    ).resolves.toBe(response)
    expect(createAtomic).toHaveBeenCalledWith({
      sourceSessionId,
      idempotencyKey,
      owner,
      observedAt: NOW
    })
  })

  it.each([
    [new GuestCredentialExpiredError(), 'GUEST_SESSION_EXPIRED', false],
    [new ResultRetrySourceNotFoundError(), 'RESOURCE_NOT_FOUND', false],
    [
      new ResultRetryStudyResultNotReadyError(),
      'STUDY_RESULT_NOT_READY',
      false
    ],
    [
      new ResultRetryIdempotencyKeyReusedError(),
      'IDEMPOTENCY_KEY_REUSED',
      false
    ],
    [new NoEligibleQuestionsError(), 'NO_ELIGIBLE_QUESTIONS', false],
    [
      new StudyResultRetryRepositoryUnavailableError({
        cause: new Error('database unavailable')
      }),
      'SERVICE_UNAVAILABLE',
      true
    ],
    [
      new StudyResultRetryRepositoryIntegrityError('invalid retry aggregate'),
      'INTERNAL_SERVER_ERROR',
      true
    ]
  ] as const)(
    'repository 오류를 %s 계약으로 변환한다',
    async (error, code, retryable) => {
      const service = createStudyResultRetryService({
        createAtomic: async () => Promise.reject(error)
      })

      await expect(
        service.create(sourceSessionId, idempotencyKey, owner)
      ).rejects.toMatchObject({ code, retryable })
    }
  )
})
