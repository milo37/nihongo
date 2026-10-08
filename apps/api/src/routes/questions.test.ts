import { apiFailureSchema } from '@nihongo/contracts/common/error'
import type { GetQuestionResponse } from '@nihongo/contracts/question/get-question'
import type {
  ListQuestionsResponse,
  ParsedListQuestionsQuery
} from '@nihongo/contracts/question/list-questions'
import { describe, expect, it, vi } from 'vitest'
import { createApiApp } from '../app/createApp.js'
import type { ApiEnvironment } from '../config/env.js'
import { ApplicationError } from '../errors/applicationError.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import { createJsonLogger } from '../observability/logger.js'
import type { QuestionReader } from '../question/questionService.js'

const QUESTION_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1'
const VERSION_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a2'

const environment = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: 3001,
  DATABASE_URL: 'postgresql://localhost/nihongo_test',
  TRUSTED_ORIGINS: ['http://localhost:5173'],
  LOG_LEVEL: 'silent',
  BETTER_AUTH_SECRET: 'auth-secret-that-is-at-least-32-characters',
  BETTER_AUTH_URL: 'http://localhost:3001',
  GUEST_COOKIE_SECRET: 'guest-secret-that-is-at-least-32-characters',
  AUTH_EMAIL_FROM: 'auth@example.test',
  AUTH_EMAIL_DELIVERY_MODE: 'test-sink',
  AUTH_TRUSTED_PROXY_CIDRS: ['10.0.0.0/8']
} satisfies ApiEnvironment

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

const createRateLimiter = (): ApplicationRateLimiter => ({
  consume: vi.fn().mockResolvedValue(undefined)
})

const createTestApp = (
  questionReader = createReader(),
  rateLimiter = createRateLimiter(),
  routeEnvironment = environment
) =>
  createApiApp({
    checkReadiness: vi.fn().mockResolvedValue(undefined),
    logger: createJsonLogger('silent'),
    questionReader,
    questionReadSecurity: {
      environment: routeEnvironment,
      rateLimiter
    }
  })

describe('question routes', () => {
  it('canonical list query와 response를 연결한다', async () => {
    const listQuestions = vi.fn(
      async (_query: ParsedListQuestionsQuery) => listResponse
    )
    const rateLimiter = createRateLimiter()
    const response = await createTestApp(
      createReader({ listQuestions }),
      rateLimiter
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
    expect(rateLimiter.consume).toHaveBeenCalledWith({
      clientIp: 'unresolved',
      max: 120,
      operation: 'question-list-read',
      windowMs: 60_000
    })
  })

  it('canonical detail response를 반환한다', async () => {
    const rateLimiter = createRateLimiter()
    const response = await createTestApp(createReader(), rateLimiter).request(
      `/api/v1/questions/${QUESTION_ID}`
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(question)
    expect(rateLimiter.consume).toHaveBeenCalledWith({
      clientIp: 'unresolved',
      max: 120,
      operation: 'question-detail-read',
      windowMs: 60_000
    })
  })

  it('잘못된 query와 path ID를 422 계약으로 반환한다', async () => {
    const questionReader = createReader()
    const rateLimiter = createRateLimiter()
    const app = createTestApp(questionReader, rateLimiter)
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
    expect(rateLimiter.consume).toHaveBeenCalledTimes(2)
    expect(questionReader.listQuestions).not.toHaveBeenCalled()
    expect(questionReader.getQuestion).not.toHaveBeenCalled()
  })

  it('rate limit이 잘못된 query와 ID 검증보다 먼저 429를 반환하고 reader를 호출하지 않는다', async () => {
    const questionReader = createReader()
    const rateLimiter: ApplicationRateLimiter = {
      consume: vi.fn().mockRejectedValue(
        new ApplicationError({
          code: 'RATE_LIMITED',
          message: '요청이 너무 많습니다.',
          retryable: true,
          retryAfterSeconds: 17
        })
      )
    }
    const app = createTestApp(questionReader, rateLimiter)

    const [queryResponse, idResponse] = await Promise.all([
      app.request('/api/v1/questions?page=0'),
      app.request('/api/v1/questions/not-a-uuid')
    ])

    for (const response of [queryResponse, idResponse]) {
      const payload = apiFailureSchema.parse(await response.json())
      expect(response.status).toBe(429)
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('Retry-After')).toBe('17')
      expect(response.headers.get('X-Request-Id')).toBe(payload.requestId)
      expect(payload).toMatchObject({ code: 'RATE_LIMITED', retryable: true })
    }

    expect(questionReader.listQuestions).not.toHaveBeenCalled()
    expect(questionReader.getQuestion).not.toHaveBeenCalled()
  })

  it('rate limit 저장소 장애를 503으로 닫고 reader를 호출하지 않는다', async () => {
    const questionReader = createReader()
    const rateLimiter: ApplicationRateLimiter = {
      consume: vi.fn().mockRejectedValue(
        new ApplicationError({
          code: 'SERVICE_UNAVAILABLE',
          message: '요청 제한 저장소에 연결할 수 없습니다.',
          retryable: true,
          retryAfterSeconds: 5
        })
      )
    }
    const response = await createTestApp(questionReader, rateLimiter).request(
      '/api/v1/questions'
    )
    const payload = apiFailureSchema.parse(await response.json())

    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBe('5')
    expect(payload).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      retryable: true
    })
    expect(questionReader.listQuestions).not.toHaveBeenCalled()
  })

  it('trusted proxy chain만 사용하고 spoofed forwarding/internal header를 무시한다', async () => {
    const rateLimiter = createRateLimiter()
    const app = createTestApp(createReader(), rateLimiter)
    const createBindings = (remoteAddress: string) =>
      ({
        incoming: {
          socket: {
            remoteAddress,
            remoteFamily: 'IPv4',
            remotePort: 12_345
          }
        }
      }) as never

    await app.fetch(
      new Request('http://localhost:3001/api/v1/questions', {
        headers: { 'X-Forwarded-For': '198.51.100.7' }
      }),
      createBindings('10.0.0.2')
    )
    await app.fetch(
      new Request('http://localhost:3001/api/v1/questions', {
        headers: {
          'X-Forwarded-For': '198.51.100.8',
          'X-Nihongo-Client-Ip': '203.0.113.9'
        }
      }),
      createBindings('192.0.2.10')
    )

    expect(rateLimiter.consume).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        clientIp: '198.51.100.7',
        operation: 'question-list-read'
      })
    )
    expect(rateLimiter.consume).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        clientIp: '192.0.2.10',
        operation: 'question-list-read'
      })
    )
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
