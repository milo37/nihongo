import { QueryObserver } from '@tanstack/react-query'
import { queryClient as canonicalQueryClient } from '@nihongo/browser/libs/queryClient'

it('the canonical query client invalidates an active query and reads the same cache', async () => {
  const queryKey = [
    'browser-query-client-bridge',
    'dashboard-insights'
  ] as const
  const queryFn = vi
    .fn()
    .mockResolvedValueOnce({ revision: 1 })
    .mockResolvedValueOnce({ revision: 2 })
  const observer = new QueryObserver(canonicalQueryClient, {
    queryKey,
    queryFn,
    staleTime: Infinity
  })
  const unsubscribe = observer.subscribe(() => undefined)
  try {
    await canonicalQueryClient.fetchQuery({
      queryKey,
      queryFn,
      staleTime: Infinity
    })
    expect(canonicalQueryClient.getQueryState(queryKey)).toMatchObject({
      data: { revision: 1 },
      fetchStatus: 'idle',
      status: 'success'
    })
    await canonicalQueryClient.invalidateQueries({ queryKey, exact: true })
    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(canonicalQueryClient.getQueryData(queryKey)).toEqual({ revision: 2 })
    expect(canonicalQueryClient.getQueryState(queryKey)).toMatchObject({
      data: { revision: 2 },
      fetchStatus: 'idle',
      status: 'success'
    })
  } finally {
    unsubscribe()
    canonicalQueryClient.removeQueries({ queryKey, exact: true })
  }
})

it('meta.localErrorUi keeps screen-local mutation errors off the shared bus but still forwards auth errors', async () => {
  const { subscribeApiError } = await import('@nihongo/browser/libs/errorBus')
  const received: unknown[] = []
  const unsubscribe = subscribeApiError((error) => received.push(error))
  const apiError = (isAuthError: boolean): Error =>
    Object.assign(new Error(isAuthError ? 'auth' : 'server'), {
      isAuthError,
      isNetworkError: false,
      isOffline: false
    })
  const run = (meta: Record<string, unknown> | undefined, error: Error) =>
    canonicalQueryClient
      .getMutationCache()
      .build(canonicalQueryClient, {
        meta,
        mutationFn: () => Promise.reject(error)
      })
      .execute(undefined)
      .catch(() => undefined)
  try {
    const local = apiError(false)
    const auth = apiError(true)
    const shared = apiError(false)
    await run({ localErrorUi: true }, local)
    await run({ localErrorUi: true }, auth)
    await run(undefined, shared)
    expect(received).toEqual([auth, shared])
  } finally {
    unsubscribe()
  }
})

it('meta.localErrorUi keeps screen-local query errors off the shared bus but still forwards auth errors', async () => {
  const { subscribeApiError } = await import('@nihongo/browser/libs/errorBus')
  const received: unknown[] = []
  const unsubscribe = subscribeApiError((error) => received.push(error))
  const apiError = (isAuthError: boolean): Error =>
    Object.assign(new Error(isAuthError ? 'auth' : 'server'), {
      isAuthError,
      isNetworkError: false,
      isOffline: false,
      retryable: false
    })
  const run = (
    name: string,
    meta: Record<string, unknown> | undefined,
    error: Error
  ) =>
    canonicalQueryClient
      .fetchQuery({
        queryKey: ['local-error-ui', name],
        meta,
        retry: false,
        queryFn: () => Promise.reject(error)
      })
      .catch(() => undefined)
  try {
    const local = apiError(false)
    const auth = apiError(true)
    const shared = apiError(false)
    await run('local', { localErrorUi: true }, local)
    await run('auth', { localErrorUi: true }, auth)
    await run('shared', undefined, shared)
    expect(received).toEqual([auth, shared])
  } finally {
    unsubscribe()
    canonicalQueryClient.removeQueries({ queryKey: ['local-error-ui'] })
  }
})
