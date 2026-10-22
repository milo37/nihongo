import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { apiClient } from '@api/config'
import {
  AdminQuestionPage,
  parseAdminQuestionSearch
} from '@app/admin-question/page'
import { appI18n } from '@/i18n/config'
import { DEMO_ADMIN_ID } from '@mocks/data/users'
import { toCanonicalAdminQuestionList } from '@mocks/adapters/adminCmsReadContractAdapter'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { mockServer } from '@/test/server'

const createDeferred = (): {
  promise: Promise<void>
  release: () => void
} => {
  let release: (() => void) | undefined
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release: () => release?.() }
}

const renderPage = (
  initialEntries: string[] = ['/admin/questions'],
  initialIndex = 0
) => {
  const client = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false }
    }
  })
  const router = createMemoryRouter(
    [{ path: '/admin/questions', element: <AdminQuestionPage /> }],
    { initialEntries, initialIndex }
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
  it('replaces an out-of-range page so browser back escapes the correction', async () => {
    mockDatabase.loginAs('ADMIN', DEMO_ADMIN_ID)
    const sources = mockDatabase.listPhase7AuthoritativeAdminQuestionSources()
    const model = {
      snapshot: mockDatabase.getCanonicalAdminCmsSnapshot(sources),
      sources
    }
    const correctionGate = createDeferred()
    let correctedPage = 1
    let correctionStarted = false
    mockServer.use(
      http.get('*/api/v1/admin/questions', async ({ request }) => {
        const query = parseAdminQuestionSearch(
          new URL(request.url).searchParams
        ).query
        const response = toCanonicalAdminQuestionList(model, query)
        correctedPage = Math.max(
          1,
          Math.ceil(response.total / response.pageSize)
        )
        if (query.page === correctedPage && query.page !== 999) {
          correctionStarted = true
          await correctionGate.promise
        }
        return HttpResponse.json(response, {
          headers: {
            'Cache-Control': 'private, no-store',
            'X-Request-Id': crypto.randomUUID()
          }
        })
      })
    )
    const { client, router, unmount } = renderPage(
      [
        '/admin/questions?status=PUBLISHED',
        '/admin/questions?page=999&status=PUBLISHED'
      ],
      1
    )

    await waitFor(() => {
      expect(
        new URLSearchParams(router.state.location.search).get('page')
      ).toBe(String(correctedPage))
    })
    await waitFor(() => expect(correctionStarted).toBe(true))
    expect(screen.getByRole('status')).toHaveTextContent(
      '최신 목록을 확인 중입니다.'
    )
    expect(document.querySelector('#admin-question-results')).toHaveAttribute(
      'aria-busy',
      'true'
    )
    expect(
      screen.queryByRole('heading', { name: '표시할 문제가 없습니다' })
    ).not.toBeInTheDocument()

    await act(async () => correctionGate.release())
    await screen.findByRole('region', {
      name: '관리자 문제 목록 가로 스크롤 영역'
    })
    expect(document.querySelector('#admin-question-results')).toHaveAttribute(
      'aria-busy',
      'false'
    )
    await act(async () => {
      await router.navigate(-1)
    })
    await waitFor(() => {
      expect(router.state.location.search).toBe('?status=PUBLISHED')
    })

    unmount()
    client.clear()
  })

  it('announces an empty-to-results transition while retaining placeholder data', async () => {
    mockDatabase.loginAs('ADMIN', DEMO_ADMIN_ID)
    const sources = mockDatabase.listPhase7AuthoritativeAdminQuestionSources()
    const model = {
      snapshot: mockDatabase.getCanonicalAdminCmsSnapshot(sources),
      sources
    }
    const resultsGate = createDeferred()
    let resultsStarted = false
    mockServer.use(
      http.get('*/api/v1/admin/questions', async ({ request }) => {
        const query = parseAdminQuestionSearch(
          new URL(request.url).searchParams
        ).query
        const response = toCanonicalAdminQuestionList(model, query)
        if (query.q === undefined) {
          resultsStarted = true
          await resultsGate.promise
        }
        return HttpResponse.json(response, {
          headers: {
            'Cache-Control': 'private, no-store',
            'X-Request-Id': crypto.randomUUID()
          }
        })
      })
    )
    const { client, router, unmount } = renderPage([
      '/admin/questions?q=phase9-no-match'
    ])
    await screen.findByRole('heading', { name: '표시할 문제가 없습니다' })

    await act(async () => router.navigate('/admin/questions'))
    await waitFor(() => expect(resultsStarted).toBe(true))
    expect(screen.getByRole('status')).toHaveTextContent(
      '최신 목록을 확인 중입니다.'
    )
    expect(document.querySelector('#admin-question-results')).toHaveAttribute(
      'aria-busy',
      'true'
    )
    expect(screen.queryByRole('table')).not.toBeInTheDocument()

    await act(async () => resultsGate.release())
    await screen.findByRole('table')
    expect(document.querySelector('#admin-question-results')).toHaveAttribute(
      'aria-busy',
      'false'
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    unmount()
    client.clear()
  })

  it('does not clamp a valid page restored by browser back with placeholder totals', async () => {
    mockDatabase.loginAs('ADMIN', DEMO_ADMIN_ID)
    const sources = mockDatabase.listPhase7AuthoritativeAdminQuestionSources()
    const model = {
      snapshot: mockDatabase.getCanonicalAdminCmsSnapshot(sources),
      sources
    }
    const pageFourGate = createDeferred()
    let pageFourStarted = false
    let pageFourQuestion = ''
    mockServer.use(
      http.get('*/api/v1/admin/questions', async ({ request }) => {
        const query = parseAdminQuestionSearch(
          new URL(request.url).searchParams
        ).query
        const response = toCanonicalAdminQuestionList(model, query)
        if (query.page === 4 && query.level === undefined) {
          pageFourStarted = true
          pageFourQuestion = response.items[0]?.questionTextPreview ?? ''
          await pageFourGate.promise
        }
        return HttpResponse.json(response, {
          headers: {
            'Cache-Control': 'private, no-store',
            'X-Request-Id': crypto.randomUUID()
          }
        })
      })
    )
    const { client, router, unmount } = renderPage(
      ['/admin/questions?page=4', '/admin/questions?level=N1'],
      1
    )
    await screen.findByRole('region', {
      name: '관리자 문제 목록 가로 스크롤 영역'
    })

    await act(async () => router.navigate(-1))
    await waitFor(() => expect(pageFourStarted).toBe(true))
    expect(router.state.location.search).toBe('?page=4')
    expect(screen.getByText('최신 목록을 확인 중입니다.')).toHaveAttribute(
      'role',
      'status'
    )
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true')

    await act(async () => pageFourGate.release())
    await waitFor(() => expect(client.isFetching()).toBe(0))
    expect(router.state.location.search).toBe('?page=4')
    expect(pageFourQuestion).not.toBe('')
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === 'SPAN' &&
          element.textContent === pageFourQuestion
      )
    ).toBeVisible()
    expect(
      screen.queryByText('최신 목록을 확인 중입니다.')
    ).not.toBeInTheDocument()
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'false')
    expect(screen.getByRole('link', { current: 'page' })).toHaveTextContent('4')
    unmount()
    client.clear()
  })

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
