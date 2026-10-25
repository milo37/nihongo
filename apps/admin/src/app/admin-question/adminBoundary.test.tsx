import '@testing-library/jest-dom/vitest'
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
  waitFor
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { ReactElement, ReactNode } from 'react'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { ToastProvider } from '@nihongo/browser/common/components/Toast'
import { appI18n } from '@nihongo/browser/i18n/config'
import * as previewApi from '@nihongo/browser/api/admin-question/previewQuestionVersion/index'
import { useAppStore } from '@nihongo/browser/store/index'
import * as getApi from '@nihongo/browser/api/admin-question/getAdminQuestion/index'
import * as updateApi from '@nihongo/browser/api/admin-question/updateAdminQuestion/index'
import * as deleteApi from '@nihongo/browser/api/admin-question/deleteAdminQuestion/index'
import { serverStateQueryKeys } from '@nihongo/browser/libs/serverStateQueryKeys'
import { EditAdminQuestionPage } from '@app/admin-question/edit/page'
import { adminQuestionQueries } from '@app/admin-question/queries/adminQuestionQueries'
import { useDeleteAdminQuestion } from '@app/admin-question/hooks/useDeleteAdminQuestion'
import { useUpdateAdminQuestion } from '@app/admin-question/hooks/useUpdateAdminQuestion'
import {
  question,
  input,
  detail,
  preview,
  versionId,
  actorId,
  archiveInput,
  updateReceipt,
  archiveReceipt
} from '@app/admin-question/test/questionFixture'

const clients: QueryClient[] = []
const createClient = (): QueryClient => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
  clients.push(client)
  return client
}
const wrapper =
  (client: QueryClient) =>
  ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={client}>
      <I18nProvider>
        <ToastProvider>{children}</ToastProvider>
      </I18nProvider>
    </QueryClientProvider>
  )
const relatedKeys = [
  serverStateQueryKeys.bookmark.all(),
  serverStateQueryKeys.wrongNote.all(),
  serverStateQueryKeys.dashboard.all(),
  adminQuestionQueries.allKey()
]
const seedRelated = (client: QueryClient): void => {
  for (const key of relatedKeys)
    client.setQueryData([...key, 'seed'], { cached: true })
}
const expectInvalidated = (client: QueryClient, expected: boolean): void => {
  for (const key of relatedKeys)
    expect(client.getQueryState([...key, 'seed'])?.isInvalidated).toBe(expected)
}
beforeEach(async () => {
  await appI18n.changeLanguage('ko')
  useAppStore.getState().setCurrentUser({
    id: actorId,
    name: '테스트',
    role: 'ADMIN',
    targetLevel: 'N3'
  })
  vi.spyOn(previewApi, 'previewQuestionVersion').mockResolvedValue(preview)
})
afterEach(() => {
  cleanup()
  for (const client of clients.splice(0)) client.clear()
  vi.restoreAllMocks()
})

describe('admin cache contracts migrated from the mixed learner suite', () => {
  it('updates detail and invalidates all related domains after update', async () => {
    vi.spyOn(updateApi, 'updateAdminQuestion').mockResolvedValue(updateReceipt)
    const client = createClient()
    seedRelated(client)
    client.setQueryData(
      adminQuestionQueries.detail(question.questionId).queryKey,
      detail
    )
    const { result } = renderHook(() => useUpdateAdminQuestion(), {
      wrapper: wrapper(client)
    })
    await act(async () => {
      await result.current.mutateAsync({
        questionId: question.questionId,
        versionId,
        input
      })
    })
    expect(
      client.getQueryData(
        adminQuestionQueries.detail(question.questionId).queryKey
      )
    ).toEqual(detail)
    expectInvalidated(client, true)
  })
  it('removes only the deleted detail and invalidates related domains', async () => {
    vi.spyOn(deleteApi, 'deleteAdminQuestion').mockResolvedValue(archiveReceipt)
    const client = createClient()
    seedRelated(client)
    client.setQueryData(
      adminQuestionQueries.detail(question.questionId).queryKey,
      detail
    )
    const { result } = renderHook(() => useDeleteAdminQuestion(), {
      wrapper: wrapper(client)
    })
    await act(async () => {
      await result.current.mutateAsync({
        questionId: question.questionId,
        input: archiveInput
      })
    })
    expect(
      client.getQueryData(
        adminQuestionQueries.detail(question.questionId).queryKey
      )
    ).toBeUndefined()
    expectInvalidated(client, true)
  })
  it('does not set/remove detail or invalidate related domains when either mutation fails', async () => {
    vi.spyOn(updateApi, 'updateAdminQuestion').mockRejectedValue(
      new Error('failure')
    )
    vi.spyOn(deleteApi, 'deleteAdminQuestion').mockRejectedValue(
      new Error('failure')
    )
    const client = createClient()
    seedRelated(client)
    client.setQueryData(
      adminQuestionQueries.detail(question.questionId).queryKey,
      detail
    )
    const { result } = renderHook(
      () => ({
        update: useUpdateAdminQuestion(),
        remove: useDeleteAdminQuestion()
      }),
      { wrapper: wrapper(client) }
    )
    await act(async () => {
      await expect(
        result.current.update.mutateAsync({
          questionId: question.questionId,
          versionId,
          input
        })
      ).rejects.toThrow('failure')
      await expect(
        result.current.remove.mutateAsync({
          questionId: question.questionId,
          input: archiveInput
        })
      ).rejects.toThrow('failure')
    })
    expect(
      client.getQueryData(
        adminQuestionQueries.detail(question.questionId).queryKey
      )
    ).toEqual(detail)
    expectInvalidated(client, false)
  })
})
const renderEdit = (client: QueryClient): void => {
  const router = createMemoryRouter(
    [
      {
        path: '/questions/:questionId/edit',
        element: <EditAdminQuestionPage />
      }
    ],
    {
      basename: '/admin',
      initialEntries: ['/admin/questions/' + question.questionId + '/edit']
    }
  )
  const Wrapper = wrapper(client)
  render(
    <Wrapper>
      <RouterProvider router={router} />
    </Wrapper>
  )
}
describe('admin error semantics migrated from the mixed learner suite', () => {
  it('shows retryable server error rather than missing, then restores form and focus', async () => {
    const user = userEvent.setup()
    vi.spyOn(getApi, 'getAdminQuestion')
      .mockRejectedValueOnce(new Error('server error'))
      .mockResolvedValue(detail)
    renderEdit(createClient())
    expect(
      await screen.findByRole('heading', {
        name: '문제 정보를 불러오지 못했습니다'
      })
    ).toBeVisible()
    expect(
      screen.queryByRole('heading', { name: '수정할 문제를 찾을 수 없습니다' })
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '다시 시도' }))
    const heading = await screen.findByRole('heading', { name: '문제 수정' })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(getApi.getAdminQuestion).toHaveBeenCalledTimes(2)
  })
  it('shows missing only for a real normalized 404', async () => {
    vi.spyOn(getApi, 'getAdminQuestion').mockRejectedValue(
      Object.assign(new Error('not found'), {
        isNotFoundError: true,
        status: 404
      })
    )
    renderEdit(createClient())
    expect(
      await screen.findByRole('heading', {
        name: '수정할 문제를 찾을 수 없습니다'
      })
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: '다시 시도' })
    ).not.toBeInTheDocument()
  })
})
