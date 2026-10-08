import { errorStatusByCode } from '@nihongo/contracts/common/error'
import {
  getDashboardInsightsErrorSchema,
  getDashboardInsightsQuerySchema,
  getDashboardInsightsResponseSchema,
  type GetDashboardInsightsError
} from '@nihongo/contracts/dashboard/get-dashboard-insights'
import { http, HttpResponse } from 'msw'
import {
  MockDashboardInsightsIntegrityError,
  toContractDashboardInsights
} from '@mocks/adapters/dashboardInsightsContractAdapter'
import { MockHttpError, parseSearchParams } from '@mocks/handlers/shared'
import { MockDatabaseError, mockDatabase } from '@mocks/repository/mockDatabase'

const RATE_LIMIT_MAX = 120
const RATE_WINDOW_MILLISECONDS = 60_000

interface DashboardInsightsRateBucket {
  count: number
  windowStartedAt: number
}

interface NormalizedDashboardInsightsError {
  payload: GetDashboardInsightsError
  retryAfterSeconds?: number
}

class DashboardInsightsRateLimitError extends MockHttpError {
  readonly retryAfterSeconds: number

  constructor(retryAfterSeconds: number) {
    super(
      429,
      'RATE_LIMITED',
      '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'
    )
    this.retryAfterSeconds = retryAfterSeconds
  }
}

let dashboardInsightsRateBucket: DashboardInsightsRateBucket | null = null

export const resetDashboardInsightsRateLimitForTesting = (): void => {
  dashboardInsightsRateBucket = null
}

export const primeDashboardInsightsRateLimitForTesting = (
  count: number
): void => {
  if (!Number.isSafeInteger(count) || count < 0 || count > RATE_LIMIT_MAX) {
    throw new Error('dashboard insights rate count가 올바르지 않습니다.')
  }
  dashboardInsightsRateBucket = {
    count,
    windowStartedAt: Date.now()
  }
}

const consumeDashboardInsightsRateLimit = (): void => {
  const observedAt = Date.now()
  if (
    dashboardInsightsRateBucket === null ||
    observedAt < dashboardInsightsRateBucket.windowStartedAt ||
    observedAt - dashboardInsightsRateBucket.windowStartedAt >=
      RATE_WINDOW_MILLISECONDS
  ) {
    dashboardInsightsRateBucket = { count: 1, windowStartedAt: observedAt }
    return
  }
  if (dashboardInsightsRateBucket.count >= RATE_LIMIT_MAX) {
    throw new DashboardInsightsRateLimitError(
      Math.max(
        1,
        Math.ceil(
          (dashboardInsightsRateBucket.windowStartedAt +
            RATE_WINDOW_MILLISECONDS -
            observedAt) /
            1_000
        )
      )
    )
  }
  dashboardInsightsRateBucket.count += 1
}

const getHeaders = (
  requestId: string,
  retryAfterSeconds?: number
): Record<string, string> => ({
  'Cache-Control': 'private, no-store',
  'X-Request-Id': requestId,
  ...(retryAfterSeconds === undefined
    ? {}
    : { 'Retry-After': String(retryAfterSeconds) })
})

const createErrorResponse = (
  normalized: NormalizedDashboardInsightsError
): HttpResponse<GetDashboardInsightsError> => {
  const payload = getDashboardInsightsErrorSchema.parse(normalized.payload)

  return HttpResponse.json(payload, {
    status: errorStatusByCode[payload.code],
    headers: getHeaders(payload.requestId, normalized.retryAfterSeconds)
  })
}

const normalizeError = (
  error: unknown,
  requestId: string
): NormalizedDashboardInsightsError => {
  if (error instanceof DashboardInsightsRateLimitError) {
    return {
      payload: {
        code: 'RATE_LIMITED',
        message: error.message,
        requestId,
        retryable: true
      },
      retryAfterSeconds: error.retryAfterSeconds
    }
  }
  if (error instanceof MockHttpError) {
    return {
      payload: {
        code: 'VALIDATION_ERROR',
        message: error.message,
        requestId,
        retryable: false
      }
    }
  }
  if (error instanceof MockDatabaseError && error.code === 'AUTH_REQUIRED') {
    return {
      payload: {
        code: 'AUTHENTICATION_REQUIRED',
        message: error.message,
        requestId,
        retryable: false
      }
    }
  }
  if (
    error instanceof MockDatabaseError &&
    error.code === 'SERVICE_UNAVAILABLE'
  ) {
    return {
      payload: {
        code: 'SERVICE_UNAVAILABLE',
        message: error.message,
        requestId,
        retryable: true
      }
    }
  }

  console.error('Mock v1 getDashboardInsights failed', error)
  return {
    payload: {
      code: 'INTERNAL_SERVER_ERROR',
      message: '학습 인사이트를 불러오지 못했습니다.',
      requestId,
      retryable: true
    }
  }
}

export const dashboardInsightsV1Handlers = [
  http.get('*/api/v1/dashboard/insights', ({ request }) => {
    const requestId = crypto.randomUUID()

    try {
      consumeDashboardInsightsRateLimit()
      parseSearchParams(request, getDashboardInsightsQuerySchema)
      const user = mockDatabase.getCurrentUser()
      if (!user) {
        throw new MockDatabaseError(
          'AUTH_REQUIRED',
          401,
          '학습 인사이트를 조회하려면 로그인이 필요합니다.'
        )
      }
      const response = getDashboardInsightsResponseSchema.parse(
        toContractDashboardInsights(
          mockDatabase.getCanonicalDashboardInsightsRecord(user.id)
        )
      )

      return HttpResponse.json(response, { headers: getHeaders(requestId) })
    } catch (error: unknown) {
      if (error instanceof MockDashboardInsightsIntegrityError) {
        console.error(
          'Mock v1 dashboard insights mapper integrity failed',
          error
        )
      }
      return createErrorResponse(normalizeError(error, requestId))
    }
  })
]
