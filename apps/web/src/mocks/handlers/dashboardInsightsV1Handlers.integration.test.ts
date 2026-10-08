import {
  getDashboardInsightsErrorSchema,
  getDashboardInsightsResponseSchema
} from '@nihongo/contracts/dashboard/get-dashboard-insights'
import { describe, expect, it, vi } from 'vitest'
import { primeDashboardInsightsRateLimitForTesting } from '@mocks/handlers/dashboardInsightsV1Handlers'
import { MockDatabaseError, mockDatabase } from '@mocks/repository/mockDatabase'

const DASHBOARD_INSIGHTS_URL = 'http://localhost/api/v1/dashboard/insights'

const expectCanonicalHeaders = (response: Response): void => {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  expect(response.headers.get('X-Request-Id')).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
  )
}

describe('canonical dashboard insights v1 MSW integration', () => {
  it('strict query를 인증보다 먼저 검증하고 알 수 없는 검색 조건을 거부한다', async () => {
    const response = await fetch(
      `${DASHBOARD_INSIGHTS_URL}?userId=018f6b7a-1f4b-7d5e-8a91-000000000001`
    )
    const error = getDashboardInsightsErrorSchema.parse(await response.json())

    expect(response.status).toBe(422)
    expectCanonicalHeaders(response)
    expect(error).toMatchObject({
      code: 'VALIDATION_ERROR',
      retryable: false
    })
  })

  it('120/min rate를 validation과 auth보다 먼저 적용하고 Retry-After를 반환한다', async () => {
    primeDashboardInsightsRateLimitForTesting(120)

    const response = await fetch(
      `${DASHBOARD_INSIGHTS_URL}?userId=018f6b7a-1f4b-7d5e-8a91-000000000001`
    )
    const error = getDashboardInsightsErrorSchema.parse(await response.json())

    expect(response.status).toBe(429)
    expectCanonicalHeaders(response)
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(error).toMatchObject({ code: 'RATE_LIMITED', retryable: true })
  })

  it('로그아웃 principal을 401 self-only 오류로 반환한다', async () => {
    const response = await fetch(DASHBOARD_INSIGHTS_URL)
    const error = getDashboardInsightsErrorSchema.parse(await response.json())

    expect(response.status).toBe(401)
    expectCanonicalHeaders(response)
    expect(error).toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
      retryable: false
    })
  })

  it('현재 사용자 snapshot만 strict 응답으로 반환하고 private evidence를 노출하지 않는다', async () => {
    mockDatabase.loginAs('USER')

    const response = await fetch(DASHBOARD_INSIGHTS_URL)
    const raw: unknown = await response.json()
    const insights = getDashboardInsightsResponseSchema.parse(raw)
    const serialized = JSON.stringify(raw)

    expect(response.status).toBe(200)
    expectCanonicalHeaders(response)
    expect(insights.stats.overall.attemptedCount).toBe(0)
    expect(insights.personalizationFallbackReason).toBe(
      'NO_PERSONALIZED_EVIDENCE'
    )
    expect(insights.recommendations[0]?.kind).toBe('TARGET_LEVEL_PRACTICE')
    expect(serialized).not.toMatch(
      /selectedOption|correctOption|explanationKo|explanationJa|isCorrect|email|memo/iu
    )
  })

  it('authoritative 인증 상태 장애를 retryable 503으로 정규화한다', async () => {
    vi.spyOn(mockDatabase, 'getCurrentUser').mockImplementationOnce(() => {
      throw new MockDatabaseError(
        'SERVICE_UNAVAILABLE',
        503,
        '최신 인증 세션을 확인하지 못했습니다.'
      )
    })

    const response = await fetch(DASHBOARD_INSIGHTS_URL)
    const error = getDashboardInsightsErrorSchema.parse(await response.json())

    expect(response.status).toBe(503)
    expectCanonicalHeaders(response)
    expect(error).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      retryable: true
    })
  })
})
