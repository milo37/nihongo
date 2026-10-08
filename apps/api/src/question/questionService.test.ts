import { describe, expect, it, vi } from 'vitest'
import { ApplicationError } from '../errors/applicationError.js'
import {
  QuestionRepositoryUnavailableError,
  type PublishedQuestionDetailRecord,
  type QuestionRepository
} from './questionRepository.js'
import { createQuestionService } from './questionService.js'

const QUESTION_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1'
const VERSION_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a2'

const detail: PublishedQuestionDetailRecord = {
  id: QUESTION_ID,
  questionVersionId: VERSION_ID,
  level: 'N3',
  subject: 'GRAMMAR',
  questionType: 'GRAMMAR_SELECT',
  passage: null,
  questionText: '会議が始まる前に、資料を確認しておきましょう。',
  difficulty: 'NORMAL',
  options: ['までに', 'ほど', 'しか', 'さえ'].map((text, index) => ({
    id: `018f6b7a-1f4b-7d5e-8a91-4c27df9c10b${index}`,
    label: String(index + 1),
    text
  })),
  tags: [
    {
      id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10c1',
      label: '문법 선택'
    }
  ]
}

const createRepository = (
  overrides: Partial<QuestionRepository> = {}
): QuestionRepository => ({
  findPublishedById: vi.fn().mockResolvedValue(detail),
  listPublished: vi.fn().mockResolvedValue({ items: [detail], total: 1 }),
  ...overrides
})

describe('questionService', () => {
  it('공개 detail과 summary만 매핑한다', async () => {
    const service = createQuestionService(createRepository())
    const question = await service.getQuestion(QUESTION_ID)
    const page = await service.listQuestions({ page: 1, pageSize: 20 })

    expect(question.options).toHaveLength(4)
    expect(question).not.toHaveProperty('explanationKo')
    expect(page.items[0]).not.toHaveProperty('options')
    expect(page.items[0]).not.toHaveProperty('passage')
  })

  it('tag를 정규화해 repository에 전달한다', async () => {
    const repository = createRepository()
    const service = createQuestionService(repository)

    await service.listQuestions({
      tag: '  문법   선택 ',
      page: 2,
      pageSize: 5
    })

    expect(repository.listPublished).toHaveBeenCalledWith({
      normalizedTag: '문법 선택',
      page: 2,
      pageSize: 5
    })
  })

  it('공개 대상이 아닌 문제를 404로 숨긴다', async () => {
    const service = createQuestionService(
      createRepository({ findPublishedById: async () => null })
    )

    await expect(service.getQuestion(QUESTION_ID)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      retryable: false
    } satisfies Partial<ApplicationError>)
  })

  it('DB 연결 장애를 retry 가능한 503 오류로 바꾼다', async () => {
    const service = createQuestionService(
      createRepository({
        listPublished: async () =>
          Promise.reject(
            new QuestionRepositoryUnavailableError({
              cause: new Error('connection failed')
            })
          )
      })
    )

    await expect(
      service.listQuestions({ page: 1, pageSize: 20 })
    ).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      retryable: true
    } satisfies Partial<ApplicationError>)
  })
})
