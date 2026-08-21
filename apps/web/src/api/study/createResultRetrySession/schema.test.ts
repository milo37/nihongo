import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createResultRetrySessionTransportResponseSchema } from '@api/study/createResultRetrySession/schema'

const sessionId = randomUUID()
const questionId = randomUUID()
const questionVersionId = randomUUID()
const response = {
  status: 201,
  headers: {
    'cache-control': 'private, no-store',
    'content-type': 'application/json; charset=UTF-8',
    'idempotency-replayed': null,
    location: `/api/v1/study-sessions/${sessionId}`,
    'x-nihongo-practice-contract': '2'
  },
  data: {
    session: {
      id: sessionId,
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'WRONG_NOTE',
      status: 'IN_PROGRESS',
      requestedCount: 1,
      actualCount: 1,
      usedFallback: false,
      fallbackReason: null,
      startedAt: '2026-08-21T15:00:00.000Z',
      expiresAt: '2026-08-22T15:00:00.000Z',
      submittedAt: null,
      durationSec: null,
      practiceContractVersion: 2
    },
    questions: [
      {
        sessionQuestionId: randomUUID(),
        ordinal: 1,
        question: {
          id: questionId,
          questionVersionId,
          level: 'N5',
          subject: 'VOCABULARY',
          questionType: 'KANJI_READING',
          passage: null,
          questionText: 'retry transport fixture',
          options: Array.from({ length: 4 }, (_, index) => ({
            id: randomUUID(),
            label: String(index + 1),
            text: `보기 ${index + 1}`
          })),
          difficulty: 'EASY',
          tags: [{ id: randomUUID(), label: '재도전' }]
        }
      }
    ]
  }
} as const

describe('create result retry transport schema', () => {
  it('first와 replay 201의 exact Location/contract metadata를 허용한다', () => {
    expect(
      createResultRetrySessionTransportResponseSchema.parse(response)
    ).toMatchObject({ headers: { 'idempotency-replayed': null } })
    expect(
      createResultRetrySessionTransportResponseSchema.parse({
        ...response,
        headers: { ...response.headers, 'idempotency-replayed': 'true' }
      })
    ).toMatchObject({ headers: { 'idempotency-replayed': 'true' } })
  })

  it.each([
    null,
    '/api/v1/study-sessions/not-the-target',
    `/api/v1/study-sessions/${sessionId}/result`
  ])('foreign Location %s를 거부한다', (location) => {
    expect(() =>
      createResultRetrySessionTransportResponseSchema.parse({
        ...response,
        headers: { ...response.headers, location }
      })
    ).toThrow()
  })
})
