import {
  getQuestionErrorSchema,
  getQuestionResponseSchema
} from '@nihongo/contracts/question/get-question'
import {
  listQuestionsErrorSchema,
  listQuestionsResponseSchema
} from '@nihongo/contracts/question/list-questions'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getPhase7QuestionContractIdentity } from '@mocks/adapters/questionContractAdapter'
import {
  primeQuestionReadRateLimitForTesting,
  resetQuestionReadRateLimitForTesting
} from '@mocks/handlers/questionHandlers'
import { mockDatabase } from '@mocks/repository/mockDatabase'

const QUESTIONS_URL = 'http://localhost/api/v1/questions'

const expectCanonicalHeaders = (response: Response): void => {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  expect(response.headers.get('X-Request-Id')).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
  )
}

const getPublishedQuestionId = (): string => {
  const source = mockDatabase.listCanonicalPublicQuestionRecords()[0]
  const questionId = source
    ? getPhase7QuestionContractIdentity(source)?.questionId
    : undefined
  if (!questionId) {
    throw new Error('canonical public question fixture가 필요합니다.')
  }
  return questionId
}

afterEach(() => {
  vi.useRealTimers()
})

describe('canonical question read rate limit parity', () => {
  it('list rate를 validation보다 먼저 적용하고 forwarding header로 identity를 바꾸지 않는다', async () => {
    primeQuestionReadRateLimitForTesting('question-list-read', 120)
    const repositoryRead = vi.spyOn(
      mockDatabase,
      'listCanonicalPublicQuestionRecords'
    )

    const response = await fetch(`${QUESTIONS_URL}?page=0`, {
      headers: {
        'X-Forwarded-For': '198.51.100.7',
        'X-Nihongo-Client-Ip': '203.0.113.8'
      }
    })
    const error = listQuestionsErrorSchema.parse(await response.json())

    expect(response.status).toBe(429)
    expectCanonicalHeaders(response)
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(error).toMatchObject({ code: 'RATE_LIMITED', retryable: true })
    expect(repositoryRead).not.toHaveBeenCalled()
  })

  it('detail rate를 ID validation보다 먼저 적용하고 repository read를 막는다', async () => {
    primeQuestionReadRateLimitForTesting('question-detail-read', 120)
    const repositoryRead = vi.spyOn(
      mockDatabase,
      'getCanonicalPublicQuestionRecord'
    )

    const response = await fetch(`${QUESTIONS_URL}/not-a-uuid`)
    const error = getQuestionErrorSchema.parse(await response.json())

    expect(response.status).toBe(429)
    expectCanonicalHeaders(response)
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(error).toMatchObject({ code: 'RATE_LIMITED', retryable: true })
    expect(repositoryRead).not.toHaveBeenCalled()
  })

  it('list와 detail operation window를 분리한다', async () => {
    const questionId = getPublishedQuestionId()
    primeQuestionReadRateLimitForTesting('question-list-read', 120)

    const [listResponse, detailResponse] = await Promise.all([
      fetch(QUESTIONS_URL),
      fetch(`${QUESTIONS_URL}/${questionId}`)
    ])

    expect(listResponse.status).toBe(429)
    expect(detailResponse.status).toBe(200)
    expectCanonicalHeaders(listResponse)
    expectCanonicalHeaders(detailResponse)
    expect(
      getQuestionResponseSchema.parse(await detailResponse.json()).id
    ).toBe(questionId)
  })

  it('invalid traffic도 허용 slot을 소비하고 다음 repository read를 거부한다', async () => {
    primeQuestionReadRateLimitForTesting('question-list-read', 119)
    const repositoryRead = vi.spyOn(
      mockDatabase,
      'listCanonicalPublicQuestionRecords'
    )

    const invalid = await fetch(`${QUESTIONS_URL}?page=0`)
    const denied = await fetch(QUESTIONS_URL)

    expect(invalid.status).toBe(422)
    expect(listQuestionsErrorSchema.parse(await invalid.json()).code).toBe(
      'VALIDATION_ERROR'
    )
    expect(denied.status).toBe(429)
    expect(listQuestionsErrorSchema.parse(await denied.json()).code).toBe(
      'RATE_LIMITED'
    )
    expect(repositoryRead).not.toHaveBeenCalled()
  })

  it('고정 60초 window 마지막 1ms는 거부하고 경계에서 reset한다', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(10_000))
    const questionId = getPublishedQuestionId()
    primeQuestionReadRateLimitForTesting('question-detail-read', 120)

    vi.setSystemTime(new Date(69_999))
    const denied = await fetch(`${QUESTIONS_URL}/${questionId}`)
    expect(denied.status).toBe(429)
    expect(denied.headers.get('Retry-After')).toBe('1')

    vi.setSystemTime(new Date(70_000))
    const allowed = await fetch(`${QUESTIONS_URL}/${questionId}`)
    expect(allowed.status).toBe(200)
    expect(getQuestionResponseSchema.parse(await allowed.json()).id).toBe(
      questionId
    )
  })

  it('canonical mock reset boundary가 list/detail window를 모두 제거한다', async () => {
    const questionId = getPublishedQuestionId()
    primeQuestionReadRateLimitForTesting('question-list-read', 120)
    primeQuestionReadRateLimitForTesting('question-detail-read', 120)
    resetQuestionReadRateLimitForTesting()

    const [listResponse, detailResponse] = await Promise.all([
      fetch(QUESTIONS_URL),
      fetch(`${QUESTIONS_URL}/${questionId}`)
    ])

    expect(listResponse.status).toBe(200)
    expect(detailResponse.status).toBe(200)
    expect(
      listQuestionsResponseSchema.parse(await listResponse.json()).total
    ).toBe(65)
    expect(
      getQuestionResponseSchema.parse(await detailResponse.json()).id
    ).toBe(questionId)
  })
})
