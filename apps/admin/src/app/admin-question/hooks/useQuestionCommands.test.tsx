import {
  QueryClient,
  QueryClientProvider,
  onlineManager
} from '@tanstack/react-query'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import {
  advanceAuthTransitionEpoch,
  AuthTransitionSupersededError
} from '@nihongo/browser/libs/authTransitionFence'
import { useAppStore } from '@nihongo/browser/store/index'
import * as api from '@nihongo/browser/api/content-operations/requestContentOperation'
import { useQuestionCommands } from '@app/admin-question/hooks/useQuestionCommands'
import { buildQuestionCommand } from '@app/admin-question/detail/questionWorkflow'
import {
  initial,
  newer,
  actor,
  reviewerId,
  previewFor,
  createReceipt
} from '@app/admin-question/test/workflowFixture'
let client: QueryClient
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
)
const request = () =>
  buildQuestionCommand(
    'REQUEST_REVIEW',
    initial,
    newer,
    previewFor(),
    'note',
    newer
  )
beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
  onlineManager.setOnline(true)
  useAppStore.getState().setCurrentUser(actor())
})
afterEach(() => {
  cleanup()
  client.clear()
  onlineManager.setOnline(true)
  vi.restoreAllMocks()
})
it('dispatches the exact viewed CAS once and awaits private/public invalidations before callback', async () => {
  const endpoint = vi
    .spyOn(api, 'requestContentOperation')
    .mockResolvedValue(createReceipt)
  let finish!: () => void
  const barrier = new Promise<void>((resolve) => {
    finish = resolve
  })
  const invalidate = vi
    .spyOn(client, 'invalidateQueries')
    .mockReturnValue(barrier)
  const success = vi.fn()
  const { result } = renderHook(() => useQuestionCommands(success), { wrapper })
  let promise!: Promise<unknown>
  const input = request()
  await act(async () => {
    promise = result.current.mutateAsync(input)
  })
  expect(endpoint).toHaveBeenCalledExactlyOnceWith(input)
  expect(success).not.toHaveBeenCalled()
  expect(invalidate.mock.calls.map(([value]) => value?.queryKey)).toEqual([
    ['phase7-admin', 'questions'],
    ['admin-question'],
    ['phase7-admin', 'audit-log'],
    ['bookmark'],
    ['wrong-note'],
    ['dashboard']
  ])
  await act(async () => {
    finish()
    await promise
  })
  expect(success).toHaveBeenCalledExactlyOnceWith(createReceipt, input)
})
it.each([
  'FRESH_ASSURANCE_REQUIRED',
  'VERSION_CONFLICT',
  'INVALID_STATE_TRANSITION',
  'VALIDATION_ERROR'
])('does not retry/replay or invalidate a failed %s command', async (code) => {
  const error = { code }
  const endpoint = vi
    .spyOn(api, 'requestContentOperation')
    .mockRejectedValue(error)
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const failed = vi.fn()
  const { result } = renderHook(() => useQuestionCommands(vi.fn(), failed), {
    wrapper
  })
  await act(async () => {
    await expect(result.current.mutateAsync(request())).rejects.toBe(error)
  })
  expect(endpoint).toHaveBeenCalledTimes(1)
  expect(invalidate).not.toHaveBeenCalled()
  expect(failed).toHaveBeenCalledExactlyOnceWith(error)
})
it('refuses offline dispatch and never queues the command for reconnect', async () => {
  const endpoint = vi.spyOn(api, 'requestContentOperation')
  const { result } = renderHook(() => useQuestionCommands(vi.fn()), { wrapper })
  onlineManager.setOnline(false)
  await act(async () => {
    await expect(result.current.mutateAsync(request())).rejects.toMatchObject({
      isOffline: true
    })
  })
  await act(async () => {
    onlineManager.setOnline(true)
  })
  expect(endpoint).not.toHaveBeenCalled()
})
it.each(['USER', 'GUEST'])('rejects %s before dispatch', async (role) => {
  useAppStore
    .getState()
    .setCurrentUser(role === 'GUEST' ? null : { ...actor(), role: 'USER' })
  const endpoint = vi.spyOn(api, 'requestContentOperation')
  const { result } = renderHook(() => useQuestionCommands(vi.fn()), { wrapper })
  await act(async () => {
    await expect(result.current.mutateAsync(request())).rejects.toBeInstanceOf(
      AuthTransitionSupersededError
    )
  })
  expect(endpoint).not.toHaveBeenCalled()
})
it('ignores late old-actor success before any invalidation or callback', async () => {
  let finish!: (value: typeof createReceipt) => void
  vi.spyOn(api, 'requestContentOperation').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const success = vi.fn()
  const failed = vi.fn()
  const { result } = renderHook(() => useQuestionCommands(success, failed), {
    wrapper
  })
  let promise!: Promise<unknown>
  await act(async () => {
    promise = result.current.mutateAsync(request())
    promise.catch(() => undefined)
  })
  advanceAuthTransitionEpoch()
  useAppStore.getState().setCurrentUser(actor(reviewerId))
  await act(async () => {
    finish(createReceipt)
    await expect(promise).rejects.toBeInstanceOf(AuthTransitionSupersededError)
  })
  expect(invalidate).not.toHaveBeenCalled()
  expect(success).not.toHaveBeenCalled()
  expect(failed).not.toHaveBeenCalled()
})
it('rechecks the actor after awaited invalidation', async () => {
  vi.spyOn(api, 'requestContentOperation').mockResolvedValue(createReceipt)
  let finish!: () => void
  const barrier = new Promise<void>((resolve) => {
    finish = resolve
  })
  vi.spyOn(client, 'invalidateQueries').mockReturnValue(barrier)
  const success = vi.fn()
  const { result } = renderHook(() => useQuestionCommands(success), { wrapper })
  let promise!: Promise<unknown>
  await act(async () => {
    promise = result.current.mutateAsync(request())
    promise.catch(() => undefined)
  })
  advanceAuthTransitionEpoch()
  await act(async () => {
    finish()
    await expect(promise).rejects.toBeInstanceOf(AuthTransitionSupersededError)
  })
  expect(success).not.toHaveBeenCalled()
})
it('fences a serialized second command captured before an actor transition', async () => {
  let finish!: (value: typeof createReceipt) => void
  const endpoint = vi.spyOn(api, 'requestContentOperation').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const { result } = renderHook(() => useQuestionCommands(vi.fn()), { wrapper })
  let first!: Promise<unknown>
  let second!: Promise<unknown>
  await act(async () => {
    first = result.current.mutateAsync(request())
    first.catch(() => undefined)
    second = result.current.mutateAsync(request())
    second.catch(() => undefined)
  })
  expect(endpoint).toHaveBeenCalledTimes(1)
  advanceAuthTransitionEpoch()
  await act(async () => {
    finish(createReceipt)
    await expect(first).rejects.toBeInstanceOf(AuthTransitionSupersededError)
    await expect(second).rejects.toBeInstanceOf(AuthTransitionSupersededError)
  })
  expect(endpoint).toHaveBeenCalledTimes(1)
})
