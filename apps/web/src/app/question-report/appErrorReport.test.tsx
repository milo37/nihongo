import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@nihongo/browser/common/components/Toast'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Layout } from '@app/layout'
import { AppErrorReportButton } from '@app/question-report/components/AppErrorReportDialog'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { appI18n } from '@nihongo/browser/i18n/config'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { ProtectedRouteProvider } from '@nihongo/browser/provider/ProtectedRouteProvider'

const clients: QueryClient[] = []
afterEach(() => clients.splice(0).forEach((client) => client.clear()))

const renderAt = (path: string, element: ReactElement) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  })
  clients.push(client)
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: <ProtectedRouteProvider>{element}</ProtectedRouteProvider>
      }
    ],
    { initialEntries: [path] }
  )
  render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>
  )
}

const submitAppError = async (description: string) => {
  const user = userEvent.setup()
  const dialog = await screen.findByRole('dialog', { name: '앱 오류 제보' })
  expect(within(dialog).queryByRole('combobox')).toBeNull()
  const textbox = within(dialog).getByRole('textbox', { name: /설명/u })
  // The contract caps the description at 1,000 characters.
  expect(textbox).toHaveAttribute('maxLength', '1000')
  await user.type(textbox, description)
  await user.click(within(dialog).getByRole('button', { name: '신고 접수' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
}

describe('APP_ERROR report entry points', () => {
  it('sends an APP_ERROR from the learner account menu with the screen key', async () => {
    mockDatabase.loginAs('USER')
    renderAt('/dashboard', <Layout />)
    const account = await screen.findByRole('button', {
      name: appI18n.t('navigation:accountMenu.label')
    })
    // The signed-in trigger shows the member avatar and name.
    await waitFor(() => expect(account).toHaveClass('account-menu-trigger'))
    await userEvent.click(account)
    await userEvent.click(
      screen.getByRole('menuitem', { name: '앱 오류 제보' })
    )
    await submitAppError('대시보드 숫자가 비어 있습니다.')
    expect(mockDatabase.peekUserReports()).toEqual([
      expect.objectContaining({
        kind: 'APP_ERROR',
        location: 'dashboard',
        questionVersionId: null,
        description: '대시보드 숫자가 비어 있습니다.'
      })
    ])
    expect(account).toHaveFocus()
  })

  it('sends an APP_ERROR from an error screen button without question IDs', async () => {
    mockDatabase.loginAs('USER')
    renderAt(
      '/wrong-notes/019d0000-0000-7000-8000-000000000001',
      <AppErrorReportButton />
    )
    await userEvent.click(
      await screen.findByRole('button', { name: '오류 제보' })
    )
    await submitAppError('오답 상세를 불러오지 못했습니다.')
    expect(mockDatabase.peekUserReports()).toEqual([
      expect.objectContaining({
        kind: 'APP_ERROR',
        location: 'wrongNoteDetail',
        questionVersionId: null
      })
    ])
    expect(await screen.findByText('오류 제보를 보냈어요.')).toBeInTheDocument()
  })

  it('hides the error screen button from guests', async () => {
    renderAt('/dashboard', <AppErrorReportButton />)
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '오류 제보' })).toBeNull()
    )
  })
})
