import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { useFreshAssurance } from '@app/admin-question/hooks/useFreshAssurance'
import {
  advanceAuthTransitionEpoch,
  AuthTransitionSupersededError
} from '@libs/authTransitionFence'
import { queryClient } from '@libs/queryClient'
import { useAppStore } from '@store/index'
const calls = vi.hoisted(() => ({
  post: vi.fn(),
  refresh: vi.fn(),
  recover: vi.fn()
}))
vi.mock('@api/phase7/phase7AdminApi', async (original) => ({
  ...(await original<typeof import('@api/phase7/phase7AdminApi')>()),
  reauthenticatePhase7Admin: calls.post
}))
vi.mock('@app/login/authSession', async (original) => ({
  ...(await original<typeof import('@app/login/authSession')>()),
  refreshCanonicalAuthAfterMutation: calls.refresh,
  recoverCanonicalAuthAfterAmbiguousMutation: calls.recover
}))
const admin = {
  id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c7105',
  name: '관리자',
  role: 'ADMIN' as const,
  targetLevel: 'N5' as const
}
const wrapper = ({ children }: { readonly children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
)
beforeEach(() => {
  calls.post.mockReset()
  calls.refresh.mockReset()
  calls.recover.mockReset()
  useAppStore.getState().setCurrentUser(admin)
})
it('refreshes the canonical principal after report step-up, closes the dialog, and leaves the report command manual', async () => {
  calls.post.mockResolvedValue({})
  calls.refresh.mockResolvedValue({ applied: true })
  const { result } = renderHook(() => useFreshAssurance(), { wrapper })
  act(() =>
    result.current.open({
      reportId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c7101',
      reasonCode: 'REPORT_RESOLUTION'
    })
  )
  await act(async () => {
    await result.current.reauthenticate('test-password-only')
  })
  expect(calls.refresh).toHaveBeenCalledWith(queryClient, {
    expectedIdentity: 'AUTHENTICATED'
  })
  expect(result.current.isOpen).toBe(false)
  expect(result.current.completionMessage).toMatch(/자동 실행되지 않았/u)
  expect(calls.post).toHaveBeenCalledTimes(1)
})
it('recovers a confirmed password POST after canonical refresh failure without replaying it', async () => {
  calls.post.mockResolvedValueOnce({})
  calls.refresh.mockRejectedValue(new Error('me failed'))
  calls.recover.mockResolvedValue({ applied: true, user: admin })
  const { result } = renderHook(() => useFreshAssurance(), { wrapper })
  act(() => result.current.open({ reasonCode: 'REPORT_RESOLUTION' }))
  await act(async () => {
    await result.current
      .reauthenticate('test-password-only')
      .catch(() => undefined)
  })
  expect(calls.recover).toHaveBeenCalledWith(queryClient)
  expect(result.current.isOpen).toBe(false)
  expect(result.current.completionMessage).toMatch(/자동 실행되지 않았/u)
  expect(calls.post).toHaveBeenCalledTimes(1)
})
it('does not apply a late successful password POST after an authentication epoch change', async () => {
  let finish: (() => void) | undefined
  calls.post.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
  )
  const { result } = renderHook(() => useFreshAssurance(), { wrapper })
  act(() => result.current.open({ reasonCode: 'REPORT_RESOLUTION' }))
  let pending: Promise<unknown> | undefined
  await act(async () => {
    pending = result.current
      .reauthenticate('test-password-only')
      .catch((error: unknown) => error)
  })
  advanceAuthTransitionEpoch()
  await act(async () => {
    finish?.()
    expect(await pending).toBeInstanceOf(AuthTransitionSupersededError)
  })
  expect(calls.refresh).not.toHaveBeenCalled()
  expect(calls.recover).not.toHaveBeenCalled()
  expect(result.current.completionMessage).toBeNull()
})
it('does not accept a different canonical administrator as successful report step-up', async () => {
  calls.post.mockResolvedValue({})
  calls.refresh.mockImplementation(async () => {
    useAppStore
      .getState()
      .setCurrentUser({ ...admin, id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c7199' })
    return { applied: true }
  })
  const { result } = renderHook(() => useFreshAssurance(), { wrapper })
  act(() => result.current.open({ reasonCode: 'REPORT_RESOLUTION' }))
  await act(async () => {
    await expect(
      result.current.reauthenticate('test-password-only')
    ).rejects.toBeInstanceOf(AuthTransitionSupersededError)
  })
  expect(result.current.completionMessage).toBeNull()
})

it('recovers an ambiguous 503 principal but keeps step-up open and the command manual', async () => {
  calls.post.mockRejectedValue(
    Object.assign(new Error('unknown commit'), { status: 503 })
  )
  calls.recover.mockResolvedValue({ applied: true, user: admin })
  const { result } = renderHook(() => useFreshAssurance(), { wrapper })
  act(() => result.current.open({ reasonCode: 'REPORT_RESOLUTION' }))
  await act(async () => {
    await result.current
      .reauthenticate('test-password-only')
      .catch(() => undefined)
  })
  expect(calls.recover).toHaveBeenCalledWith(queryClient)
  expect(calls.refresh).not.toHaveBeenCalled()
  expect(result.current.isOpen).toBe(true)
  expect(result.current.completionMessage).toBeNull()
  expect(calls.post).toHaveBeenCalledTimes(1)
})
