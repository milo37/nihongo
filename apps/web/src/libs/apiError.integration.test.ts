import { http, HttpResponse } from 'msw'
import { getCurrentUser } from '@api/auth/getCurrentUser'
import { isApiError } from '@api/config'
import { subscribeApiError } from '@libs/errorBus'
import { queryClient } from '@libs/queryClient'
import { mockServer } from '@/test/server'

describe('validated API and central error bus', () => {
  it('잘못된 MSW 응답을 Zod validation error로 분류하고 Query error bus로 전달한다', async () => {
    const errors: unknown[] = []
    const unsubscribe = subscribeApiError((error) => errors.push(error))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockServer.use(
      http.get('*/api/auth/current-user', () =>
        HttpResponse.json({ id: 'invalid-user' })
      )
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
