import { apiFailureSchema } from '@nihongo/contracts/common/error'
import type { GetQuestionResponse } from '@nihongo/contracts/question/get-question'
import type {
  ListQuestionsResponse,
  ParsedListQuestionsQuery
} from '@nihongo/contracts/question/list-questions'
import { describe, expect, it, vi } from 'vitest'
import { createApiApp } from '../app/createApp.js'
import { ApplicationError } from '../errors/applicationError.js'
import { createJsonLogger } from '../observability/logger.js'
import type { QuestionReader } from '../question/questionService.js'

const QUESTION_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1'
const VERSION_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a2'

const question = {
  id: QUESTION_ID,
  questionVersionId: VERSION_ID,
  level: 'N5',
  subject: 'VOCABULARY',
  questionType: 'KANJI_READING',
  passage: null,
  questionText: '「川」の読み方はどれですか。',
  options: ['かわ', 'やま', 'うみ', 'そら'].map((text, index) => ({
    id: `018f6b7a-1f4b-7d5e-8a91-4c27df9c10b${index}`,
    label: String(index + 1) as '1' | '2' | '3' | '4',
    text
  })),
  difficulty: 'EASY',
  tags: [
    {
      id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10c1',
      label: '한자 읽기'
    }
  ]
} satisfies GetQuestionResponse

const listResponse = {
  items: [
    {
      id: question.id,
      questionVersionId: question.questionVersionId,
      level: question.level,
      subject: question.subject,
      questionType: question.questionType,
      difficulty: question.difficulty,
      questionTextPreview: question.questionText,
      tags: question.tags
    }
  ],
  page: 1,
  pageSize: 20,
  total: 1
} satisfies ListQuestionsResponse

const createReader = (
  overrides: Partial<QuestionReader> = {}
): QuestionReader => ({
  getQuestion: vi.fn().mockResolvedValue(question),
  listQuestions: vi.fn().mockResolvedValue(listResponse),
  ...overrides
})

const createTestApp = (questionReader = createReader()) =>
  createApiApp({
    checkReadiness: vi.fn().mockResolvedValue(undefined),
    logger: createJsonLogger('silent'),
    questionReader
  })

describe('question routes', () => {
  it('canonical list query와 response를 연결한다', async () => {
    const listQuestions = vi.fn(
      async (_query: ParsedListQuestionsQuery) => listResponse
    )
    const response = await createTestApp(
      createReader({ listQuestions })
    ).request('/api/v1/questions?level=N5&page=1&pageSize=20')

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/)
    expect(await response.json()).toEqual(listResponse)
    expect(listQuestions).toHaveBeenCalledWith({
      level: 'N5',
      page: 1,
      pageSize: 20
    })
  })

  it('canonical detail response를 반환한다', async () => {
    const response = await createTestApp().request(
      `/api/v1/questions/${QUESTION_ID}`
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(question)
  })

  it('잘못된 query와 path ID를 422 계약으로 반환한다', async () => {
    const app = createTestApp()
    const [queryResponse, idResponse] = await Promise.all([
      app.request('/api/v1/questions?page=0'),
      app.request('/api/v1/questions/not-a-uuid')
    ])
    const queryPayload = apiFailureSchema.parse(await queryResponse.json())
    const idPayload = apiFailureSchema.parse(await idResponse.json())

    for (const [response, payload] of [
      [queryResponse, queryPayload],
      [idResponse, idPayload]
    ] as const) {
      expect(response.status).toBe(422)
      expect(response.headers.get('X-Request-Id')).toBe(payload.requestId)
      expect(payload.retryable).toBe(false)
    }

    expect(queryPayload.code).toBe('VALIDATION_ERROR')
    expect(idPayload.code).toBe('INVALID_ID')
  })

  it('일시적 저장소 장애에 Retry-After를 제공한다', async () => {
    const response = await createTestApp(
      createReader({
        listQuestions: async () =>
          Promise.reject(
            new ApplicationError({
              code: 'SERVICE_UNAVAILABLE',
              message: '저장소에 연결할 수 없습니다.',
              retryable: true
            })
          )
      })
    ).request('/api/v1/questions')
    const payload = apiFailureSchema.parse(await response.json())

    expect(response.status).toBe(503)
    expect(payload.code).toBe('SERVICE_UNAVAILABLE')
    expect(response.headers.get('Retry-After')).toBe('5')
  })
})
