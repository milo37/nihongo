import { sha256TextPort } from '@nihongo/browser/libs/sha256Text'
import {
  QueryClient,
  QueryClientProvider,
  onlineManager
} from '@tanstack/react-query'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { AdminImportApplyResponse } from '@nihongo/contracts/admin/phase7'
import {
  advanceAuthTransitionEpoch,
  AuthTransitionSupersededError
} from '@nihongo/browser/libs/authTransitionFence'
import { useAppStore } from '@nihongo/browser/store/index'
import { apiClient } from '@nihongo/browser/api/config'
import * as api from '@nihongo/browser/api/phase7/requestPhase7Operation'
import {
  useValidateImport,
  useApplyImport
} from '@app/admin-import/hooks/useAdminImport'
import { createInput } from '@app/admin-question/test/questionFixture'
import {
  actor,
  reviewerId,
  questionId,
  versionId
} from '@app/admin-question/test/workflowFixture'
const request = { items: [{ clientItemId: 'row-1', content: createInput }] }
const digest = '0'.repeat(64)
const validated = {
  valid: true,
  validationDigest: digest,
  itemCount: 1,
  errors: []
}
const applied: AdminImportApplyResponse = {
  createdCount: 1,
  items: [
    {
      clientItemId: 'row-1',
      questionId,
      questionVersionId: versionId,
      lifecycleStatus: 'ACTIVE',
      versionStatus: 'DRAFT',
      questionRowVersion: 1,
      versionRowVersion: 1
    }
  ],
  occurredAt: '2026-10-01T00:00:00Z'
}
const body = { ...request, validationDigest: digest }
let client: QueryClient
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
)
const useImportUnderTest = () => ({
  validate: useValidateImport(),
  apply: useApplyImport()
})
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
it('validates the exact selected items once without invalidating content caches', async () => {
  const endpoint = vi
    .spyOn(api, 'requestPhase7Operation')
    .mockResolvedValue(validated)
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const { result } = renderHook(useImportUnderTest, { wrapper })
  await act(async () => {
    expect(await result.current.validate.mutateAsync(request)).toEqual(
      validated
    )
  })
  expect(endpoint).toHaveBeenCalledExactlyOnceWith({
    operation: 'validateQuestionImport',
    params: {},
    query: {},
    body: request
  })
  expect(invalidate).not.toHaveBeenCalled()
})
it('applies the exact bound items+digest and waits for current admin list/detail/audit invalidations', async () => {
  const endpoint = vi
    .spyOn(api, 'requestPhase7Operation')
    .mockResolvedValue(applied)
  let finish!: () => void
  const barrier = new Promise<void>((resolve) => {
    finish = resolve
  })
  const invalidate = vi
    .spyOn(client, 'invalidateQueries')
    .mockReturnValue(barrier)
  const { result } = renderHook(useImportUnderTest, { wrapper })
  let pending!: Promise<unknown>
  let complete = false
  await act(async () => {
    pending = result.current.apply.mutateAsync(body).then((value) => {
      complete = true
      return value
    })
  })
  expect(endpoint).toHaveBeenCalledExactlyOnceWith({
    operation: 'applyQuestionImport',
    params: {},
    query: {},
    body
  })
  expect(complete).toBe(false)
  expect(invalidate.mock.calls.map(([value]) => value?.queryKey)).toEqual([
    ['admin-question'],
    ['phase7-admin', 'questions'],
    ['phase7-admin', 'audit-log']
  ])
  await act(async () => {
    finish()
    await pending
  })
  expect(complete).toBe(true)
})
it.each([
  'FRESH_ASSURANCE_REQUIRED',
  'IMPORT_VALIDATION_FAILED',
  'IMPORT_IDENTITY_CONFLICT'
])('does not retry/replay or invalidate a failed %s apply', async (code) => {
  const endpoint = vi
    .spyOn(api, 'requestPhase7Operation')
    .mockRejectedValue({ code })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const { result } = renderHook(useImportUnderTest, { wrapper })
  await act(async () => {
    await expect(result.current.apply.mutateAsync(body)).rejects.toMatchObject({
      code
    })
  })
  expect(endpoint).toHaveBeenCalledTimes(1)
  expect(invalidate).not.toHaveBeenCalled()
})
it.each(['validate', 'apply'] as const)(
  'blocks offline %s before transport and never resumes it on reconnect',
  async (operation) => {
    const endpoint = vi.spyOn(api, 'requestPhase7Operation')
    const { result } = renderHook(useImportUnderTest, { wrapper })
    onlineManager.setOnline(false)
    await act(async () => {
      await expect(
        operation === 'validate'
          ? result.current.validate.mutateAsync(request)
          : result.current.apply.mutateAsync(body)
      ).rejects.toMatchObject({ isOffline: true })
    })
    await act(async () => {
      onlineManager.setOnline(true)
    })
    expect(endpoint).not.toHaveBeenCalled()
  }
)
it.each(['USER', 'GUEST'])(
  'rejects %s before private validation/apply transport',
  async (role) => {
    useAppStore
      .getState()
      .setCurrentUser(role === 'GUEST' ? null : { ...actor(), role: 'USER' })
    const endpoint = vi.spyOn(api, 'requestPhase7Operation')
    const { result } = renderHook(useImportUnderTest, { wrapper })
    await act(async () => {
      await expect(
        result.current.validate.mutateAsync(request)
      ).rejects.toBeInstanceOf(AuthTransitionSupersededError)
      await expect(
        result.current.apply.mutateAsync(body)
      ).rejects.toBeInstanceOf(AuthTransitionSupersededError)
    })
    expect(endpoint).not.toHaveBeenCalled()
  }
)
it('rejects late validation and queued apply captured before actor transition', async () => {
  let finish!: (value: typeof validated) => void
  const endpoint = vi.spyOn(api, 'requestPhase7Operation').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const { result } = renderHook(useImportUnderTest, { wrapper })
  let first!: Promise<unknown>
  let second!: Promise<unknown>
  await act(async () => {
    first = result.current.validate.mutateAsync(request)
    first.catch(() => undefined)
    second = result.current.apply.mutateAsync(body)
    second.catch(() => undefined)
  })
  expect(endpoint).toHaveBeenCalledTimes(1)
  advanceAuthTransitionEpoch()
  useAppStore.getState().setCurrentUser(actor(reviewerId))
  await act(async () => {
    finish(validated)
    await expect(first).rejects.toBeInstanceOf(AuthTransitionSupersededError)
    await expect(second).rejects.toBeInstanceOf(AuthTransitionSupersededError)
  })
  expect(endpoint).toHaveBeenCalledTimes(1)
  expect(invalidate).not.toHaveBeenCalled()
})
it('rechecks the actor after an awaited committed apply invalidation', async () => {
  vi.spyOn(api, 'requestPhase7Operation').mockResolvedValue(applied)
  let finish!: () => void
  const barrier = new Promise<void>((resolve) => {
    finish = resolve
  })
  vi.spyOn(client, 'invalidateQueries').mockReturnValue(barrier)
  const { result } = renderHook(useImportUnderTest, { wrapper })
  let pending!: Promise<unknown>
  await act(async () => {
    pending = result.current.apply.mutateAsync(body)
    pending.catch(() => undefined)
  })
  advanceAuthTransitionEpoch()
  await act(async () => {
    finish()
    await expect(pending).rejects.toBeInstanceOf(AuthTransitionSupersededError)
  })
})
it('uses the real shared validation transport digest binding and canonical private response metadata', async () => {
  const correctDigest = 'a'.repeat(64)
  vi.spyOn(sha256TextPort, 'digestUtf8').mockResolvedValue(correctDigest)
  const transport = vi.spyOn(apiClient, 'request').mockResolvedValue({
    status: 200,
    headers: {
      'cache-control': 'private, no-store',
      'x-request-id': questionId
    },
    data: { ...validated, validationDigest: correctDigest }
  })
  const { result } = renderHook(useImportUnderTest, { wrapper })
  await act(async () => {
    expect(
      (await result.current.validate.mutateAsync(request)).validationDigest
    ).toBe(correctDigest)
  })
  expect(transport).toHaveBeenCalledWith(
    expect.objectContaining({
      url: '/v1/admin/questions/import-validation',
      method: 'POST',
      data: request
    })
  )
  transport.mockResolvedValue({
    status: 200,
    headers: {
      'cache-control': 'private, no-store',
      'x-request-id': questionId
    },
    data: validated
  })
  await act(async () => {
    await expect(
      result.current.validate.mutateAsync(request)
    ).rejects.toMatchObject({
      isResponseValidationError: true,
      retryable: false
    })
  })
})
it('rejects an actual shared apply response with a different client mapping before invalidation', async () => {
  vi.spyOn(apiClient, 'request').mockResolvedValue({
    status: 201,
    headers: {
      'cache-control': 'private, no-store',
      'x-request-id': questionId
    },
    data: {
      ...applied,
      items: [{ ...applied.items[0]!, clientItemId: 'different-item' }]
    }
  })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const { result } = renderHook(useImportUnderTest, { wrapper })
  await act(async () => {
    await expect(result.current.apply.mutateAsync(body)).rejects.toMatchObject({
      isResponseValidationError: true,
      retryable: false
    })
  })
  expect(invalidate).not.toHaveBeenCalled()
})
