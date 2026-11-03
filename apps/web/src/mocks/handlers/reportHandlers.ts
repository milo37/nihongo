import { HttpResponse, http, type JsonBodyType } from 'msw'
import type { z } from 'zod'
import { errorStatusByCode } from '@nihongo/contracts/common/error'
import {
  createReportErrorSchema,
  createReportRequestSchema,
  createReportResponseSchema,
  listMyReportsErrorSchema,
  listMyReportsQuerySchema,
  listMyReportsResponseSchema,
  type CreateReportResponse
} from '@nihongo/contracts/report/reports'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import {
  QuestionReportRateLimitRepositoryUnavailableError,
  questionReportRateLimitRepository
} from '@mocks/repository/questionReportRateLimitRepository'
import {
  hasTrustedMockWriteOrigin,
  parseJsonBody,
  parseSearchParams
} from '@mocks/handlers/shared'

type ReportFailureCode = z.output<typeof createReportErrorSchema>['code']

const failure = (
  schema: typeof createReportErrorSchema | typeof listMyReportsErrorSchema,
  code: ReportFailureCode,
  message: string
): HttpResponse<JsonBodyType> => {
  const payload = schema.parse({
    code,
    message,
    requestId: crypto.randomUUID(),
    retryable: false
  })
  return HttpResponse.json(payload, {
    status: errorStatusByCode[payload.code],
    headers: { 'Cache-Control': 'private, no-store' }
  })
}

export const resetReportRateLimitForTesting = (): void => {
  questionReportRateLimitRepository.resetForTesting()
}

// Same per-reporter limit as the server (REPORT_ACTOR).
const consumeReportRate = async (
  actorId: string
): Promise<'ALLOWED' | 'RATE_LIMITED' | 'UNAVAILABLE'> => {
  try {
    const { retryAfterSeconds } =
      await questionReportRateLimitRepository.consume({
        actorId,
        group: 'REPORT_ACTOR'
      })
    return retryAfterSeconds === null ? 'ALLOWED' : 'RATE_LIMITED'
  } catch (error: unknown) {
    if (error instanceof QuestionReportRateLimitRepositoryUnavailableError)
      return 'UNAVAILABLE'
    throw error
  }
}

export const reportHandlers = [
  http.post('*/api/v1/reports', async ({ request }) => {
    const user = mockDatabase.getCurrentUser()
    if (!user)
      return failure(
        createReportErrorSchema,
        'AUTHENTICATION_REQUIRED',
        '로그인이 필요합니다.'
      )
    if (mockDatabase.isAccountRestricted(user.id))
      return failure(
        createReportErrorSchema,
        'ACCOUNT_RESTRICTED',
        '임시로 이용이 제한된 계정입니다.'
      )
    if (!hasTrustedMockWriteOrigin(request))
      return failure(
        createReportErrorSchema,
        'UNTRUSTED_ORIGIN',
        '허용되지 않은 요청 출처입니다.'
      )
    const rate = await consumeReportRate(user.id)
    if (rate === 'RATE_LIMITED')
      return failure(
        createReportErrorSchema,
        'RATE_LIMITED',
        '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'
      )
    if (rate === 'UNAVAILABLE')
      return failure(
        createReportErrorSchema,
        'SERVICE_UNAVAILABLE',
        '요청 제한 상태를 확인할 수 없습니다.'
      )
    let body: ReturnType<typeof createReportRequestSchema.parse>
    try {
      body = await parseJsonBody(request, createReportRequestSchema)
    } catch {
      return failure(
        createReportErrorSchema,
        'VALIDATION_ERROR',
        '제보 요청이 올바르지 않습니다.'
      )
    }
    if (
      body.kind === 'QUESTION' &&
      (body.questionVersionId === undefined ||
        mockDatabase.resolveQuestionReportEntitlement(
          user.id,
          body.questionVersionId
        ) !== body.questionId)
    )
      return failure(
        createReportErrorSchema,
        'QUESTION_NOT_AVAILABLE',
        '제보할 수 있는 문제를 찾을 수 없습니다.'
      )
    const created = mockDatabase.createUserReport(user.id, body)
    if (!created)
      return failure(
        createReportErrorSchema,
        'QUESTION_REPORT_DUPLICATE',
        '이미 접수된 문제 제보가 있습니다.'
      )
    return HttpResponse.json<CreateReportResponse>(
      createReportResponseSchema.parse(created),
      { status: 201, headers: { 'Cache-Control': 'private, no-store' } }
    )
  }),
  http.get('*/api/v1/reports', ({ request }) => {
    const user = mockDatabase.getCurrentUser()
    if (!user)
      return failure(
        listMyReportsErrorSchema,
        'AUTHENTICATION_REQUIRED',
        '로그인이 필요합니다.'
      )
    let query: ReturnType<typeof listMyReportsQuerySchema.parse>
    try {
      query = parseSearchParams(request, listMyReportsQuerySchema)
    } catch {
      return failure(
        listMyReportsErrorSchema,
        'VALIDATION_ERROR',
        '내 제보 조회 조건이 올바르지 않습니다.'
      )
    }
    return HttpResponse.json(
      listMyReportsResponseSchema.parse(
        mockDatabase.listUserReports(user.id, query)
      ),
      { headers: { 'Cache-Control': 'private, no-store' } }
    )
  })
]
