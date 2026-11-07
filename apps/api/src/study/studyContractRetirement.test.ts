import { describe, expect, it, vi } from 'vitest'
import { createStudySessionService } from './studySessionService.js'
import type {
  StudySessionRecord,
  StudySessionRepository
} from './studySessionRepository.js'
import { createStudySubmissionService } from './studySubmissionService.js'
import type { StudySubmissionRepository } from './studySubmissionRepository.js'

const owner = { kind: 'USER', userId: 'user' } as const
const input = {
  level: 'N5',
  subject: 'VOCABULARY',
  mode: 'RANDOM',
  count: 1
} as const
const timestamp = new Date('2026-01-01T00:00:00.000Z')
const session: StudySessionRecord = {
  id: 'session',
  userId: 'user',
  guestPrincipalId: null,
  level: 'N5',
  subject: 'VOCABULARY',
  mode: 'RANDOM',
  status: 'IN_PROGRESS',
  requestedCount: 1,
  actualCount: 1,
  usedFallback: false,
  fallbackReason: null,
  startedAt: timestamp,
  expiresAt: timestamp,
  submittedAt: null,
  durationSec: null,
  practiceContractVersion: 2,
  questions: []
}

describe('practice contract retirement', () => {
  it('creates practice contract 2 sessions', async () => {
    const create = vi.fn(async () => ({ session, issuedGuestCredential: null }))
    const repository: StudySessionRepository = {
      create,
      createRandom: vi.fn(),
      findOwnedById: vi.fn()
    }
    const service = createStudySessionService(repository, () => timestamp)
    const result = await service.create(input, owner)
    expect(result.practiceContractVersion).toBe(2)
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ practiceContractVersion: 2 })
    )
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('rejects an owned old session and preserves the not-found owner boundary', async () => {
    const findOwnedById = vi.fn<StudySessionRepository['findOwnedById']>()
    const service = createStudySessionService({
      create: vi.fn(),
      createRandom: vi.fn(),
      findOwnedById
    })
    findOwnedById.mockResolvedValueOnce({
      ...session,
      practiceContractVersion: 1
    })
    await expect(service.get('session', owner)).rejects.toMatchObject({
      code: 'PRACTICE_CONTRACT_VERSION_MISMATCH'
    })
    findOwnedById.mockResolvedValueOnce(null)
    await expect(service.get('session', owner)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND'
    })
  })

  it('rejects a v1 session before a v2 submission can replay an old key', async () => {
    const submitAtomic = vi.fn<StudySubmissionRepository['submitAtomic']>()
    const preloadOwned = vi.fn<StudySubmissionRepository['preloadOwned']>()
    preloadOwned.mockResolvedValueOnce({
      sessionId: 'session',
      status: 'IN_PROGRESS',
      expiresAt: timestamp,
      practiceContractVersion: 1,
      orderedSessionQuestions: []
    })
    const service = createStudySubmissionService({
      preloadOwned,
      submitAtomic,
      findOwnedResult: vi.fn()
    })
    await expect(
      service.submit(
        'session',
        'key',
        {
          answers: [],
          durationSec: 0,
          expectedDraftRevision: 0
        },
        owner
      )
    ).rejects.toMatchObject({ code: 'PRACTICE_CONTRACT_VERSION_MISMATCH' })
    expect(submitAtomic).not.toHaveBeenCalled()
  })
})
