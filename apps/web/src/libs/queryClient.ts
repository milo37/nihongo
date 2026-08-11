import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { emitApiError } from '@libs/errorBus'

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
        const status =
          typeof error === 'object' &&
          error !== null &&
          'status' in error &&
          typeof error.status === 'number'
            ? error.status
            : undefined

        if (status && status >= 400 && status < 500) {
          return false
        }

        return failureCount < 1
      },
      refetchOnWindowFocus: false
    },
    mutations: {
      retry: false
    }
  }
})
