import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { apiClient } from '@api/config'
import { AdminQuestionPage } from '@app/admin-question/page'
import { appI18n } from '@/i18n/config'
import { DEMO_ADMIN_ID } from '@mocks/data/users'
import { mockDatabase } from '@mocks/repository/mockDatabase'

const renderPage = () => {
  const client = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false }
    }
  })
  const router = createMemoryRouter(
    [{ path: '/admin/questions', element: <AdminQuestionPage /> }],
    { initialEntries: ['/admin/questions'] }
  )
  const rendered = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return { client, router, unmount: rendered.unmount }
}

const expectOnlySortedHeader = (
  name: '분류' | '신고' | '생성일' | '수정일',
  direction: 'ascending' | 'descending'
): void => {
  for (const candidate of ['분류', '신고', '생성일', '수정일'] as const) {
    const header = screen.getByRole('columnheader', {
      name: new RegExp(`^${candidate}`, 'u')
    })
    if (candidate === name)
      expect(header).toHaveAttribute('aria-sort', direction)
    else expect(header).not.toHaveAttribute('aria-sort')
  }
}

describe('AdminQuestionPage list accessibility', () => {
  it('keeps sort focus and announces each canonical sort column', async () => {
    mockDatabase.loginAs('ADMIN', DEMO_ADMIN_ID)
    const user = userEvent.setup()
    const { client, router, unmount } = renderPage()

    await screen.findByRole('region', {
      name: '관리자 문제 목록 가로 스크롤 영역'
    })
    expectOnlySortedHeader('수정일', 'descending')
    const sort = screen.getByRole('combobox', { name: '정렬' })
    sort.focus()

    await user.keyboard('{ArrowDown}')
    await waitFor(() =>
      expect(router.state.location.search).toBe('?sort=CREATED_DESC')
    )
    expect(sort).toHaveFocus()
    expectOnlySortedHeader('생성일', 'descending')

    await user.keyboard('{ArrowDown}')
    await waitFor(() =>
      expect(router.state.location.search).toBe('?sort=LEVEL_ASC')
    )
    expect(sort).toHaveFocus()
    expectOnlySortedHeader('분류', 'ascending')

    await user.keyboard('{ArrowDown}')
    await waitFor(() =>
      expect(router.state.location.search).toBe('?sort=REPORT_COUNT_DESC')
    )
    expect(sort).toHaveFocus()
    expectOnlySortedHeader('신고', 'descending')

    const updatedSortButton = screen.getByRole('button', {
      name: '수정일, 최근순으로 정렬'
    })
    await user.click(updatedSortButton)
    await waitFor(() => expect(router.state.location.search).toBe(''))
    expect(updatedSortButton).toHaveFocus()
    expectOnlySortedHeader('수정일', 'descending')

    unmount()
    client.clear()
  })

  it('preserves canonical filters and selection without a request on locale change', async () => {
    mockDatabase.loginAs('ADMIN', DEMO_ADMIN_ID)
    const user = userEvent.setup()
    const get = vi.spyOn(apiClient, 'get')
    const { client, router, unmount } = renderPage()

    await screen.findByRole('region', {
      name: '관리자 문제 목록 가로 스크롤 영역'
    })
    const sort = screen.getByRole('combobox', { name: '정렬' })
    await user.selectOptions(sort, 'CREATED_DESC')
    await waitFor(() => {
      expect(router.state.location.search).toBe('?sort=CREATED_DESC')
      expect(client.isFetching()).toBe(0)
    })
    const selectedQuestion = screen.getAllByRole('checkbox')[0]
    if (!selectedQuestion) throw new Error('A selectable question is required.')
    await user.click(selectedQuestion)
    expect(selectedQuestion).toBeChecked()
    const requestCount = get.mock.calls.length

    await act(async () => appI18n.changeLanguage('ja'))

    expect(screen.getByRole('heading', { name: '問題管理' })).toBeVisible()
    expect(screen.getByRole('combobox', { name: '並び順' })).toHaveValue(
      'CREATED_DESC'
    )
    expect(selectedQuestion).toBeChecked()
    expect(screen.getByText(/^1件選択中/u)).toBeVisible()
    expect(router.state.location.search).toBe('?sort=CREATED_DESC')
    expect(get).toHaveBeenCalledTimes(requestCount)

    unmount()
    client.clear()
  })
})
