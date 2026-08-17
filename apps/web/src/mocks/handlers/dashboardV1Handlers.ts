import { errorStatusByCode } from '@nihongo/contracts/common/error'
import {
  getDashboardStatsErrorSchema,
  getDashboardStatsQuerySchema,
  getDashboardStatsResponseSchema,
  type GetDashboardStatsError
} from '@nihongo/contracts/dashboard/get-dashboard-stats'
import { http, HttpResponse } from 'msw'
import {
  MockDashboardIntegrityError,
  toContractDashboardStats
} from '@mocks/adapters/dashboardContractAdapter'
import { MockHttpError, parseSearchParams } from '@mocks/handlers/shared'
import { MockDatabaseError, mockDatabase } from '@mocks/repository/mockDatabase'

const getHeaders = (requestId: string): Record<string, string> => ({
  'Cache-Control': 'private, no-store',
  'X-Request-Id': requestId
})

const createErrorResponse = (
  error: GetDashboardStatsError
): HttpResponse<GetDashboardStatsError> => {
  const payload = getDashboardStatsErrorSchema.parse(error)

  return HttpResponse.json(payload, {
    status: errorStatusByCode[payload.code],
    headers: getHeaders(payload.requestId)
  })
}

const normalizeError = (
  error: unknown,
  requestId: string
): GetDashboardStatsError => {
  if (error instanceof MockHttpError) {
    return {
      code: 'VALIDATION_ERROR',
      message: error.message,
      requestId,
      retryable: false
    }
  }
  if (error instanceof MockDatabaseError && error.code === 'AUTH_REQUIRED') {
    return {
      code: 'AUTHENTICATION_REQUIRED',
      message: error.message,
      requestId,
      retryable: false
    }
  }

  console.error('Mock v1 getDashboardStats failed', error)
  return {
    code: 'INTERNAL_SERVER_ERROR',
    message: '대시보드를 불러오지 못했습니다.',
    requestId,
    retryable: true
  }
}

export const dashboardV1Handlers = [
  http.get('*/api/v1/dashboard', ({ request }) => {
    const requestId = crypto.randomUUID()

    try {
      const query = parseSearchParams(request, getDashboardStatsQuerySchema)
      const user = mockDatabase.getCurrentUser()
      if (!user) {
        throw new MockDatabaseError(
          'AUTH_REQUIRED',
          401,
          '대시보드를 조회하려면 로그인이 필요합니다.'
        )
      }
      const response = getDashboardStatsResponseSchema.parse(
        toContractDashboardStats(
          mockDatabase.getCanonicalDashboardRecord(user.id),
          query
        )
      )

      return HttpResponse.json(response, { headers: getHeaders(requestId) })
    } catch (error: unknown) {
      if (error instanceof MockDashboardIntegrityError) {
        console.error('Mock v1 dashboard mapper integrity failed', error)
      }
      return createErrorResponse(normalizeError(error, requestId))
    }
  })
]
