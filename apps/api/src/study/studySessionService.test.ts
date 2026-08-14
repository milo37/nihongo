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

    expect(repository.createRandom).toHaveBeenCalledWith({
      level: 'N5',
      subject: 'VOCABULARY',
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
    'Slice 3에서 %s 모드를 fail closed한다',
    async (mode) => {
      const repository = createRepository()
      const service = createStudySessionService(repository)

      await expect(
        service.create({ ...request, mode }, owner)
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        retryable: false
      } satisfies Partial<ApplicationError>)
      expect(repository.createRandom).not.toHaveBeenCalled()
    }
  )

  it('명시 문제 ID를 Slice 3에서 fail closed한다', async () => {
    const repository = createRepository()
    const service = createStudySessionService(repository)

    await expect(
      service.create({ ...request, explicitQuestionIds: [QUESTION_ID] }, owner)
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(repository.createRandom).not.toHaveBeenCalled()
  })

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
        createRepository({ createRandom: async () => Promise.reject(error) })
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
