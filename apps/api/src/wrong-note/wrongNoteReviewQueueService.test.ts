import { describe, expect, it, vi } from 'vitest'
import { ApplicationError } from '../errors/applicationError.js'
import {
  WrongNoteReviewQueueRepositoryIntegrityError,
  WrongNoteReviewQueueRepositoryUnavailableError,
  type WrongNoteReviewQueueRepository
} from './wrongNoteReviewQueueRepository.js'
import { createWrongNoteReviewQueueService } from './wrongNoteReviewQueueService.js'

const USER_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c1001'
const QUESTION_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c1002'
const VERSION_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c1003'
const OBSERVED_AT = new Date('2026-08-22T12:00:00.000Z')

const createRepository = (): WrongNoteReviewQueueRepository => ({
  listOwned: vi.fn().mockResolvedValue({
    observedAt: OBSERVED_AT,
    total: 1,
    counts: { due: 1, unreviewed: 1, repeated: 0, solved: 0 },
    availableTags: ['한자 읽기'],
    items: [
      {
        questionId: QUESTION_ID,
        currentQuestionVersionId: VERSION_ID,
        level: 'N5',
        subject: 'VOCABULARY',
        questionType: 'KANJI_READING',
        questionPreview: '가'.repeat(200),
        tags: ['한자 읽기'],
        status: 'NEW',
        wrongCount: 1,
        correctStreak: 0,
        lastWrongAt: new Date('2026-08-21T12:00:00.000Z'),
        lastReviewedAt: null,
        nextReviewAt: OBSERVED_AT,
        hasMemo: false
      }
    ]
  })
})

describe('WrongNote review queue service', () => {
  it('서버 시각을 한 번 고정하고 wire DTO만 반환한다', async () => {
    const repository = createRepository()
    const now = vi.fn(() => OBSERVED_AT)
    const service = createWrongNoteReviewQueueService(repository, now)

    const result = await service.listReviewQueue(USER_ID, {
      page: 1,
      pageSize: 20,
      view: 'DUE',
      sort: 'NEXT_REVIEW'
    })

    expect(now).toHaveBeenCalledOnce()
    expect(repository.listOwned).toHaveBeenCalledWith({
      userId: USER_ID,
      observedAt: OBSERVED_AT,
      page: 1,
      pageSize: 20,
      view: 'DUE',
      sort: 'NEXT_REVIEW'
    })
    expect(result.items[0]).toMatchObject({
      questionId: QUESTION_ID,
      currentQuestionVersionId: VERSION_ID,
      nextReviewAt: OBSERVED_AT.toISOString()
    })
    expect([...result.items[0]!.questionPreview]).toHaveLength(160)
    expect(result).not.toHaveProperty('userId')
  })

  it.each([
    [
      new WrongNoteReviewQueueRepositoryUnavailableError({
        cause: new Error('offline')
      }),
      'SERVICE_UNAVAILABLE'
    ],
    [
      new WrongNoteReviewQueueRepositoryIntegrityError('invalid count'),
      'INTERNAL_SERVER_ERROR'
    ]
  ] as const)('repository 오류를 %s로 닫는다', async (error, code) => {
    const repository: WrongNoteReviewQueueRepository = {
      listOwned: async () => Promise.reject(error)
    }
    const service = createWrongNoteReviewQueueService(repository)

    await expect(
      service.listReviewQueue(USER_ID, {
        page: 1,
        pageSize: 20,
        view: 'DUE',
        sort: 'NEXT_REVIEW'
      })
    ).rejects.toMatchObject({ code } satisfies Partial<ApplicationError>)
  })
})
