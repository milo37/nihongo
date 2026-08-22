import { describe, expect, it, vi } from 'vitest'
import { ApplicationError } from '../errors/applicationError.js'
import {
  GuestCredentialExpiredError,
  NoEligibleQuestionsError,
  StudySessionRepositoryUnavailableError,
  type StudySessionRecord,
  type StudySessionRepository
} from './studySessionRepository.js'
import { createStudySessionService } from './studySessionService.js'

const SESSION_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c1001'
const QUESTION_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c1002'
const VERSION_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c1003'
const STARTED_AT = new Date('2026-08-14T12:00:00.000Z')

const record: StudySessionRecord = {
  id: SESSION_ID,
  userId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c1004',
  guestPrincipalId: null,
  level: 'N5',
  subject: 'VOCABULARY',
  mode: 'RANDOM',
  status: 'IN_PROGRESS',
  requestedCount: 1,
  actualCount: 1,
  usedFallback: false,
  fallbackReason: null,
  startedAt: STARTED_AT,
  expiresAt: new Date('2026-08-15T12:00:00.000Z'),
  submittedAt: null,
  durationSec: null,
  questions: [
    {
      sessionQuestionId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c1005',
      ordinal: 1,
      question: {
        id: QUESTION_ID,
        questionVersionId: VERSION_ID,
        level: 'N5',
        subject: 'VOCABULARY',
        questionType: 'KANJI_READING',
        passage: null,
        questionText: '「川」の読み方はどれですか。',
        difficulty: 'EASY',
        options: ['かわ', 'やま', 'うみ', 'そら'].map((text, index) => ({
          id: `018f6b7a-1f4b-7d5e-8a91-4c27df9c11${index
            .toString()
            .padStart(2, '0')}`,
          label: String(index + 1),
          text
        })),
        tags: [
          {
            id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c1006',
            label: '한자 읽기'
          }
        ]
      }
    }
  ]
}

const createRepository = (
  overrides: Partial<StudySessionRepository> = {}
): StudySessionRepository => ({
  create: vi.fn().mockResolvedValue({
    session: record,
    issuedGuestCredential: null
  }),
  createRandom: vi.fn().mockResolvedValue({
    session: record,
    issuedGuestCredential: null
  }),
  findOwnedById: vi.fn().mockResolvedValue(record),
  ...overrides
})

const request = {
  level: 'N5',
  subject: 'VOCABULARY',
  mode: 'RANDOM',
  count: 1
} as const

const owner = { kind: 'USER', userId: record.userId! } as const

describe('studySessionService', () => {
  it('RANDOM 세션에 24시간 만료와 서버 권위 owner를 전달한다', async () => {
    const repository = createRepository()
    const service = createStudySessionService(repository, () => STARTED_AT)

    const result = await service.create(request, owner)

    expect(repository.create).toHaveBeenCalledWith({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      requestedCount: 1,
      startedAt: STARTED_AT,
      expiresAt: new Date('2026-08-15T12:00:00.000Z'),
      owner
    })
    expect(result.payload.session.id).toBe(SESSION_ID)
    expect(result.payload.questions[0]?.question.questionVersionId).toBe(
      VERSION_ID
    )
    expect(result.payload).not.toHaveProperty('userId')
  })

  it.each(['WRONG_NOTE', 'WEAKNESS', 'BOOKMARK', 'DAILY_REVIEW'] as const)(
    'v1 contract에서 %s 모드를 fail closed한다',
    async (mode) => {
      const repository = createRepository()
      const service = createStudySessionService(repository)

      await expect(
        service.create({ ...request, mode }, owner)
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        retryable: false
      } satisfies Partial<ApplicationError>)
      expect(repository.create).not.toHaveBeenCalled()
    }
  )

  it('v2 review filter를 DAILY_REVIEW repository input에 그대로 전달한다', async () => {
    const repository = createRepository()
    const service = createStudySessionService(repository, () => STARTED_AT)

    await service.create(
      {
        ...request,
        mode: 'DAILY_REVIEW',
        reviewFilter: { questionType: 'KANJI_READING', tag: '한자 읽기' }
      },
      owner,
      2
    )

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'DAILY_REVIEW',
        practiceContractVersion: 2,
        reviewFilter: {
          questionType: 'KANJI_READING',
          tag: '한자 읽기'
        }
      })
    )
  })

  it.each(['WRONG_NOTE', 'WEAKNESS', 'BOOKMARK', 'DAILY_REVIEW'] as const)(
    'v2 USER에게 %s 모드를 전달한다',
    async (mode) => {
      const repository = createRepository()
      const service = createStudySessionService(repository, () => STARTED_AT)

      await service.create({ ...request, mode }, owner, 2)

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ mode, practiceContractVersion: 2 })
      )
    }
  )

  it('v2 existing guest WEAKNESS owner를 repository에 그대로 전달한다', async () => {
    const repository = createRepository()
    const service = createStudySessionService(repository, () => STARTED_AT)
    const guestOwner = {
      kind: 'GUEST' as const,
      guestPrincipalId: crypto.randomUUID(),
      tokenDigest: 'a'.repeat(64)
    }

    await service.create({ ...request, mode: 'WEAKNESS' }, guestOwner, 2)

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'WEAKNESS',
        owner: guestOwner,
        practiceContractVersion: 2
      })
    )
  })

  it.each(['WRONG_NOTE', 'BOOKMARK', 'DAILY_REVIEW'] as const)(
    'guest의 %s 요청은 인증 오류로 닫는다',
    async (mode) => {
      const repository = createRepository()
      const service = createStudySessionService(repository)

      await expect(
        service.create(
          { ...request, mode },
          {
            kind: 'GUEST',
            guestPrincipalId: crypto.randomUUID(),
            tokenDigest: 'a'.repeat(64)
          },
          2
        )
      ).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' })
      expect(repository.create).not.toHaveBeenCalled()
    }
  )

  it.each([
    [new NoEligibleQuestionsError(), 'NO_ELIGIBLE_QUESTIONS', false],
    [new GuestCredentialExpiredError(), 'GUEST_SESSION_EXPIRED', false],
    [
      new StudySessionRepositoryUnavailableError({
        cause: new Error('database unavailable')
      }),
      'SERVICE_UNAVAILABLE',
      true
    ]
  ] as const)(
    'repository 오류를 %s 계약으로 변환한다',
    async (error, code, retryable) => {
      const service = createStudySessionService(
        createRepository({ create: async () => Promise.reject(error) })
      )

      await expect(service.create(request, owner)).rejects.toMatchObject({
        code,
        retryable
      })
    }
  )

  it('소유하지 않거나 없는 세션은 동일한 404로 숨긴다', async () => {
    const service = createStudySessionService(
      createRepository({ findOwnedById: async () => null })
    )

    await expect(service.get(SESSION_ID, owner)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      retryable: false
    } satisfies Partial<ApplicationError>)
  })
})
