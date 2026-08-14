import { http, HttpResponse } from 'msw'
import { getCurrentUser } from '@api/auth/getCurrentUser'
import { apiClient, isApiError, parseRetryAfterMs } from '@api/config'
import { subscribeApiError } from '@libs/errorBus'
import { queryClient } from '@libs/queryClient'
import { mockServer } from '@/test/server'

describe('validated API and central error bus', () => {
  it('credential cookie 전송과 Retry-After 파싱 정책을 고정한다', () => {
    const now = Date.parse('2026-08-14T00:00:00.000Z')

    expect(apiClient.defaults.withCredentials).toBe(true)
    expect(parseRetryAfterMs('7', now)).toBe(7_000)
    expect(parseRetryAfterMs('Fri, 14 Aug 2026 00:00:05 GMT', now)).toBe(5_000)
    expect(parseRetryAfterMs('9999', now)).toBe(300_000)
    expect(parseRetryAfterMs('invalid', now)).toBeUndefined()
  })

  it('429를 Retry-After에 따라 제한된 횟수만 다시 시도한다', async () => {
    let requestCount = 0
    mockServer.use(
      http.get('*/api/v1/me', () => {
        requestCount += 1
        return HttpResponse.json(
          { code: 'RATE_LIMITED', message: '잠시 후 다시 시도해 주세요.' },
          { status: 429, headers: { 'Retry-After': '0' } }
        )
      })
    )

    let caught: unknown
    try {
      await queryClient.fetchQuery({
        queryKey: ['test', 'rate-limited-current-user'],
        queryFn: getCurrentUser
      })
    } catch (error: unknown) {
      caught = error
    }

    expect(requestCount).toBe(3)
    expect(isApiError(caught)).toBe(true)
    if (isApiError(caught)) {
      expect(caught.status).toBe(429)
      expect(caught.retryAfterMs).toBe(0)
    }
  })

  it('잘못된 MSW 응답을 Zod validation error로 분류하고 Query error bus로 전달한다', async () => {
    const errors: unknown[] = []
    const unsubscribe = subscribeApiError((error) => errors.push(error))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockServer.use(
      http.get('*/api/v1/me', () => HttpResponse.json({ id: 'invalid-user' }))
    )

    let caught: unknown
    try {
      await queryClient.fetchQuery({
        queryKey: ['test', 'invalid-current-user'],
        queryFn: getCurrentUser,
        retry: false
      })
    } catch (error: unknown) {
      caught = error
    } finally {
      unsubscribe()
    }

    expect(isApiError(caught)).toBe(true)
    if (isApiError(caught)) {
      expect(caught.isValidationError).toBe(true)
      expect(caught.status).toBe(422)
    }
    expect(errors).toContain(caught)
  })

  it('실제 Mutation failure도 같은 중앙 error bus로 전달한다', async () => {
    const errors: unknown[] = []
    const unsubscribe = subscribeApiError((error) => errors.push(error))
    const failure = Object.assign(new Error('mutation failed'), {
      isServerError: true,
      status: 500
    })
    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationKey: ['test', 'mutation-error'],
      mutationFn: async () => Promise.reject(failure)
    })

    await expect(mutation.execute(undefined)).rejects.toBe(failure)
    unsubscribe()

    expect(errors).toContain(failure)
  })
})
