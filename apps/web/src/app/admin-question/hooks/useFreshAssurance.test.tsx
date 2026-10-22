import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { buildPhase7OperationFailureResponse } from '@nihongo/contracts/admin/phase7'
import { describe, expect, it, vi } from 'vitest'
import { useFreshAssurance } from '@app/admin-question/hooks/useFreshAssurance'
import { queryClient } from '@libs/queryClient'
import { DEMO_ADMIN_ID } from '@mocks/data/users'
import { MOCK_ADMIN_PASSWORD } from '@mocks/handlers/authHandlers'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { useAppStore } from '@store/index'
import { mockServer } from '@/test/server'

const wrapper = ({ children }: { readonly children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
)

const useAdmin = (): void => {
  const admin = mockDatabase.loginAs('ADMIN', DEMO_ADMIN_ID)
  useAppStore.getState().setCurrentUser(admin)
}

const ambiguousReauthentication = (beforeResponse?: () => void): void => {
  mockServer.use(
    http.post('*/api/v1/admin/reauthentication', () => {
      beforeResponse?.()
      const requestId = crypto.randomUUID()
      const response = buildPhase7OperationFailureResponse({
        operation: 'reauthenticateAdmin',
        disposition: 'COMMIT_UNKNOWN',
        failure: {
          code: 'SERVICE_UNAVAILABLE',
          message: '재인증 결과를 확정할 수 없습니다.',
          requestId
        }
      })
      return HttpResponse.json(response.body, {
        status: response.status,
        headers: response.headers
      })
    })
  )
}

describe('useFreshAssurance', () => {
  it('presents a localized stable error for an incorrect password', async () => {
    useAdmin()
    const { result } = renderHook(() => useFreshAssurance(), { wrapper })

    act(() => {
      result.current.open({ reasonCode: 'QUESTION_PUBLISH' })
    })
    await act(async () => {
      await result.current
        .reauthenticate('definitely-wrong-password')
        .catch(() => undefined)
    })

    expect(result.current.isOpen).toBe(true)
    expect(result.current.errorMessage).toBe(
      '현재 비밀번호가 올바르지 않습니다.'
    )
  })

  it('refreshes the principal, closes the prompt, and never replays the command after success', async () => {
    useAdmin()
    const { result } = renderHook(() => useFreshAssurance(), { wrapper })

    act(() => {
      result.current.open({
        questionIds: ['question-1'],
        reasonCode: 'QUESTION_PUBLISH'
      })
    })
    await act(async () => {
      await result.current.reauthenticate(MOCK_ADMIN_PASSWORD)
    })

    expect(result.current.isOpen).toBe(false)
    expect(result.current.completionMessage).toMatch(/자동 실행되지 않았/u)
    expect(useAppStore.getState().currentUser).toMatchObject({
      id: DEMO_ADMIN_ID,
      role: 'ADMIN'
    })
  })

  it('performs authoritative /me recovery after an ambiguous 503 and keeps ADMIN step-up open', async () => {
    useAdmin()
    ambiguousReauthentication()
    const meRequests = vi.fn()
    mockServer.use(
      http.get('*/api/v1/me', () => {
        meRequests()
        const admin = mockDatabase.getCurrentUser()
        if (!admin) throw new Error('Recovery ADMIN is unavailable.')
        return HttpResponse.json(
          {
            kind: 'USER',
            user: {
              id: admin.id,
              name: admin.name,
              role: 'ADMIN',
              targetLevel: admin.targetLevel
            }
          },
          { headers: { 'Cache-Control': 'private, no-store' } }
        )
      })
    )
    const { result } = renderHook(() => useFreshAssurance(), { wrapper })

    act(() => {
      result.current.open({ reasonCode: 'QUESTION_PUBLISH' })
    })
    await act(async () => {
      await result.current
        .reauthenticate(MOCK_ADMIN_PASSWORD)
        .catch(() => undefined)
    })

    expect(meRequests).toHaveBeenCalledTimes(1)
    expect(result.current.isOpen).toBe(true)
    expect(result.current.recoveryRequired).toBe(false)
    expect(result.current.errorMessage).toMatch(/현재 관리자 세션/u)
    expect(result.current.completionMessage).toBeNull()
  })

  it('preserves the existing principal and exposes a /me retry when recovery itself is offline', async () => {
    useAdmin()
    ambiguousReauthentication()
    mockServer.use(http.get('*/api/v1/me', () => HttpResponse.error()))
    const { result } = renderHook(() => useFreshAssurance(), { wrapper })

    act(() => {
      result.current.open({ reasonCode: 'QUESTION_PUBLISH' })
    })
    await act(async () => {
      await result.current
        .reauthenticate(MOCK_ADMIN_PASSWORD)
        .catch(() => undefined)
    })

    await waitFor(() => expect(result.current.recoveryRequired).toBe(true))
    expect(result.current.isOpen).toBe(true)
    expect(useAppStore.getState().currentUser).toMatchObject({
      id: DEMO_ADMIN_ID,
      role: 'ADMIN'
    })
    expect(result.current.completionMessage).toBeNull()
  })

  it('retries only principal settlement when reauthentication committed before /me failed', async () => {
    useAdmin()
    mockServer.use(http.get('*/api/v1/me', () => HttpResponse.error()))
    const { result } = renderHook(() => useFreshAssurance(), { wrapper })

    act(() => {
      result.current.open({
        questionIds: ['question-1'],
        reasonCode: 'QUESTION_PUBLISH'
      })
    })
    await act(async () => {
      await result.current
        .reauthenticate(MOCK_ADMIN_PASSWORD)
        .catch(() => undefined)
    })

    await waitFor(() => expect(result.current.recoveryRequired).toBe(true))
    expect(result.current.isOpen).toBe(true)
    expect(
      mockDatabase
        .getCanonicalAdminCmsSnapshot()
        .auditLogs.filter((audit) => audit.command === 'REAUTHENTICATION')
    ).toHaveLength(1)

    mockServer.use(
      http.get('*/api/v1/me', () => {
        const admin = mockDatabase.getCurrentUser()
        if (!admin) throw new Error('Recovery ADMIN is unavailable.')
        return HttpResponse.json(
          {
            kind: 'USER',
            user: {
              id: admin.id,
              name: admin.name,
              role: 'ADMIN',
              targetLevel: admin.targetLevel
            }
          },
          { headers: { 'Cache-Control': 'private, no-store' } }
        )
      })
    )
    await act(async () => {
      await result.current.retryRecovery()
    })

    expect(result.current.isOpen).toBe(false)
    expect(result.current.completionMessage).toMatch(/자동 실행되지 않았/u)
    expect(
      mockDatabase
        .getCanonicalAdminCmsSnapshot()
        .auditLogs.filter((audit) => audit.command === 'REAUTHENTICATION')
    ).toHaveLength(1)
  })

  it('commits a recovered USER role without claiming reauthentication success', async () => {
    useAdmin()
    ambiguousReauthentication(() => {
      mockDatabase.loginAs('USER')
    })
    const { result } = renderHook(() => useFreshAssurance(), { wrapper })

    act(() => {
      result.current.open({ reasonCode: 'QUESTION_PUBLISH' })
    })
    await act(async () => {
      await result.current
        .reauthenticate(MOCK_ADMIN_PASSWORD)
        .catch(() => undefined)
    })

    expect(result.current.isOpen).toBe(false)
    expect(result.current.completionMessage).toBeNull()
    expect(useAppStore.getState().currentUser?.role).toBe('USER')
  })
})
