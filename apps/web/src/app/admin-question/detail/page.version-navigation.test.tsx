import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, RouterProvider } from 'react-router'
import {
  encodeAdminQuestionVersionCursor,
  listAdminQuestionsResponseSchema,
  listAdminQuestionVersionsResponseSchema,
  listQuestionVersionReviewsResponseSchema,
  previewQuestionVersionResponseSchema,
  type AdminQuestionVersionSummary
} from '@nihongo/contracts/admin/phase7'
import { beforeEach, describe, expect, it } from 'vitest'
import { AdminQuestionDetailPage } from '@app/admin-question/detail/page'
import { resetAdminCmsReadRateLimitForTesting } from '@mocks/handlers/adminCmsReadHandlers'
import { DEMO_ADMIN_ID } from '@mocks/data/users'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { useAppStore } from '@store/index'
import { mockServer } from '@/test/server'

const ADMIN_BASE = 'http://localhost/api/v1/admin'
const deepVersionId = '10000000-0000-4000-8000-000000000002'
const staleVersionId = '90000000-0000-4000-8000-000000000099'

const canonicalHeaders = (): Headers =>
  new Headers({
    'Cache-Control': 'private, no-store',
    'X-Request-Id': crypto.randomUUID()
  })

const createVersionId = (versionNumber: number): string =>
  `10000000-0000-4000-8000-${String(versionNumber).padStart(12, '0')}`

const createPagedVersionFixture = async (): Promise<{
  readonly cursor: string
  readonly deepVersion: AdminQuestionVersionSummary
  readonly firstPage: ReturnType<
    typeof listAdminQuestionVersionsResponseSchema.parse
  >
  readonly preview: ReturnType<
    typeof previewQuestionVersionResponseSchema.parse
  >
  readonly questionId: string
  readonly reviews: ReturnType<
    typeof listQuestionVersionReviewsResponseSchema.parse
  >
  readonly secondPage: ReturnType<
    typeof listAdminQuestionVersionsResponseSchema.parse
  >
}> => {
  const admin = mockDatabase.loginAs('ADMIN', DEMO_ADMIN_ID)
  useAppStore.getState().setCurrentUser(admin)

  const listResponse = await fetch(`${ADMIN_BASE}/questions?pageSize=1`)
  const list = listAdminQuestionsResponseSchema.parse(await listResponse.json())
  const question = list.items[0]
  if (!question) throw new Error('Admin question fixture is missing.')

  const [historyResponse, previewResponse, reviewsResponse] = await Promise.all(
    [
      fetch(`${ADMIN_BASE}/questions/${question.questionId}/versions?limit=20`),
      fetch(
        `${ADMIN_BASE}/question-versions/${question.selectedVersionId}/preview`
      ),
      fetch(
        `${ADMIN_BASE}/question-versions/${question.selectedVersionId}/reviews?limit=20`
      )
    ]
  )
  const history = listAdminQuestionVersionsResponseSchema.parse(
    await historyResponse.json()
  )
  const sourceVersion = history.items[0]
  if (!sourceVersion) throw new Error('Admin version fixture is missing.')
  const preview = previewQuestionVersionResponseSchema.parse(
    await previewResponse.json()
  )
  const reviews = listQuestionVersionReviewsResponseSchema.parse(
    await reviewsResponse.json()
  )

  const firstPageItems = Array.from({ length: 20 }, (_, index) => {
    const versionNumber = 22 - index
    return {
      ...sourceVersion,
      questionTextPreview: `version ${versionNumber}`,
      questionVersionId:
        index === 0
          ? question.selectedVersionId
          : createVersionId(versionNumber),
      versionNumber
    }
  })
  const lastFirstPageItem = firstPageItems.at(-1)
  if (!lastFirstPageItem) throw new Error('First version page is empty.')
  const cursor = encodeAdminQuestionVersionCursor({
    id: lastFirstPageItem.questionVersionId,
    versionNumber: lastFirstPageItem.versionNumber
  })
  const deepVersion: AdminQuestionVersionSummary = {
    ...sourceVersion,
    questionTextPreview: 'deep linked version',
    questionVersionId: deepVersionId,
    versionNumber: 2
  }

  return {
    cursor,
    deepVersion,
    firstPage: listAdminQuestionVersionsResponseSchema.parse({
      ...history,
      items: firstPageItems,
      nextCursor: cursor
    }),
    preview,
    questionId: question.questionId,
    reviews,
    secondPage: listAdminQuestionVersionsResponseSchema.parse({
      ...history,
      items: [deepVersion],
      nextCursor: null
    })
  }
}

const installPagedVersionHandlers = (
  fixture: Awaited<ReturnType<typeof createPagedVersionFixture>>,
  historyRequests: string[],
  previewRequests: string[]
): void => {
  mockServer.use(
    http.get(
      `*/api/v1/admin/questions/${fixture.questionId}/versions`,
      ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor') ?? ''
        historyRequests.push(cursor)
        return HttpResponse.json(
          cursor === fixture.cursor ? fixture.secondPage : fixture.firstPage,
          { headers: canonicalHeaders() }
        )
      }
    ),
    http.get(
      `*/api/v1/admin/question-versions/${deepVersionId}/preview`,
      () => {
        previewRequests.push(deepVersionId)
        return HttpResponse.json(
          {
            ...fixture.preview,
            question: {
              ...fixture.preview.question,
              questionVersionId: deepVersionId
            }
          },
          { headers: canonicalHeaders() }
        )
      }
    ),
    http.get(`*/api/v1/admin/question-versions/${deepVersionId}/reviews`, () =>
      HttpResponse.json(
        {
          ...fixture.reviews,
          items: [],
          nextCursor: null,
          questionVersionId: deepVersionId
        },
        { headers: canonicalHeaders() }
      )
    ),
    http.get(
      `*/api/v1/admin/question-versions/${staleVersionId}/preview`,
      () => {
        previewRequests.push(staleVersionId)
        return HttpResponse.json(null, {
          headers: canonicalHeaders(),
          status: 500
        })
      }
    )
  )
}

const renderDetailPage = (questionId: string, search: string) => {
  const client = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false }
    }
  })
  const router = createMemoryRouter(
    [
      {
        path: '/admin/questions/:questionId',
        element: <AdminQuestionDetailPage />
      }
    ],
    { initialEntries: [`/admin/questions/${questionId}${search}`] }
  )
  const rendered = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return { client, router, unmount: rendered.unmount }
}

beforeEach(() => {
  resetAdminCmsReadRateLimitForTesting()
})

describe('AdminQuestionDetailPage version URL navigation', () => {
  it('restores a second-page version on reload and browser back', async () => {
    const fixture = await createPagedVersionFixture()
    const historyRequests: string[] = []
    const previewRequests: string[] = []
    installPagedVersionHandlers(fixture, historyRequests, previewRequests)
    const interaction = userEvent.setup()
    const { client, router } = renderDetailPage(
      fixture.questionId,
      `?version=${deepVersionId}`
    )

    const deepVersionButton = await screen.findByRole('button', {
      name: /^v2 ·/u
    })
    expect(deepVersionButton).toHaveAttribute('aria-current', 'true')
    expect(historyRequests).toEqual(['', fixture.cursor])
    expect(previewRequests).toEqual([deepVersionId])
    expect(router.state.location.search).toBe(`?version=${deepVersionId}`)

    await interaction.click(
      screen.getByRole('button', {
        name: /^v22 ·/u
      })
    )
    expect(router.state.location.search).not.toBe(`?version=${deepVersionId}`)
    const diffHeading = await screen.findByRole('heading', {
      name: '이전 버전과 차이'
    })
    const diffContainer = diffHeading.parentElement
    if (!diffContainer) throw new Error('Version diff container is missing.')
    const diffStatus = within(diffContainer).getByRole('status')
    expect(diffContainer).not.toHaveAttribute('aria-live')
    expect(diffStatus).toHaveAttribute('aria-atomic', 'true')
    const detailedDiff =
      within(diffContainer).queryByLabelText('버전별 변경 내용')
    if (detailedDiff) expect(diffStatus).not.toContainElement(detailedDiff)

    await act(async () => {
      await router.navigate(-1)
    })
    await waitFor(() => {
      expect(router.state.location.search).toBe(`?version=${deepVersionId}`)
      expect(deepVersionButton).toHaveAttribute('aria-current', 'true')
    })
    client.clear()
  })

  it('replaces malformed and exhausted stale version URLs without previewing them', async () => {
    const malformedFixture = await createPagedVersionFixture()
    const malformedHistoryRequests: string[] = []
    const malformedPreviewRequests: string[] = []
    installPagedVersionHandlers(
      malformedFixture,
      malformedHistoryRequests,
      malformedPreviewRequests
    )
    const malformed = renderDetailPage(
      malformedFixture.questionId,
      '?version=not-a-version-id'
    )

    await waitFor(() => {
      expect(malformed.router.state.location.search).toBe('')
      expect(malformedHistoryRequests).toEqual([''])
    })
    expect(malformedPreviewRequests).toEqual([])
    malformed.unmount()
    malformed.client.clear()

    const staleFixture = await createPagedVersionFixture()
    const staleHistoryRequests: string[] = []
    const stalePreviewRequests: string[] = []
    installPagedVersionHandlers(
      staleFixture,
      staleHistoryRequests,
      stalePreviewRequests
    )
    const stale = renderDetailPage(
      staleFixture.questionId,
      `?version=${staleVersionId}`
    )

    await waitFor(() => {
      expect(staleHistoryRequests).toEqual(['', staleFixture.cursor])
      expect(stale.router.state.location.search).toBe('')
    })
    expect(stalePreviewRequests).toEqual([])
    stale.client.clear()
  })
})
