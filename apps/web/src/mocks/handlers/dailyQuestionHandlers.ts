import { http, HttpResponse } from 'msw'
import {
  getDailyQuestionErrorSchema,
  getDailyQuestionQuerySchema,
  getDailyQuestionResponseSchema,
  type GetDailyQuestionError
} from '@nihongo/contracts/question/get-daily-question'
import { GUEST_DAY_UTC_OFFSET_MINUTES } from '@nihongo/contracts/study/guest-limits'
import {
  getQuestionContractIdentity,
  getQuestionVersionFingerprint,
  toContractPracticeQuestion,
  toStableMockUuid
} from '@mocks/adapters/questionContractAdapter'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { MockHttpError, parseSearchParams } from '@mocks/handlers/shared'

const DAY_MS = 24 * 60 * 60 * 1000
const OFFSET_MS = GUEST_DAY_UTC_OFFSET_MINUTES * 60 * 1000

const errorResponse = (body: GetDailyQuestionError, status: number) =>
  HttpResponse.json(getDailyQuestionErrorSchema.parse(body), { status })

// Like the server (JLP-815): one published vocabulary or grammar question
// per level, picked by the Korean date, the same for everyone.
export const dailyQuestionHandlers = [
  http.get('*/api/v1/daily-question', ({ request }) => {
    const requestId = crypto.randomUUID()
    try {
      const { level } = parseSearchParams(request, getDailyQuestionQuerySchema)
      const now = Date.now()
      const day = Math.floor((now + OFFSET_MS) / DAY_MS)
      const date = new Date(day * DAY_MS).toISOString().slice(0, 10)
      const candidates = mockDatabase
        .listCanonicalPublicQuestionRecords({ level })
        .filter((question) => question.subject !== 'READING')
        .toSorted((left, right) => left.id.localeCompare(right.id))
      const source = candidates[day % Math.max(1, candidates.length)]
      if (!source) {
        return errorResponse(
          {
            code: 'NO_ELIGIBLE_QUESTIONS',
            message: '오늘의 문제를 낼 수 없습니다.',
            requestId,
            retryable: false
          },
          422
        )
      }
      const fingerprint = getQuestionVersionFingerprint(source)
      const identity = getQuestionContractIdentity(source)
      const correct = source.options.find((option) => option.isCorrect)
      const response = getDailyQuestionResponseSchema.parse({
        date,
        level,
        question: {
          ...toContractPracticeQuestion(source, fingerprint, identity),
          correctOptionId:
            identity?.optionIdBySourceId[correct?.id ?? ''] ??
            toStableMockUuid(
              'question-option',
              `${correct?.id}:${fingerprint}`
            ),
          explanationKo: source.explanationKo,
          explanationJa: source.explanationJa
        }
      })
      return HttpResponse.json(response, {
        headers: { 'Cache-Control': 'public, max-age=300' }
      })
    } catch (error: unknown) {
      if (error instanceof MockHttpError) {
        return errorResponse(
          {
            code: 'VALIDATION_ERROR',
            message: error.message,
            requestId,
            retryable: false
          },
          400
        )
      }
      throw error
    }
  })
]
