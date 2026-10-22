import { describe, expect, it, vi } from 'vitest'
import { ApplicationError } from '../errors/applicationError.js'
import {
  BookmarkQuestionNotAvailableError,
  BookmarkQuestionNotFoundError,
  BookmarkRepositoryIntegrityError,
  BookmarkRepositoryUnavailableError,
  type BookmarkReadRecord,
  type BookmarkRepository
} from './bookmarkRepository.js'
import { createBookmarkService } from './bookmarkService.js'

const USER_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c1001'
const QUESTION_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c1002'
const CREATED_AT = new Date('2026-08-21T00:00:00.000Z')

const bookmarkRecord: BookmarkReadRecord = {
  id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c1003',
  questionId: QUESTION_ID,
  availability: 'AVAILABLE',
  createdAt: CREATED_AT,
  question: {
    id: QUESTION_ID,
    questionVersionId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c1004',
    level: 'N5',
    subject: 'VOCABULARY',
    questionType: 'KANJI_READING',
    difficulty: 'EASY',
    questionText: '「川」の読み方はどれですか。',
    tags: [
      {
        id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c1005',
        label: '한자 읽기'
      }
    ]
  }
}

const createRepository = (
  overrides: Partial<BookmarkRepository> = {}
): BookmarkRepository => ({
  createOwned: vi.fn().mockResolvedValue({
    bookmark: bookmarkRecord,
    created: true
  }),
  deleteOwned: vi.fn().mockResolvedValue(undefined),
  listOwned: vi.fn().mockResolvedValue({
    items: [bookmarkRecord],
    total: 1
  }),
  ...overrides
})

describe('bookmarkService', () => {
  it('create의 서버 시간·ID를 repository에 전달하고 safe summary를 반환한다', async () => {
    const repository = createRepository()
    const service = createBookmarkService(
      repository,
      () => CREATED_AT,
      () => bookmarkRecord.id
    )

    await expect(service.create(USER_ID, QUESTION_ID)).resolves.toEqual({
      created: true,
      bookmark: {
        questionId: QUESTION_ID,
        availability: 'AVAILABLE',
        createdAt: CREATED_AT.toISOString(),
        question: expect.objectContaining({
          id: QUESTION_ID,
          questionTextPreview: '「川」の読み方はどれですか。'
        })
      }
    })
    expect(repository.createOwned).toHaveBeenCalledWith({
      id: bookmarkRecord.id,
      userId: USER_ID,
      questionId: QUESTION_ID,
      createdAt: CREATED_AT
    })
  })

  it('list의 owner/filter/page를 보존하고 ARCHIVED 항목도 숨기지 않는다', async () => {
    const archived = { ...bookmarkRecord, availability: 'ARCHIVED' as const }
    const repository = createRepository({
      listOwned: vi.fn().mockResolvedValue({ items: [archived], total: 1 })
    })
    const service = createBookmarkService(repository)

    const result = await service.list(USER_ID, {
      page: 2,
      pageSize: 5,
      questionIds: [QUESTION_ID]
    })

    expect(repository.listOwned).toHaveBeenCalledWith({
      userId: USER_ID,
      page: 2,
      pageSize: 5,
      questionIds: [QUESTION_ID]
    })
    expect(result).toMatchObject({
      page: 2,
      pageSize: 5,
      total: 1,
      items: [{ availability: 'ARCHIVED', questionId: QUESTION_ID }]
    })
  })

  it('delete는 owner-scoped repository 결과와 무관하게 성공한다', async () => {
    const repository = createRepository()
    const service = createBookmarkService(repository)

    await expect(service.delete(USER_ID, QUESTION_ID)).resolves.toBeUndefined()
    expect(repository.deleteOwned).toHaveBeenCalledWith(USER_ID, QUESTION_ID)
  })

  it.each([
    [new BookmarkQuestionNotFoundError(), 'RESOURCE_NOT_FOUND', false],
    [new BookmarkQuestionNotAvailableError(), 'QUESTION_NOT_AVAILABLE', false],
    [new BookmarkRepositoryUnavailableError({}), 'SERVICE_UNAVAILABLE', true],
    [
      new BookmarkRepositoryIntegrityError('broken'),
      'INTERNAL_SERVER_ERROR',
      true
    ]
  ] as const)(
    'repository 오류를 stable API 오류로 매핑한다',
    async (error, code, retryable) => {
      const service = createBookmarkService(
        createRepository({ createOwned: vi.fn().mockRejectedValue(error) })
      )

      await expect(service.create(USER_ID, QUESTION_ID)).rejects.toMatchObject({
        code,
        retryable
      } satisfies Partial<ApplicationError>)
    }
  )
})
