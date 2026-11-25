import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { isApiError } from '../api/config'
import { emitApiError } from './errorBus'
import { isAuthTransitionSupersededError } from './authTransitionFence'

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

// A screen that renders its own failure message opts out of the global
// warning toast with meta.localErrorUi; sign-in and permission failures
// still reach the global handler (/login, /forbidden). The learner app makes
// it the default for queries (#1262, apps/web provider/queryDefaults.ts).
const isAccessError = (error: unknown) =>
  isApiError(error) && (error.isAuthError || error.isForbiddenError)

const showsOwnError = (
  meta: Record<string, unknown> | undefined,
  error: Error
): boolean => meta?.localErrorUi === true && !isAccessError(error)

// For a screen that catches a failure itself and shows it: only sign-in and
// permission failures go on to the global handler.
export const emitAccessError = (error: unknown): void => {
  if (isAccessError(error)) emitApiError(error)
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (showsOwnError(query.meta, error)) return
      emitApiError(error)
    }
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (showsOwnError(mutation.meta, error)) return
      emitApiError(error)
    }
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        if (isAuthTransitionSupersededError(error)) {
          return false
        }

        const status = isApiError(error) ? error.status : undefined

        if (isApiError(error) && error.retryable === false) {
          return false
        }

        if (status === 429) {
          return failureCount < 2
        }

        if (status && status >= 400 && status < 500) {
          return false
        }

        if (status !== undefined) {
          return isApiError(error) && error.retryable === true
            ? failureCount < 1
            : false
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
