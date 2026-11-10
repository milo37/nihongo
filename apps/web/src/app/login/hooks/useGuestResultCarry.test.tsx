import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'
import { ToastProvider } from '@nihongo/browser/common/components/Toast'
import { appI18n } from '@nihongo/browser/i18n/config'
import { queryClient } from '@nihongo/browser/libs/queryClient'
import { GuestResultCarry } from '@app/login/components/GuestResultCarry'
import {
  markGuestCarryPending,
  takeGuestCarryPending
} from '@app/login/guestCarryMarker'
import { mockGuestResultImport } from '@mocks/handlers/guestResultImportHandlers'
import { MockHttpError } from '@mocks/handlers/shared'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { mockServer } from '@/test/server'

const auth = vi.hoisted(() => ({
  user: null as { id: string } | null
}))
vi.mock('@nihongo/browser/provider/ProtectedRouteProvider', () => ({
  useAuth: () => ({
    isReady: true,
    role: auth.user ? 'USER' : 'GUEST',
    user: auth.user
  })
}))

const SESSION_ID = '018f6b7a-1f4b-7d5e-8a91-000000000901'
let calls = 0

beforeEach(() => {
  calls = 0
  sessionStorage.clear()
  mockServer.events.on('request:start', ({ request }) => {
    if (request.url.endsWith('/api/v1/me/guest-result-import')) calls += 1
  })
  const member = mockDatabase.loginAs('USER')
  auth.user = { id: member.id }
})
afterEach(() => mockServer.events.removeAllListeners())

const renderCarry = () =>
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <GuestResultCarry />
      </ToastProvider>
    </QueryClientProvider>
  )

it.each([
  ['ko', '방금 푼 틀린 문제 3개를 오답노트에 모았어요.'],
  ['ja', 'さっき間違えた3問を間違いノートに集めました。']
] as const)(
  'moves the guest result once after sign-in and says so (%s)',
  async (locale, text) => {
    await appI18n.changeLanguage(locale)
    mockGuestResultImport.setNext({
      importedSessionId: SESSION_ID,
      wrongAnswerCount: 3
    })
    markGuestCarryPending()
    const view = renderCarry()
    expect(await screen.findByText(text)).toBeVisible()
    expect(calls).toBe(1)
    expect(takeGuestCarryPending()).toBe(false)
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <GuestResultCarry />
        </ToastProvider>
      </QueryClientProvider>
    )
    expect(calls).toBe(1)
    await appI18n.changeLanguage('ko')
  }
)

it('stays quiet when nothing or no wrong answer moved', async () => {
  for (const next of [
    { importedSessionId: null, wrongAnswerCount: 0 },
    { importedSessionId: SESSION_ID, wrongAnswerCount: 0 }
  ]) {
    mockGuestResultImport.setNext(next)
    markGuestCarryPending()
    const view = renderCarry()
    await waitFor(() => expect(takeGuestCarryPending()).toBe(false))
    await waitFor(() => expect(queryClient.isMutating()).toBe(0))
    expect(screen.queryByRole('status', { name: /오답노트/u })).toBeNull()
    expect(screen.queryByText(/오답노트/u)).toBeNull()
    view.unmount()
  }
  expect(calls).toBe(2)
})

it('does not call without a sign-in mark or while a guest', async () => {
  renderCarry().unmount()
  auth.user = null
  markGuestCarryPending()
  renderCarry()
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(calls).toBe(0)
  expect(takeGuestCarryPending()).toBe(true)
})

it('shows the light failure line on a server failure, not on 401', async () => {
  mockGuestResultImport.setNext(
    new MockHttpError(503, 'SERVICE_UNAVAILABLE', 'down')
  )
  markGuestCarryPending()
  const view = renderCarry()
  expect(
    await screen.findByText(
      '방금 푼 문제를 오답노트로 옮기지 못했어요. 다음에 틀린 문제부터 모여요.'
    )
  ).toBeVisible()
  view.unmount()
  mockServer.use(
    http.post('*/api/v1/me/guest-result-import', () =>
      HttpResponse.json(
        { code: 'AUTHENTICATION_REQUIRED', message: 'no', requestId: 'r' },
        { status: 401 }
      )
    )
  )
  markGuestCarryPending()
  renderCarry()
  await waitFor(() => expect(calls).toBe(2))
  await waitFor(() => expect(queryClient.isMutating()).toBe(0))
  expect(screen.queryByText(/옮기지 못했어요/u)).toBeNull()
})
