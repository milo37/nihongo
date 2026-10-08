import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StudySessionView } from '@app/practice/adapters/studySessionView'
import {
  getStudySubmissionRetryDelay,
  isDefinitiveStudySubmissionError,
  isRetryableStudySubmissionError,
  StudySubmissionPreTransportError
} from '@app/practice/studySubmissionRetry'
import {
  clearAllSubmissionAttempts,
  clearSubmissionAttempt,
  clearSubmissionAttemptMemoryCache,
  getOrCreateCanonicalSubmissionAttempt,
  getSubmissionAttemptStorageKey
} from '@app/practice/submissionAttempt'
import { cachedSessionStorage } from '@libs/storage'

const createSessionView = (): StudySessionView => {
  const firstQuestionId = crypto.randomUUID()
  const secondQuestionId = crypto.randomUUID()

  return {
    session: {
      id: crypto.randomUUID(),
      level: 'N3',
      subject: 'GRAMMAR',
      mode: 'RANDOM',
      status: 'IN_PROGRESS',
      startedAt: '2026-08-16T00:00:00.000Z',
      expiresAt: '2026-08-17T00:00:00.000Z',
      submittedAt: null,
      durationSec: null,
      practiceContractVersion: 1
    },
    questions: [
      {
        id: firstQuestionId,
        sessionQuestionId: crypto.randomUUID(),
        questionVersionId: crypto.randomUUID(),
        ordinal: 1,
        level: 'N3',
        subject: 'GRAMMAR',
        questionType: 'GRAMMAR_SELECT',
        passage: null,
        questionText: '첫 번째 문제',
        options: [1, 2, 3, 4].map((value) => ({
          id: crypto.randomUUID(),
          label: String(value) as '1' | '2' | '3' | '4',
          text: `${value}번 보기`
        })),
        difficulty: 'NORMAL',
        tags: ['문법']
      },
      {
        id: secondQuestionId,
        sessionQuestionId: crypto.randomUUID(),
        questionVersionId: crypto.randomUUID(),
        ordinal: 2,
        level: 'N3',
        subject: 'GRAMMAR',
        questionType: 'GRAMMAR_SELECT',
        passage: null,
        questionText: '두 번째 문제',
        options: [1, 2, 3, 4].map((value) => ({
          id: crypto.randomUUID(),
          label: String(value) as '1' | '2' | '3' | '4',
          text: `${value}번 보기`
        })),
        difficulty: 'NORMAL',
        tags: ['문법']
      }
    ],
    requestedCount: 2,
    actualCount: 2,
    usedFallback: false,
    fallbackReason: null
  }
}

describe('canonical study submission attempt', () => {
  beforeEach(() => clearAllSubmissionAttempts())

  it('maps logical question IDs to ordinal session-question IDs and includes unanswered null', () => {
    const session = createSessionView()
    const answeredQuestion = session.questions[0]
    const selectedOptionId = answeredQuestion.options[1].id
    const attempt = getOrCreateCanonicalSubmissionAttempt(
      session.session.id,
      {
        answers: [
          {
            questionId: answeredQuestion.id,
            selectedOptionId,
            elapsedSec: 12
          }
        ],
        durationSec: 20
      },
      session
    )

    expect(attempt.canonicalBody.answers).toEqual([
      {
        studySessionQuestionId: session.questions[0].sessionQuestionId,
        selectedOptionId,
        elapsedSec: 12
      },
      {
        studySessionQuestionId: session.questions[1].sessionQuestionId,
        selectedOptionId: null,
        elapsedSec: 0
      }
    ])
    expect(attempt.canonicalBody.answers[0].studySessionQuestionId).not.toBe(
      answeredQuestion.id
    )
  })

  it('reuses the exact persisted body and UUID when only timer values drift', () => {
    const session = createSessionView()
    const input = {
      answers: [
        {
          questionId: session.questions[0].id,
          selectedOptionId: session.questions[0].options[0].id,
          elapsedSec: 8
        }
      ],
      durationSec: 15
    }
    const first = getOrCreateCanonicalSubmissionAttempt(
      session.session.id,
      input,
      session
    )
    const serialized = window.sessionStorage.getItem(
      getSubmissionAttemptStorageKey(session.session.id)
    )

    clearSubmissionAttemptMemoryCache()
    const retried = getOrCreateCanonicalSubmissionAttempt(
      session.session.id,
      {
        answers: input.answers.map((answer) => ({
          ...answer,
          elapsedSec: answer.elapsedSec + 9
        })),
        durationSec: input.durationSec + 18
      },
      session
    )

    expect(serialized).not.toBeNull()
    expect(retried).toEqual(first)
    expect(retried.idempotencyKey).toBe(first.idempotencyKey)
    expect(retried.canonicalBody).toEqual(first.canonicalBody)
  })

  it('keeps a frozen attempt authoritative until terminal cleanup, then rotates for a changed selection', () => {
    const session = createSessionView()
    const baseInput = {
      answers: [
        {
          questionId: session.questions[0].id,
          selectedOptionId: session.questions[0].options[0].id,
          elapsedSec: 8
        }
      ],
      durationSec: 15
    }
    const first = getOrCreateCanonicalSubmissionAttempt(
      session.session.id,
      baseInput,
      session
    )
    const stillFrozen = getOrCreateCanonicalSubmissionAttempt(
      session.session.id,
      {
        ...baseInput,
        answers: [
          {
            ...baseInput.answers[0],
            selectedOptionId: session.questions[0].options[1].id
          }
        ]
      },
      session
    )

    expect(stillFrozen).toEqual(first)

    clearSubmissionAttempt(session.session.id)
    const changedAfterCleanup = getOrCreateCanonicalSubmissionAttempt(
      session.session.id,
      {
        ...baseInput,
        answers: [
          {
            ...baseInput.answers[0],
            selectedOptionId: session.questions[0].options[1].id
          }
        ]
      },
      session
    )

    expect(changedAfterCleanup.idempotencyKey).not.toBe(first.idempotencyKey)
    expect(changedAfterCleanup.canonicalBody.answers[0].selectedOptionId).toBe(
      session.questions[0].options[1].id
    )

    clearSubmissionAttempt(session.session.id)
    expect(
      window.sessionStorage.getItem(
        getSubmissionAttemptStorageKey(session.session.id)
      )
    ).toBeNull()
  })

  it('keeps retryable failures frozen and treats terminal failures as non-retryable', () => {
    expect(
      isRetryableStudySubmissionError(
        Object.assign(new Error('timeout'), { isNetworkError: true })
      )
    ).toBe(true)
    expect(
      isRetryableStudySubmissionError(
        Object.assign(new Error('service unavailable'), {
          code: 'SERVICE_UNAVAILABLE',
          status: 503
        })
      )
    ).toBe(true)
    expect(
      isRetryableStudySubmissionError(
        Object.assign(new Error('invalid option'), {
          code: 'OPTION_NOT_IN_VERSION',
          status: 422
        })
      )
    ).toBe(false)
    expect(
      isDefinitiveStudySubmissionError(
        Object.assign(new Error('invalid option'), {
          code: 'OPTION_NOT_IN_VERSION',
          status: 422
        })
      )
    ).toBe(true)
    expect(
      isDefinitiveStudySubmissionError(
        Object.assign(new Error('malformed success'), {
          isResponseValidationError: true,
          isValidationError: true,
          status: 422
        })
      )
    ).toBe(false)
  })

  it('honors Retry-After and bounds the fallback submission retry delay', () => {
    expect(
      getStudySubmissionRetryDelay(
        0,
        Object.assign(new Error('rate limited'), {
          retryAfterMs: 4_000,
          status: 429
        })
      )
    ).toBe(4_000)
    expect(getStudySubmissionRetryDelay(0, new Error('network'))).toBe(1_000)
    expect(getStudySubmissionRetryDelay(8, new Error('network'))).toBe(10_000)
  })

  it('fails closed before transport when durable attempt storage is unavailable', () => {
    const session = createSessionView()
    vi.spyOn(cachedSessionStorage, 'setItem').mockReturnValueOnce(false)

    expect(() =>
      getOrCreateCanonicalSubmissionAttempt(
        session.session.id,
        { answers: [], durationSec: 3 },
        session
      )
    ).toThrow('답안을 전송하지 않았습니다')
    expect(
      window.sessionStorage.getItem(
        getSubmissionAttemptStorageKey(session.session.id)
      )
    ).toBeNull()
  })

  it('classifies a pre-transport failure as definitive without treating it as an ambiguous commit', () => {
    expect(
      isDefinitiveStudySubmissionError(
        new StudySubmissionPreTransportError(new Error('storage unavailable'))
      )
    ).toBe(true)
  })
})
