import { act, render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  onlineManager
} from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { appRoutes } from '@/router'
import * as auth from '@nihongo/browser/api/auth/getCurrentUser/index'
import { ConnectionPage } from '@app/development/page'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { mockServer } from '@/test/server'
import { writeUiLocalePreference } from '@nihongo/browser/libs/localeStorage'

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <I18nProvider>
        <ConnectionPage />
      </I18nProvider>
    </QueryClientProvider>
  )

it.each(['{Enter}', ' '])(
  'checks once, fails without retry, then recovers manually with %s and focus retained',
  async (key) => {
    let calls = 0
    let recover: (() => void) | undefined
    mockServer.use(
      http.get('*/health/live', async () => {
        calls++
        if (calls === 1) return new HttpResponse(null, { status: 503 })
        await new Promise<void>((resolve) => {
          recover = resolve
        })
        return HttpResponse.json({ status: 'ok' })
      })
    )
    renderPage()
    expect(screen.getByText('연결 확인 중')).toBeInTheDocument()
    const button = await screen.findByRole('button', { name: '다시 시도' })
    expect(calls).toBe(1)
    const user = userEvent.setup()
    await user.tab()
    expect(button).toHaveFocus()
    await user.keyboard(key)
    await screen.findByRole('button', { name: '다시 확인 중…' })
    fireEvent.click(button)
    await waitFor(() => expect(recover).toBeDefined())
    expect(calls).toBe(2)
    recover?.()
    await screen.findByText('연결됨')
    expect(button).toHaveFocus()
    expect(screen.getAllByRole('status')).toHaveLength(1)
  }
)

it('uses the existing Japanese locale preference', async () => {
  writeUiLocalePreference('ja')
  mockServer.use(
    http.get('*/health/live', () => HttpResponse.json({ status: 'ok' }))
  )
  renderPage()
  expect(
    screen.getByRole('heading', { name: '開発用接続状態' })
  ).toBeInTheDocument()
  await screen.findByText('接続済み')
})

it('enters the DEV URL outside the product Layout and auth, with no focus/reconnect polling', async () => {
  const currentUser = vi.spyOn(auth, 'getCurrentUser')
  let calls = 0
  mockServer.use(
    http.get('*/health/live', () => {
      calls++
      return HttpResponse.json({ status: 'ok' })
    })
  )
  const client = new QueryClient()
  const router = createMemoryRouter(appRoutes, {
    initialEntries: ['/dev/connection']
  })
  const rendered = render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <RouterProvider router={router} />
      </I18nProvider>
    </QueryClientProvider>
  )
  expect(await screen.findByText('연결됨')).toBeVisible()
  expect(currentUser).not.toHaveBeenCalled()
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument()
  expect(screen.getByText(/개발 환경 전용/)).toBeVisible()
  await act(async () => {
    focusManager.setFocused(false)
    focusManager.setFocused(true)
    onlineManager.setOnline(false)
    onlineManager.setOnline(true)
  })
  expect(calls).toBe(1)
  focusManager.setFocused(undefined)
  rendered.unmount()
  client.clear()
})
