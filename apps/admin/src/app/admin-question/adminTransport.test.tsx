import {
  cleanup,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider
} from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { apiClient } from '@nihongo/browser/api/config'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { ToastProvider } from '@nihongo/browser/common/components/Toast'
import { AuthErrorHandlerProvider } from '@nihongo/browser/provider/AuthErrorHandlerProvider'
import { emitApiError } from '@nihongo/browser/libs/errorBus'
import { appDocumentNavigation } from '@nihongo/browser/libs/appNavigation'
import { useAppStore } from '@nihongo/browser/store/index'
import { invalidateCanonicalAuthTransitions } from '@nihongo/browser/app/login/authSession'
import {
  adminQuestionQueries,
  adminQuestionMutations
} from '@app/admin-question/queries/adminQuestionQueries'
import { AdminQuestionPage } from '@app/admin-question/page'
import { CreateAdminQuestionPage } from '@app/admin-question/create/page'
import { EditAdminQuestionPage } from '@app/admin-question/edit/page'
import {
  actorId,
  question,
  detail,
  preview,
  versionId,
  input,
  createInput,
  archiveInput,
  createReceipt,
  updateReceipt,
  archiveReceipt
} from '@app/admin-question/test/questionFixture'

const requestId = '30000000-0000-4000-8000-000000000001'
const originalAdapter = apiClient.defaults.adapter
const calls: { url: string; method: string; params: unknown; body: unknown }[] =
  []
let responder: (
  url: string,
  method: string
) => { data: unknown; status: number; headers?: Record<string, string> }
let client: QueryClient
const envelope = { items: [question], total: 1, page: 1, pageSize: 20 }
const failure = (code: string, status: number) => ({
  status,
  data: {
    code,
    message: '요청을 확인해 주세요.',
    requestId,
    retryable: code === 'RATE_LIMITED'
  },
  headers: code === 'RATE_LIMITED' ? { 'retry-after': '5' } : undefined
})
beforeEach(() => {
  calls.length = 0
  invalidateCanonicalAuthTransitions()
  useAppStore.getState().setCurrentUser({
    id: actorId,
    name: '테스트',
    role: 'ADMIN',
    targetLevel: 'N3'
  })
  client = new QueryClient({
    queryCache: new QueryCache({ onError: emitApiError }),
    mutationCache: new MutationCache({ onError: emitApiError }),
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
  responder = (url, method) => ({
    status: method === 'post' && url === '/v1/admin/questions' ? 201 : 200,
    data: url.endsWith('/archive')
      ? archiveReceipt
      : method === 'patch'
        ? updateReceipt
        : method === 'post'
          ? createReceipt
          : url.endsWith('/preview')
            ? preview
            : url.endsWith(question.questionId)
              ? detail
              : envelope
  })
  apiClient.defaults.adapter = async (config) => {
    const url = config.url ?? ''
    const method = config.method ?? 'get'
    calls.push({
      url,
      method,
      params: config.params,
      body:
        typeof config.data === 'string' ? JSON.parse(config.data) : config.data
    })
    const fixture = responder(url, method)
    const response = {
      ...fixture,
      statusText: '',
      config,
      headers: {
        'cache-control': 'private, no-store',
        'x-request-id': requestId,
        ...fixture.headers
      }
    }
    if (response.status >= 400)
      throw Object.assign(new Error('Fixture HTTP failure'), {
        isAxiosError: true,
        config,
        response
      })
    return response
  }
})
afterEach(() => {
  cleanup()
  client.clear()
  apiClient.defaults.adapter = originalAdapter
  vi.restoreAllMocks()
})
const renderPage = (
  mode: 'list' | 'edit' | 'create' = 'list',
  initial?: string
) => {
  const router = createMemoryRouter(
    [
      {
        path: '/questions/new',
        element: (
          <>
            <AuthErrorHandlerProvider />
            <CreateAdminQuestionPage />
          </>
        )
      },
      {
        path: '/questions',
        element: (
          <>
            <AuthErrorHandlerProvider />
            <AdminQuestionPage />
          </>
        )
      },
      {
        path: '/questions/:questionId/edit',
        element: (
          <>
            <AuthErrorHandlerProvider />
            <EditAdminQuestionPage />
          </>
        )
      }
    ],
    {
      basename: '/admin',
      initialEntries: [
        initial ??
          (mode === 'create'
            ? '/admin/questions/new?returnTo=%2Fadmin%2Fquestions%3Flevel%3DN3'
            : mode === 'edit'
              ? `/admin/questions/${question.questionId}/edit`
              : '/admin/questions?level=N3')
      ]
    }
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
  return router
}
it('passes populated list/detail/preview and all three commands through the real query-to-transport boundary', async () => {
  expect(
    (await client.fetchQuery(adminQuestionQueries.list({ level: 'N3' })))
      .items[0]?.questionId
  ).toBe(question.questionId)
  expect(
    (await client.fetchQuery(adminQuestionQueries.detail(question.questionId)))
      .question.questionId
  ).toBe(question.questionId)
  expect(
    (
      await client.fetchQuery(
        adminQuestionQueries.preview(question.questionId, versionId, 1)
      )
    ).adminAnswer.correctOptionId
  ).toBe(input.correctOptionId)
  await client
    .getMutationCache()
    .build(client, adminQuestionMutations.create())
    .execute(createInput)
  await client
    .getMutationCache()
    .build(client, adminQuestionMutations.update())
    .execute({ questionId: question.questionId, versionId, input })
  await client
    .getMutationCache()
    .build(client, adminQuestionMutations.delete())
    .execute({ questionId: question.questionId, input: archiveInput })
  expect(calls.map(({ method, url }) => `${method} ${url}`)).toEqual([
    'get /v1/admin/questions',
    `get /v1/admin/questions/${question.questionId}`,
    `get /v1/admin/question-versions/${versionId}/preview`,
    'post /v1/admin/questions',
    `patch /v1/admin/question-versions/${versionId}`,
    `post /v1/admin/questions/${question.questionId}/archive`
  ])
  expect(calls[0]?.params).toMatchObject({
    sort: 'UPDATED_DESC',
    page: 1,
    pageSize: 20
  })
  expect(calls[3]?.body).toEqual(createInput)
  expect(calls[4]?.body).toEqual(input)
  expect(calls[5]?.body).toEqual(archiveInput)
  expect(calls.every(({ url }) => !url.includes('/admin/question/'))).toBe(true)
})
it('accepts an empty canonical list and the archive null-candidate pair', async () => {
  responder = (url) => ({
    status: 200,
    data: url.endsWith('/archive')
      ? archiveReceipt
      : { ...envelope, items: [], total: 0 }
  })
  expect(
    (await client.fetchQuery(adminQuestionQueries.list({}))).items
  ).toEqual([])
  const emptyPair = {
    ...archiveInput,
    expectedOpenCandidateVersionId: null,
    expectedOpenCandidateRowVersion: null
  }
  await client
    .getMutationCache()
    .build(client, adminQuestionMutations.delete())
    .execute({ questionId: question.questionId, input: emptyPair })
  expect(calls[1]?.body).toEqual(emptyPair)
})
it('rejects legacy nonempty DTOs and schema-valid responses for another detail/version', async () => {
  responder = () => ({
    status: 200,
    data: { ...envelope, items: [{ id: question.questionId }] }
  })
  await expect(
    client.fetchQuery(adminQuestionQueries.list({}))
  ).rejects.toMatchObject({ isResponseValidationError: true })
  responder = () => ({ status: 200, data: preview })
  await expect(
    client.fetchQuery(
      adminQuestionQueries.preview(question.questionId, actorId, 1)
    )
  ).rejects.toMatchObject({ isResponseValidationError: true })
  await expect(
    client.fetchQuery(adminQuestionQueries.preview(actorId, versionId, 1))
  ).rejects.toMatchObject({ isResponseValidationError: true })
})
it.each([
  ['AUTH_SESSION_EXPIRED', 401],
  ['ADMIN_REQUIRED', 403],
  ['VALIDATION_ERROR', 422],
  ['VERSION_CONFLICT', 409],
  ['RATE_LIMITED', 429],
  ['FRESH_ASSURANCE_REQUIRED', 401]
] as const)(
  'preserves canonical %s at the command boundary without automatic replay',
  async (code, status) => {
    responder = () => failure(code, status)
    await expect(
      client
        .getMutationCache()
        .build(client, adminQuestionMutations.delete())
        .execute({ questionId: question.questionId, input: archiveInput })
    ).rejects.toMatchObject({ code, status })
    expect(calls).toHaveLength(1)
  }
)
it('renders the populated canonical list and shows fresh SSO without expiring the ADMIN session or replaying archive', async () => {
  responder = (url) =>
    url.endsWith('/archive')
      ? failure('FRESH_ASSURANCE_REQUIRED', 401)
      : { status: 200, data: envelope }
  const replace = vi
    .spyOn(appDocumentNavigation, 'replace')
    .mockImplementation(() => undefined)
  const user = userEvent.setup()
  renderPage()
  await screen.findByRole('region', { name: '관리자 문제 목록' })
  await user.click(
    screen.getByRole('button', { name: question.questionId + ' 문제 보관' })
  )
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: '문제 보관'
    })
  )
  const link = await screen.findByRole('link', { name: '관리자 재인증' })
  expect(
    new URL(link.getAttribute('href') ?? '', window.location.origin).pathname +
      new URL(link.getAttribute('href') ?? '', window.location.origin).search
  ).toBe('/login?redirect=%2Fadmin%2Fquestions%3Flevel%3DN3')
  expect(
    new URL(link.getAttribute('href') ?? '', window.location.origin).origin
  ).toBe(window.location.origin)
  expect(replace).not.toHaveBeenCalled()
  expect(useAppStore.getState().currentUser?.id).toBe(actorId)
  expect(calls.filter(({ method }) => method === 'post')).toHaveLength(1)
  expect(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: '문제 보관'
    })
  ).toBeDisabled()
})
it('an actual ordinary401 from the list retains the admin filter in the public login document', async () => {
  responder = () => failure('AUTH_SESSION_EXPIRED', 401)
  const replace = vi
    .spyOn(appDocumentNavigation, 'replace')
    .mockImplementation(() => undefined)
  renderPage()
  await waitFor(() =>
    expect(replace).toHaveBeenCalledWith(
      '/login?redirect=%2Fadmin%2Fquestions%3Flevel%3DN3',
      { sessionExpired: true }
    )
  )
  expect(useAppStore.getState().currentUser).toBeNull()
})
it('keeps dirty inputs and old rowVersion after409 and does not issue a second PATCH', async () => {
  const normal = responder
  responder = (url, method) =>
    method === 'patch' ? failure('VERSION_CONFLICT', 409) : normal(url, method)
  const user = userEvent.setup()
  renderPage('edit')
  const field = await screen.findByRole('textbox', { name: '질문' })
  await user.type(field, ' 로컬 입력')
  await user.click(screen.getByRole('button', { name: '변경사항 저장' }))
  await screen.findByRole('button', { name: '최신 상태 다시 불러오기' })
  expect(field).toHaveValue(preview.question.questionText + ' 로컬 입력')
  expect(calls.filter(({ method }) => method === 'patch')).toHaveLength(1)
  expect(calls.find(({ method }) => method === 'patch')?.body).toMatchObject({
    expectedRowVersion: 1,
    correctOptionId: input.correctOptionId
  })
  await user.click(
    screen.getByRole('button', { name: '최신 상태 다시 불러오기' })
  )
  await user.click(screen.getByRole('button', { name: '입력 유지' }))
  expect(field).toHaveValue(preview.question.questionText + ' 로컬 입력')
})

it('registers a draft, enters the returned question editor, and saves back to the original filtered list', async () => {
  const user = userEvent.setup()
  const router = renderPage('create')
  await user.type(
    screen.getByRole('textbox', { name: '질문' }),
    preview.question.questionText
  )
  for (const option of preview.question.options)
    await user.type(
      screen.getByRole('textbox', { name: `보기 ${option.label}` }),
      option.text
    )
  await user.click(screen.getByRole('radio', { name: '보기 1' }))
  await user.type(
    screen.getByRole('textbox', { name: '한국어 해설' }),
    preview.adminAnswer.explanationKo
  )
  await user.type(screen.getByRole('textbox', { name: '태그' }), '문법')
  await user.click(screen.getByRole('button', { name: '초안 등록' }))
  await screen.findByRole('heading', { name: '문제 수정' })
  expect(router.state.location.pathname).toBe(
    `/admin/questions/${question.questionId}/edit`
  )
  expect(screen.getByText('아직 학습자에게 공개되지 않았습니다.')).toBeVisible()
  expect(
    calls.find(({ method }) => method === 'post')?.body
  ).not.toHaveProperty('status')
  await user.type(screen.getByRole('textbox', { name: '질문' }), ' 수정')
  await user.click(screen.getByRole('button', { name: '변경사항 저장' }))
  await screen.findByRole('heading', { name: '문제 관리' })
  expect(router.state.location.pathname + router.state.location.search).toBe(
    '/admin/questions?level=N3'
  )
})
it('shows a published version as read only, distinct from its publication presence', async () => {
  const published = {
    ...detail,
    question: {
      ...detail.question,
      openCandidateVersionId: null,
      currentPublishedVersionId: versionId
    },
    versions: {
      ...detail.versions,
      items: detail.versions.items.map((v) => ({
        ...v,
        versionStatus: 'PUBLISHED',
        publishedAt: v.createdAt
      }))
    }
  }
  const normal = responder
  responder = (url, method) =>
    url.endsWith(question.questionId)
      ? { status: 200, data: published }
      : normal(url, method)
  renderPage('edit')
  await screen.findByRole('heading', { name: '문제 상세' })
  expect(screen.getByRole('button', { name: '변경사항 저장' })).toBeDisabled()
  expect(screen.getByText(/현재 버전은 수정할 수 없습니다/)).toBeVisible()
  expect(calls.some(({ method }) => method === 'patch')).toBe(false)
})
it('retains local input when the explicitly confirmed post-conflict reload fails', async () => {
  const normal = responder
  responder = (url, method) =>
    method === 'patch' ? failure('VERSION_CONFLICT', 409) : normal(url, method)
  const user = userEvent.setup()
  renderPage('edit')
  const field = await screen.findByRole('textbox', { name: '질문' })
  await user.type(field, ' 보존')
  await user.click(screen.getByRole('button', { name: '변경사항 저장' }))
  await user.click(
    await screen.findByRole('button', { name: '최신 상태 다시 불러오기' })
  )
  responder = () => ({
    ...failure('SERVICE_UNAVAILABLE', 503),
    data: { ...failure('SERVICE_UNAVAILABLE', 503).data, retryable: true }
  })
  await user.click(
    screen.getByRole('button', { name: '입력 교체하고 불러오기' })
  )
  await screen.findByText(
    '최신 상태를 불러오지 못했습니다. 현재 입력은 유지됩니다.'
  )
  expect(field).toHaveValue(preview.question.questionText + ' 보존')
})
it('labels a draft and an existing published copy separately and normalizes unsupported sort without losing filters', async () => {
  responder = () => ({
    status: 200,
    data: {
      ...envelope,
      items: [
        {
          ...question,
          currentPublishedVersionId: '10000000-0000-4000-8000-000000000005'
        }
      ]
    }
  })
  const router = renderPage(
    'list',
    '/admin/questions?level=N3&sort=STATUS&page=2'
  )
  await screen.findByRole('region', { name: '관리자 문제 목록' })
  expect(screen.getByText(/초안 · 활성 · 공개본 있음/)).toBeVisible()
  expect(
    screen.getByText('상태순 정렬은 지원하지 않아 최근 수정순으로 표시합니다.')
  ).toBeVisible()
  expect(router.state.location.search).toBe('?level=N3')
  expect(
    within(screen.getByRole('combobox', { name: '정렬' })).getAllByRole(
      'option'
    )
  ).toHaveLength(2)
})
