import { describe, expect, it, vi } from 'vitest'
import { ApplicationError } from '../errors/applicationError.js'
import { createWrongNoteService } from './wrongNoteService.js'
import {
  WrongNoteRepositoryIntegrityError,
  WrongNoteRepositoryUnavailableError,
  type WrongNoteReadRecord,
  type WrongNoteRepository
} from './wrongNoteRepository.js'

const USER_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10d2'
const QUESTION_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1'

const record: WrongNoteReadRecord = {
  id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10d1',
  questionId: QUESTION_ID,
  currentReviewQuestionVersionId: null,
  wrongCount: 1,
  correctStreak: 0,
  status: 'NEW',
  lastWrongAt: new Date('2026-08-15T00:00:00.000Z'),
  lastReviewedAt: null,
  nextReviewAt: new Date('2026-08-16T00:00:00.000Z'),
  questionLifecycleStatus: 'ACTIVE',
  currentPublishedVersionStatus: 'PUBLISHED',
  question: {
    id: QUESTION_ID,
    questionVersionId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a2',
    level: 'N5',
    subject: 'VOCABULARY',
    questionType: 'KANJI_READING',
    questionText: '川の読み方',
    tags: [
      {
        id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10c1',
        label: '한자 읽기'
      }
    ]
  }
}

const createRepository = (): WrongNoteRepository => ({
  findOwnedDetail: vi.fn().mockResolvedValue(null),
  listOwned: vi.fn().mockResolvedValue({
    items: [record],
    total: 1,
    availableTagLabels: ['한자 읽기']
  })
})

describe('WrongNote service', () => {
  it('actor와 canonical historical tag filter만 repository에 전달한다', async () => {
    const repository = createRepository()
    const service = createWrongNoteService(repository)

    await service.listWrongNotes(USER_ID, {
      page: 1,
      pageSize: 20,
      sort: 'RECENT',
      tag: '  Ｉ\tTag  '
    })

    expect(repository.listOwned).toHaveBeenCalledWith({
      userId: USER_ID,
      page: 1,
      pageSize: 20,
      sort: 'RECENT',
      tag: 'Ｉ\tTag'
    })
  })

  it('foreign과 missing detail을 구별하지 않는 404로 닫는다', async () => {
    const repository = createRepository()
    const service = createWrongNoteService(repository)

    await expect(
      service.getWrongNote(USER_ID, QUESTION_ID)
    ).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      retryable: false
    })
  })

  it('repository unavailable과 integrity 오류를 closed mapping한다', async () => {
    const unavailableRepository = createRepository()
    vi.mocked(unavailableRepository.listOwned).mockRejectedValue(
      new WrongNoteRepositoryUnavailableError({
        cause: new Error('database unavailable')
      })
    )
    const integrityRepository = createRepository()
    vi.mocked(integrityRepository.listOwned).mockRejectedValue(
      new WrongNoteRepositoryIntegrityError('unsafe bigint')
    )

    await expect(
      createWrongNoteService(unavailableRepository).listWrongNotes(USER_ID, {
        page: 1,
        pageSize: 20,
        sort: 'RECENT'
      })
    ).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      retryable: true
    } satisfies Partial<ApplicationError>)
    await expect(
      createWrongNoteService(integrityRepository).listWrongNotes(USER_ID, {
        page: 1,
        pageSize: 20,
        sort: 'RECENT'
      })
    ).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      retryable: true
    } satisfies Partial<ApplicationError>)
  })
})
