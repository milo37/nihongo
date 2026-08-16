import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { ApplicationError } from '../errors/applicationError.js'
import {
  StudySessionAlreadySubmittedError,
  StudySubmissionRepositoryIntegrityError,
  type StudySubmissionRepository
} from './studySubmissionRepository.js'
import { createStudySubmissionService } from './studySubmissionService.js'

const SESSION_ID = randomUUID()
const USER_ID = randomUUID()
const SESSION_QUESTION_ID = randomUUID()
const OPTION_ID = randomUUID()
const NOW = new Date('2026-08-15T01:00:00.000Z')
const owner = { kind: 'USER' as const, userId: USER_ID }
const body = {
  answers: [
    {
      studySessionQuestionId: SESSION_QUESTION_ID,
      selectedOptionId: OPTION_ID,
      elapsedSec: 5
    }
  ],
  durationSec: 5
}

const createRepository = (): StudySubmissionRepository => ({
  preloadOwned: vi.fn().mockResolvedValue({
    sessionId: SESSION_ID,
    status: 'IN_PROGRESS',
    expiresAt: new Date('2026-08-16T01:00:00.000Z'),
    orderedSessionQuestions: [
      {
        studySessionQuestionId: SESSION_QUESTION_ID,
        questionId: randomUUID(),
        ordinal: 1
      }
    ]
  }),
  submitAtomic: vi.fn().mockRejectedValue(new Error('Not configured.')),
  findOwnedResult: vi.fn().mockResolvedValue({ kind: 'NOT_FOUND' })
})

describe('study submission service', () => {
  it('different-key submitted conflict에 canonical result Location을 보존한다', async () => {
    const repository = createRepository()
    vi.mocked(repository.submitAtomic).mockRejectedValue(
      new StudySessionAlreadySubmittedError()
    )
    const service = createStudySubmissionService(repository, () => NOW)

    await expect(
      service.submit(SESSION_ID, randomUUID(), body, owner)
    ).rejects.toMatchObject({
      code: 'SESSION_ALREADY_SUBMITTED',
      retryable: false,
      location: `/api/v1/study-sessions/${SESSION_ID}/result`
    })
  })

  it('repository integrity failure를 canonical retryable 500으로 매핑한다', async () => {
    const repository = createRepository()
    vi.mocked(repository.submitAtomic).mockRejectedValue(
      new StudySubmissionRepositoryIntegrityError('invalid facts')
    )
    const service = createStudySubmissionService(repository, () => NOW)

    try {
      await service.submit(SESSION_ID, randomUUID(), body, owner)
      throw new Error('Expected service to reject.')
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ApplicationError)
      expect(error).toMatchObject({
        code: 'INTERNAL_SERVER_ERROR',
        retryable: true
      })
    }
  })

  it('owner-scoped preload가 없으면 submit/hash 작업 전에 404다', async () => {
    const repository = createRepository()
    vi.mocked(repository.preloadOwned).mockResolvedValue(null)
    const service = createStudySubmissionService(repository, () => NOW)

    await expect(
      service.submit(SESSION_ID, randomUUID(), body, owner)
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
    expect(repository.submitAtomic).not.toHaveBeenCalled()
  })
})
