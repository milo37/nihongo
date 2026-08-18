import { describe, expect, it } from 'vitest'
import { ApplicationError } from '../errors/applicationError.js'
import {
  GuestCredentialExpiredError,
  type ExistingStudyOwner
} from './studySessionRepository.js'
import {
  DraftAnswerNotInSessionError,
  DraftOptionNotInVersionError,
  DraftVersionConflictError,
  OwnedStudyDraftSessionNotFoundError,
  PracticeContractVersionMismatchError,
  StudyDraftNotEditableError,
  StudyDraftRepositoryIntegrityError,
  type StudyDraftRepository
} from './studyDraftRepository.js'
import { createStudyDraftService } from './studyDraftService.js'
import {
  IdempotencyKeyReusedError,
  StudySubmissionRepositoryUnavailableError
} from './studySubmissionRepository.js'

const SESSION_ID = '00000000-0000-4000-8000-000000000001'
const OWNER: ExistingStudyOwner = {
  kind: 'USER',
  userId: '00000000-0000-4000-8000-000000000002'
}
const NOW = new Date('2000-01-01T12:00:00.000Z')

const createRepository = (
  overrides: Partial<StudyDraftRepository> = {}
): StudyDraftRepository => ({
  cancelOwned: async () => ({ kind: 'CANCELLED' }),
  findOwned: async () => null,
  listOwnedResumable: async (_owner, query) => ({
    items: [],
    page: query.page,
    pageSize: query.pageSize,
    total: 0
  }),
  saveAtomic: async () => {
    throw new Error('Unexpected saveAtomic call.')
  },
  ...overrides
})

describe('StudyDraft service', () => {
  it.each([
    [new GuestCredentialExpiredError(), 'GUEST_SESSION_EXPIRED', false],
    [new OwnedStudyDraftSessionNotFoundError(), 'RESOURCE_NOT_FOUND', false],
    [
      new PracticeContractVersionMismatchError(),
      'PRACTICE_CONTRACT_VERSION_MISMATCH',
      false
    ],
    [new DraftVersionConflictError(), 'DRAFT_VERSION_CONFLICT', false],
    [new DraftAnswerNotInSessionError(), 'ANSWER_NOT_IN_SESSION', false],
    [new DraftOptionNotInVersionError(), 'OPTION_NOT_IN_VERSION', false],
    [new StudyDraftNotEditableError(), 'STUDY_SESSION_NOT_EDITABLE', false],
    [new IdempotencyKeyReusedError(), 'IDEMPOTENCY_KEY_REUSED', false],
    [
      new StudySubmissionRepositoryUnavailableError({
        cause: new Error('database unavailable')
      }),
      'SERVICE_UNAVAILABLE',
      true
    ],
    [
      new StudyDraftRepositoryIntegrityError('invalid draft'),
      'INTERNAL_SERVER_ERROR',
      true
    ]
  ] as const)(
    '%s repository 오류를 %s public code로 닫는다',
    async (repositoryError, code, retryable) => {
      const service = createStudyDraftService(
        createRepository({
          findOwned: async () => {
            throw repositoryError
          }
        }),
        () => NOW
      )

      await expect(service.get(SESSION_ID, OWNER)).rejects.toMatchObject({
        name: 'ApplicationError',
        code,
        retryable
      })
    }
  )

  it('없는 draft와 cancel outcome을 bounded public error로 매핑한다', async () => {
    const missingDraft = createStudyDraftService(createRepository(), () => NOW)
    await expect(missingDraft.get(SESSION_ID, OWNER)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND'
    })

    for (const [kind, code] of [
      ['NOT_FOUND', 'RESOURCE_NOT_FOUND'],
      ['NOT_EDITABLE', 'STUDY_SESSION_NOT_EDITABLE']
    ] as const) {
      const service = createStudyDraftService(
        createRepository({ cancelOwned: async () => ({ kind }) }),
        () => NOW
      )
      await expect(service.cancel(SESSION_ID, OWNER)).rejects.toMatchObject({
        code
      })
    }
  })

  it('성공한 cancel은 값을 발명하지 않고 void로 끝난다', async () => {
    const service = createStudyDraftService(createRepository(), () => NOW)
    await expect(service.cancel(SESSION_ID, OWNER)).resolves.toBeUndefined()
  })

  it('알 수 없는 repository 오류는 ApplicationError로 위장하지 않는다', async () => {
    const unknown = new Error('unknown')
    const service = createStudyDraftService(
      createRepository({
        findOwned: async () => {
          throw unknown
        }
      }),
      () => NOW
    )

    await expect(service.get(SESSION_ID, OWNER)).rejects.toBe(unknown)
    expect(unknown).not.toBeInstanceOf(ApplicationError)
  })
})
