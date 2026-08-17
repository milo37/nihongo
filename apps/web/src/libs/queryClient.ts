import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { isApiError } from '@api/config'
import { emitApiError } from '@libs/errorBus'
import { isAuthTransitionSupersededError } from '@libs/authTransitionFence'

const getQueryRetryDelay = (attempt: number, error: Error): number => {
  if (
    isApiError(error) &&
    error.status === 429 &&
    error.retryAfterMs !== undefined
  ) {
    return error.retryAfterMs
  }

  return Math.min(1_000 * 2 ** attempt, 10_000)
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: emitApiError
  }),
  mutationCache: new MutationCache({
    onError: emitApiError
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        if (isAuthTransitionSupersededError(error)) {
          return false
        }

        const status = isApiError(error) ? error.status : undefined

        if (status === 429) {
          return failureCount < 2
        }

        if (status && status >= 400 && status < 500) {
          return false
        }

        return failureCount < 1
      },
      retryDelay: getQueryRetryDelay,
      refetchOnWindowFocus: false
    },
    mutations: {
      retry: false
    }
  }
})
