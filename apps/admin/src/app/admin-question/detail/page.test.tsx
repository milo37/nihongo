import * as listApi from '@nihongo/browser/api/admin-question/listAdminQuestion/index'
import { question } from '@app/admin-question/test/questionFixture'
import type { MockInstance } from 'vitest'
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  QueryClient,
  QueryClientProvider,
  onlineManager
} from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { diffQuestionVersionResponseSchema } from '@nihongo/contracts/admin/phase7'
import type {
  AdminQuestionDetail,
  AdminQuestionMutationResult,
  AdminQuestionVersionConnection,
  ContentReviewConnection,
  DiffQuestionVersionResponse
} from '@nihongo/contracts/admin/phase7'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { ToastProvider } from '@nihongo/browser/common/components/Toast'
import { invalidateCanonicalAuthTransitions } from '@nihongo/browser/app/login/authSession'
import { appDocumentNavigation } from '@nihongo/browser/libs/appNavigation'
import { useAppStore } from '@nihongo/browser/store/index'
import { appI18n } from '@nihongo/browser/i18n/config'
import { writeUiLocalePreference } from '@nihongo/browser/libs/localeStorage'
import * as authApi from '@nihongo/browser/api/auth/getCurrentUser/index'
import * as api from '@nihongo/browser/api/content-operations/requestContentOperation'
import { adminRoutes } from '@/router'
import {
  initial,
  newer,
  older,
  actor,
  actorId,
  reviewer,
  reviewerId,
  questionId,
  versionId,
  oldVersionId,
  previewFor,
  createReceipt,
  emptyDiff
} from '@app/admin-question/test/workflowFixture'
import {
  readQuestionFreshContext,
  discardQuestionFreshContext,
  saveQuestionFreshContext
} from '@app/admin-question/navigation/questionWorkflowContext'
import type { QuestionWrite } from '@app/admin-question/detail/questionWorkflow'
// Compile the existing lazy detail route before timed DOM assertions.
beforeAll(async () => {
  await import('@app/admin-question/detail/page')
})

const t = appI18n.getFixedT('ko', 'admin')
let client: QueryClient
let snapshot: AdminQuestionDetail
let history: AdminQuestionVersionConnection | undefined
let reviews: ContentReviewConnection
let reviewError: unknown
let readError: unknown
let versionDiff: DiffQuestionVersionResponse
let write: (request: QuestionWrite) => Promise<AdminQuestionMutationResult>
let endpoint: MockInstance<typeof api.requestContentOperation>
const writes = () =>
  endpoint.mock.calls.filter(([request]) => request.body !== undefined)
beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
  onlineManager.setOnline(true)
  invalidateCanonicalAuthTransitions()
  useAppStore.getState().setCurrentUser(null)
  discardQuestionFreshContext(actorId, questionId)
  discardQuestionFreshContext(reviewerId, questionId)
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  vi.spyOn(authApi, 'getCurrentUser').mockResolvedValue(actor())
  snapshot = structuredClone(initial)
  history = undefined
  reviews = { questionVersionId: versionId, items: [], nextCursor: null }
  reviewError = null
  readError = null
  versionDiff = diffQuestionVersionResponseSchema.parse({
    ...emptyDiff,
    changedFields: ['QUESTION_TEXT'],
    changes: [
      {
        field: 'QUESTION_TEXT',
        kind: 'SCALAR',
        before: 'Older question',
        after: 'Current question'
      }
    ]
  })
  write = async (request) => {
    if (request.operation === 'requestContentReview')
      snapshot = {
        ...snapshot,
        versions: {
          ...snapshot.versions,
          items: snapshot.versions.items.map((version) =>
            version.questionVersionId === versionId
              ? {
                  ...version,
                  versionStatus: 'IN_REVIEW',
                  rowVersion: version.rowVersion + 1
                }
              : version
          )
        }
      }
    return {
      ...createReceipt,
      versionStatus:
        request.operation === 'requestContentReview' ? 'IN_REVIEW' : 'DRAFT',
      versionRowVersion: 2
    }
  }
  endpoint = vi
    .spyOn(api, 'requestContentOperation')
    .mockImplementation((async (request) => {
      switch (request.operation) {
        case 'getAdminQuestion':
          if (readError) throw readError
          return snapshot
        case 'listAdminQuestionVersions':
          return history ?? snapshot.versions
        case 'previewQuestionVersion':
          return previewFor(
            'versionId' in request.params ? request.params.versionId : versionId
          )
        case 'diffQuestionVersion':
          return versionDiff
        case 'listQuestionVersionReviews':
          if (reviewError) throw reviewError
          return {
            ...reviews,
            questionVersionId:
              'versionId' in request.params
                ? request.params.versionId
                : versionId
          }
        default:
          return write(request as QuestionWrite)
      }
    }) as typeof api.requestContentOperation)
})
afterEach(() => {
  cleanup()
  client.clear()
  onlineManager.setOnline(true)
  writeUiLocalePreference('ko')
  discardQuestionFreshContext(actorId, questionId)
  discardQuestionFreshContext(reviewerId, questionId)
  vi.restoreAllMocks()
})
const route = (suffix = '', id = questionId) => {
  const router = createMemoryRouter(adminRoutes, {
    basename: '/admin',
    initialEntries: ['/admin/questions/' + id + suffix]
  })
  const view = render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>
  )
  return { ...view, router }
}
const ready = async () => {
  await screen.findByRole('heading', { name: t('questionDetail.previewTitle') })
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: t('enums.commands.REQUEST_REVIEW') })
    ).toBeEnabled()
  )
}
const open = async (command: string) => {
  await userEvent.click(screen.getByRole('button', { name: command }))
  return screen.getByRole('dialog', {
    name: t('questionDetail.commandDialogTitle', { command })
  })
}
const execute = async (dialog: HTMLElement) =>
  userEvent.click(
    within(dialog).getByRole('button', { name: t('questionDetail.execute') })
  )
it('restores the independently approved bare detail route and all four read panels', async () => {
  const { container } = route()
  await ready()
  expect(
    screen.getByRole('heading', { name: t('questionDetail.title') })
  ).toBeVisible()
  expect(
    screen.getByRole('heading', { name: t('questionDetail.diffTitle') })
  ).toBeVisible()
  expect(
    screen.getByRole('heading', { name: t('questionDetail.reviews') })
  ).toBeVisible()
  expect(
    screen.getByRole('heading', { name: t('questionDetail.history') })
  ).toBeVisible()
  expect(container.querySelector('script')).toBeNull()
  expect(endpoint.mock.calls.map(([request]) => request.operation)).toEqual(
    expect.arrayContaining([
      'getAdminQuestion',
      'listAdminQuestionVersions',
      'previewQuestionVersion',
      'diffQuestionVersion',
      'listQuestionVersionReviews'
    ])
  )
  expect(writes()).toHaveLength(0)
})
it('shows the selected version diff in its before and after fields without writing', async () => {
  versionDiff = diffQuestionVersionResponseSchema.parse({
    ...emptyDiff,
    changedFields: ['QUESTION_TEXT', 'OPTIONS', 'TAGS'],
    changes: [
      {
        field: 'QUESTION_TEXT',
        kind: 'SCALAR',
        before: 'Previous prompt',
        after: 'Updated prompt'
      },
      {
        field: 'OPTIONS',
        kind: 'OPTIONS',
        before: [
          { ordinal: 1, text: 'Previous first', isCorrect: true },
          { ordinal: 2, text: 'Previous second', isCorrect: false },
          { ordinal: 3, text: 'Previous third', isCorrect: false },
          { ordinal: 4, text: 'Previous fourth', isCorrect: false }
        ],
        after: [
          { ordinal: 1, text: 'Updated first', isCorrect: false },
          { ordinal: 2, text: 'Updated second', isCorrect: true },
          { ordinal: 3, text: 'Updated third', isCorrect: false },
          { ordinal: 4, text: 'Updated fourth', isCorrect: false }
        ]
      },
      {
        field: 'TAGS',
        kind: 'TAGS',
        before: [
          {
            id: '10000000-0000-4000-8000-000000000011',
            label: 'OldTag',
            normalizedName: 'oldtag'
          }
        ],
        after: [
          {
            id: '10000000-0000-4000-8000-000000000012',
            label: 'NewTag',
            normalizedName: 'newtag'
          }
        ]
      }
    ]
  })
  route('?version=' + versionId)
  await ready()
  const list = await screen.findByRole('list', {
    name: t('questionDetail.diffListLabel')
  })
  const sides = (field: 'QUESTION_TEXT' | 'OPTIONS' | 'TAGS') => {
    const heading = within(list).getByRole('heading', {
      name: t(`enums.diffFields.${field}`)
    })
    const row = heading.closest('li')!
    return {
      before: within(row).getByText(t('questionDetail.diffBefore'))
        .nextElementSibling!,
      after: within(row).getByText(t('questionDetail.diffAfter'))
        .nextElementSibling!
    }
  }
  const scalar = sides('QUESTION_TEXT')
  expect(scalar.before).toHaveTextContent('Previous prompt')
  expect(scalar.before).not.toHaveTextContent('Updated prompt')
  expect(scalar.after).toHaveTextContent('Updated prompt')
  expect(scalar.after).not.toHaveTextContent('Previous prompt')

  const options = sides('OPTIONS')
  const oldOptions = within(options.before as HTMLElement).getAllByRole(
    'listitem'
  )
  const newOptions = within(options.after as HTMLElement).getAllByRole(
    'listitem'
  )
  expect(oldOptions.map((item) => item.textContent)).toEqual([
    '1. Previous first (정답)',
    '2. Previous second',
    '3. Previous third',
    '4. Previous fourth'
  ])
  expect(newOptions.map((item) => item.textContent)).toEqual([
    '1. Updated first',
    '2. Updated second (정답)',
    '3. Updated third',
    '4. Updated fourth'
  ])

  const tags = sides('TAGS')
  expect(tags.before).toHaveTextContent('OldTag')
  expect(tags.before).not.toHaveTextContent('NewTag')
  expect(tags.before).not.toHaveTextContent('oldtag')
  expect(tags.after).toHaveTextContent('NewTag')
  expect(tags.after).not.toHaveTextContent('OldTag')
  expect(tags.after).not.toHaveTextContent('newtag')
  expect(list).not.toHaveTextContent('10000000-0000-4000-8000-000000000011')
  expect(list).not.toHaveTextContent('10000000-0000-4000-8000-000000000012')
  expect(endpoint).toHaveBeenCalledWith(
    expect.objectContaining({
      operation: 'diffQuestionVersion',
      params: { versionId },
      query: { baseVersionId: oldVersionId }
    })
  )
  expect(writes()).toHaveLength(0)
})

it('shows an empty diff when the prior version exists but no field changed', async () => {
  versionDiff = diffQuestionVersionResponseSchema.parse(emptyDiff)
  route('?version=' + versionId)
  await ready()
  const heading = screen.getByRole('heading', {
    name: t('questionDetail.diffTitle')
  })
  const section = heading.closest('section')!
  expect(
    await within(section).findByText(t('questionDetail.diffEmpty'))
  ).toBeVisible()
  expect(within(section).queryByText('Older question')).not.toBeInTheDocument()
  expect(
    within(section).queryByText('Current question')
  ).not.toBeInTheDocument()
  expect(endpoint).toHaveBeenCalledWith(
    expect.objectContaining({
      operation: 'diffQuestionVersion',
      params: { versionId },
      query: { baseVersionId: oldVersionId }
    })
  )
  expect(writes()).toHaveLength(0)
})

it('selects by URL, reads the selected preview/diff/reviews, and preserves list filters on return', async () => {
  const { router } = route(
    '?returnTo=' + encodeURIComponent('/admin/questions?level=N3&page=2')
  )
  await ready()
  await userEvent.click(
    screen.getByRole('button', { name: /.*1.*公開|.*1.*공개/ })
  )
  await waitFor(() =>
    expect(router.state.location.search).toContain('version=' + oldVersionId)
  )
  expect(await screen.findByText('Older question')).toBeVisible()
  const breadcrumbs = screen.getByRole('navigation', {
    name: t('common.breadcrumbLabel')
  })
  expect(
    within(breadcrumbs).getByRole('link', {
      name: t('common.questions')
    })
  ).toHaveAttribute('href', '/admin/questions?level=N3&page=2')
  expect(endpoint).toHaveBeenCalledWith(
    expect.objectContaining({
      operation: 'listQuestionVersionReviews',
      params: { versionId: oldVersionId },
      query: { limit: 20 }
    })
  )
  expect(writes()).toHaveLength(0)
})
it('does not normalize a valid unloaded version until cursor history reaches its page', async () => {
  history = { ...initial.versions, items: [newer], nextCursor: 'fixture-next' }
  const { router } = route('?version=' + oldVersionId)
  expect(
    await screen.findByRole('button', { name: t('questionDetail.historyMore') })
  ).toBeEnabled()
  expect(router.state.location.search).toContain(oldVersionId)
  expect(
    screen.queryByRole('button', { name: t('enums.commands.REQUEST_REVIEW') })
  ).not.toBeInTheDocument()
  history = { ...initial.versions, items: [older], nextCursor: null }
  await userEvent.click(
    screen.getByRole('button', { name: t('questionDetail.historyMore') })
  )
  expect(await screen.findByText('Older question')).toBeVisible()
  expect(endpoint).toHaveBeenCalledWith(
    expect.objectContaining({
      operation: 'listAdminQuestionVersions',
      query: { limit: 20, cursor: 'fixture-next' }
    })
  )
  expect(router.state.location.search).toContain(oldVersionId)
})
it('normalizes an unknown fully searched version while preserving return context', async () => {
  const unknown = '10000000-0000-4000-8000-000000000099'
  const { router } = route(
    '?version=' +
      unknown +
      '&returnTo=' +
      encodeURIComponent('/admin/questions?page=2')
  )
  await ready()
  await waitFor(() =>
    expect(router.state.location.search).not.toContain('version=')
  )
  expect(router.state.location.search).toContain('returnTo=')
})
it('retains cached preview offline, locks commands, and restores explicit retry focus after reconnect', async () => {
  route()
  await ready()
  const heading = screen.getByRole('heading', {
    name: t('questionDetail.title')
  })
  await act(async () => {
    onlineManager.setOnline(false)
  })
  expect(
    screen.getByRole('button', { name: t('enums.commands.REQUEST_REVIEW') })
  ).toBeDisabled()
  expect(screen.getAllByText('Current question').length).toBeGreaterThan(0)
  await act(async () => {
    onlineManager.setOnline(true)
  })
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: t('enums.commands.REQUEST_REVIEW') })
    ).toBeEnabled()
  )
  readError = { code: 'SERVICE_UNAVAILABLE' }
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['phase7-admin', 'questions'] })
  })
  const retry = await screen.findByRole('button', { name: t('common.retry') })
  retry.focus()
  readError = null
  await userEvent.click(retry)
  await waitFor(() => expect(heading).toHaveFocus())
  expect(writes()).toHaveLength(0)
})
it('requires explicit confirm, sends viewed CAS once, and focuses the stable heading after success', async () => {
  route()
  await ready()
  const dialog = await open(t('enums.commands.REQUEST_REVIEW'))
  expect(writes()).toHaveLength(0)
  await execute(dialog)
  await waitFor(() => expect(writes()).toHaveLength(1))
  expect(writes()[0]![0]).toMatchObject({
    operation: 'requestContentReview',
    params: { versionId },
    body: { expectedRowVersion: 1 }
  })
  await waitFor(() =>
    expect(
      screen.getByRole('heading', { name: t('questionDetail.title') })
    ).toHaveFocus()
  )
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
it('keeps draft input after conflict, requires manual refresh+rebase, then saves the new viewed CAS', async () => {
  route()
  await ready()
  await userEvent.click(
    screen.getByRole('button', { name: t('questionDetail.editDraft') })
  )
  const input = screen.getByRole('textbox', { name: t('editor.questionText') })
  fireEvent.change(input, { target: { value: 'Local kept question' } })
  const form = input.closest('form')!
  write = async () => {
    throw { code: 'VERSION_CONFLICT' }
  }
  await userEvent.click(
    within(form).getByRole('button', { name: t('questionDetail.saveDraft') })
  )
  expect(
    (await screen.findAllByText(t('errors.versionConflict')))[0]
  ).toBeVisible()
  expect(input).toHaveValue('Local kept question')
  snapshot = {
    ...snapshot,
    versions: {
      ...snapshot.versions,
      items: [{ ...newer, rowVersion: 2 }, older]
    }
  }
  await userEvent.click(
    screen.getByRole('button', { name: t('questionDetail.retryConflict') })
  )
  const rebase = await screen.findByRole('button', {
    name: t('editor.rebaseAction')
  })
  await waitFor(() => expect(rebase).toBeEnabled())
  await userEvent.click(rebase)
  write = async () => ({ ...createReceipt, versionRowVersion: 3 })
  await userEvent.click(
    within(form).getByRole('button', { name: t('questionDetail.saveDraft') })
  )
  await waitFor(() => expect(writes()).toHaveLength(2))
  expect(writes()[1]![0]).toMatchObject({
    operation: 'updateQuestionVersion',
    body: { expectedRowVersion: 2, questionText: 'Local kept question' }
  })
})
it('keeps a conflict locked while delayed history disagrees with the same detail version', async () => {
  route()
  await ready()
  await userEvent.click(
    screen.getByRole('button', { name: t('questionDetail.editDraft') })
  )
  const input = screen.getByRole('textbox', { name: t('editor.questionText') })
  fireEvent.change(input, { target: { value: 'Local kept question' } })
  const form = input.closest('form')!
  write = async () => {
    throw { code: 'VERSION_CONFLICT' }
  }
  await userEvent.click(
    within(form).getByRole('button', { name: t('questionDetail.saveDraft') })
  )
  await screen.findAllByText(t('errors.versionConflict'))

  const originalRead = endpoint.getMockImplementation()!
  let releaseHistory: ((value: AdminQuestionVersionConnection) => void) | null =
    null
  endpoint.mockImplementation((async (request) => {
    if (request.operation === 'listAdminQuestionVersions') {
      return new Promise<AdminQuestionVersionConnection>((resolve) => {
        releaseHistory = resolve
      })
    }
    return originalRead(request)
  }) as typeof api.requestContentOperation)
  await userEvent.click(
    screen.getByRole('button', { name: t('questionDetail.retryConflict') })
  )
  await waitFor(() => expect(releaseHistory).not.toBeNull())
  expect(input).toHaveValue('Local kept question')
  expect(input).toBeDisabled()
  expect(writes()).toHaveLength(1)
  expect(snapshot.versions.items[0]).toMatchObject({
    questionVersionId: versionId,
    rowVersion: 1
  })

  await act(async () => {
    releaseHistory!({
      ...snapshot.versions,
      items: [{ ...newer, rowVersion: 2 }, older]
    })
  })
  const rebase = await screen.findByRole('button', {
    name: t('editor.rebaseAction')
  })
  expect(input).toHaveValue('Local kept question')
  expect(writes()).toHaveLength(1)
  expect.soft(input).toBeDisabled()
  expect.soft(rebase).toBeDisabled()
  const retry = screen.queryByRole('button', {
    name: t('questionDetail.retryConflict')
  })
  expect.soft(retry).toBeEnabled()
  if (!retry || retry.hasAttribute('disabled')) return

  endpoint.mockImplementation(originalRead)
  snapshot = {
    ...snapshot,
    versions: {
      ...snapshot.versions,
      items: [{ ...newer, rowVersion: 2 }, older]
    }
  }
  await userEvent.click(retry)
  await waitFor(() => expect(rebase).toBeEnabled())
  expect(writes()).toHaveLength(1)
  await userEvent.click(rebase)
  write = async () => ({ ...createReceipt, versionRowVersion: 3 })
  await userEvent.click(
    within(form).getByRole('button', { name: t('questionDetail.saveDraft') })
  )
  await waitFor(() => expect(writes()).toHaveLength(2))
  expect(writes()[1]![0]).toMatchObject({
    operation: 'updateQuestionVersion',
    body: { expectedRowVersion: 2, questionText: 'Local kept question' }
  })
})
it('allows conflict refresh when the selected version is absent from the detail page', async () => {
  snapshot = {
    ...snapshot,
    versions: { ...snapshot.versions, items: [] }
  }
  history = { ...initial.versions, items: [newer, older] }
  route()
  await ready()
  await userEvent.click(
    screen.getByRole('button', { name: t('questionDetail.editDraft') })
  )
  const input = screen.getByRole('textbox', { name: t('editor.questionText') })
  fireEvent.change(input, { target: { value: 'Paged local question' } })
  const form = input.closest('form')!
  write = async () => {
    throw { code: 'VERSION_CONFLICT' }
  }
  await userEvent.click(
    within(form).getByRole('button', { name: t('questionDetail.saveDraft') })
  )
  await screen.findAllByText(t('errors.versionConflict'))
  history = { ...initial.versions, items: [{ ...newer, rowVersion: 2 }, older] }
  await userEvent.click(
    screen.getByRole('button', { name: t('questionDetail.retryConflict') })
  )
  const rebase = await screen.findByRole('button', {
    name: t('editor.rebaseAction')
  })
  await waitFor(() => expect(rebase).toBeEnabled())
  expect(input).toHaveValue('Paged local question')
  expect(writes()).toHaveLength(1)
  await userEvent.click(rebase)
  write = async () => ({ ...createReceipt, versionRowVersion: 3 })
  await userEvent.click(
    within(form).getByRole('button', { name: t('questionDetail.saveDraft') })
  )
  await waitFor(() => expect(writes()).toHaveLength(2))
  expect(writes()[1]![0]).toMatchObject({
    operation: 'updateQuestionVersion',
    body: { expectedRowVersion: 2, questionText: 'Paged local question' }
  })
})
it('blocks version changes and leaving while dirty and retains input when the user stays', async () => {
  const { router } = route()
  await ready()
  await userEvent.click(
    screen.getByRole('button', { name: t('questionDetail.editDraft') })
  )
  const input = screen.getByRole('textbox', { name: t('editor.questionText') })
  fireEvent.change(input, { target: { value: 'Unsaved original' } })
  expect(
    screen.getByRole('button', { name: t('enums.commands.REQUEST_REVIEW') })
  ).toBeDisabled()
  expect(
    screen
      .getAllByRole('button')
      .filter((button) => button.getAttribute('aria-current') === 'true')[0]
  ).toBeDisabled()
  await userEvent.click(
    screen.getAllByRole('link', { name: t('common.questions') })[0]!
  )
  const dialog = await screen.findByRole('dialog', {
    name: t('editor.unsavedTitle')
  })
  await userEvent.click(
    within(dialog).getByRole('button', { name: t('editor.keepEditing') })
  )
  expect(input).toHaveValue('Unsaved original')
  expect(router.state.location.pathname).toBe('/admin/questions/' + questionId)
})
it('preserves reason and selected version across explicit Google fresh and never replays automatically', async () => {
  vi.mocked(authApi.getCurrentUser).mockResolvedValue(actor(reviewerId))
  const approved = {
    ...newer,
    versionStatus: 'APPROVED' as const,
    latestReviewer: reviewer
  }
  snapshot = {
    ...snapshot,
    versions: { ...snapshot.versions, items: [approved, older] }
  }
  write = async () => {
    throw { code: 'FRESH_ASSURANCE_REQUIRED' }
  }
  const assign = vi
    .spyOn(appDocumentNavigation, 'assign')
    .mockImplementation(() => undefined)
  const first = route(
    '?version=' +
      versionId +
      '&returnTo=' +
      encodeURIComponent('/admin/questions?page=2')
  )
  const withdraw = await screen.findByRole('button', {
    name: t('enums.commands.WITHDRAW')
  })
  await waitFor(() => expect(withdraw).toBeEnabled())
  const dialog = await open(t('enums.commands.WITHDRAW'))
  fireEvent.change(
    within(dialog).getByRole('textbox', {
      name: t('questionDetail.requiredReason')
    }),
    { target: { value: 'Reviewed original note' } }
  )
  await execute(dialog)
  const fresh = await within(dialog).findByRole('button', {
    name: t('reportDetail.fresh')
  })
  expect(assign).not.toHaveBeenCalled()
  await userEvent.click(fresh)
  expect(assign).toHaveBeenCalledExactlyOnceWith(
    '/login?redirect=' + encodeURIComponent('/admin/questions/' + questionId)
  )
  expect(readQuestionFreshContext(reviewerId, questionId)).toMatchObject({
    versionId,
    versionRowVersion: 1,
    questionRowVersion: 1,
    note: 'Reviewed original note',
    returnTo: '/admin/questions?page=2'
  })
  first.unmount()
  client.clear()
  invalidateCanonicalAuthTransitions()
  useAppStore.getState().setCurrentUser(null)
  route()
  const restored = await screen.findByRole('textbox', {
    name: t('questionDetail.requiredReason')
  })
  expect(restored).toHaveValue('Reviewed original note')
  expect(writes()).toHaveLength(1)
  write = async () => ({
    ...createReceipt,
    versionStatus: 'CHANGES_REQUESTED',
    versionRowVersion: 2
  })
  await execute(restored.closest('dialog')!)
  await waitFor(() => expect(writes()).toHaveLength(2))
  expect(writes()[1]![0]).toMatchObject({
    operation: 'withdrawQuestionApproval',
    body: { reason: 'Reviewed original note', expectedRowVersion: 1 }
  })
})
it('rejects stale fresh recovery when either viewed rowVersion changed', async () => {
  saveQuestionFreshContext({
    actorId,
    questionId,
    versionId,
    questionRowVersion: 7,
    versionRowVersion: 1,
    openCandidateVersionId: null,
    openCandidateRowVersion: null,
    returnTo: '/admin/questions',
    command: 'REQUEST_REVIEW',
    note: 'stale'
  })
  route()
  await ready()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(writes()).toHaveLength(0)
  expect(readQuestionFreshContext(actorId, questionId)).toBeNull()
})
it('shows partial review failure without losing preview and retries only that read', async () => {
  reviewError = { code: 'SERVICE_UNAVAILABLE' }
  route()
  await ready()
  expect(
    screen.getByRole('heading', { name: t('questionDetail.previewTitle') })
  ).toBeVisible()
  const section = screen
    .getByRole('heading', { name: t('questionDetail.reviews') })
    .closest('section')!
  reviewError = null
  await userEvent.click(
    within(section).getByRole('button', { name: t('common.retry') })
  )
  expect(
    await within(section).findByText(t('questionDetail.reviewsEmpty'))
  ).toBeVisible()
  expect(writes()).toHaveLength(0)
})
it.each(['GUEST', 'USER'])(
  'rejects %s before any private question reads',
  async (role) => {
    vi.mocked(authApi.getCurrentUser).mockResolvedValue(
      role === 'GUEST' ? null : { ...actor(), role: 'USER' }
    )
    const replace = vi
      .spyOn(appDocumentNavigation, 'replace')
      .mockImplementation(() => undefined)
    route()
    await waitFor(() => expect(replace).toHaveBeenCalled())
    expect(endpoint).not.toHaveBeenCalled()
  }
)
it('uses Japanese headings/actions and keeps raw catalog keys out of the detail', async () => {
  writeUiLocalePreference('ja')
  route()
  expect(
    await screen.findByRole('heading', { name: '問題バージョンワークフロー' })
  ).toBeVisible()
  expect(
    await screen.findByRole('button', { name: 'レビュー依頼' })
  ).toBeVisible()
  expect(screen.queryByText('questionDetail.title')).not.toBeInTheDocument()
})

it.each(['DRAFT', 'PUBLISHED'] as const)(
  'connects the current %s list row to detail while preserving list filters',
  async (status) => {
    const row =
      status === 'DRAFT'
        ? question
        : {
            ...question,
            versionStatus: 'PUBLISHED' as const,
            selectedVersionId: oldVersionId,
            currentPublishedVersionId: oldVersionId,
            openCandidateVersionId: null
          }
    vi.spyOn(listApi, 'listAdminQuestion').mockResolvedValue({
      items: [row],
      total: 1,
      page: 1,
      pageSize: 20
    })
    route('?level=N3&page=1', '')
    const link = await screen.findByRole('link', { name: questionId })
    expect(link).toHaveAttribute(
      'href',
      '/admin/questions/' +
        questionId +
        '?returnTo=' +
        encodeURIComponent('/admin/questions?level=N3&page=1')
    )
    if (status === 'PUBLISHED')
      expect(
        screen.getByRole('link', { name: questionId + ' 문제 상세' })
      ).toHaveAttribute(
        'href',
        '/admin/questions/' +
          questionId +
          '?returnTo=' +
          encodeURIComponent('/admin/questions?level=N3&page=1')
      )
  }
)
it.each([
  'version=invalid',
  'version=' + versionId + '&version=' + oldVersionId
])('normalizes malformed version query %s safely', async (query) => {
  const { router } = route('?' + query)
  await ready()
  await waitFor(() =>
    expect(router.state.location.search).not.toContain('version=')
  )
  expect(writes()).toHaveLength(0)
})
it('keeps reason input and focuses its field after canonical validation failure', async () => {
  vi.mocked(authApi.getCurrentUser).mockResolvedValue(actor(reviewerId))
  snapshot = {
    ...snapshot,
    versions: {
      ...snapshot.versions,
      items: [{ ...newer, versionStatus: 'IN_REVIEW' }, older]
    }
  }
  write = async () => {
    throw {
      code: 'VALIDATION_ERROR',
      fieldErrors: { reason: ['private server wording'] }
    }
  }
  route()
  const button = await screen.findByRole('button', {
    name: t('enums.commands.CHANGE_REQUEST')
  })
  await waitFor(() => expect(button).toBeEnabled())
  const dialog = await open(t('enums.commands.CHANGE_REQUEST'))
  const input = within(dialog).getByRole('textbox', {
    name: t('questionDetail.requiredReason')
  })
  fireEvent.change(input, { target: { value: 'Kept note' } })
  await execute(dialog)
  await waitFor(() => expect(input).toHaveFocus())
  expect(input).toHaveValue('Kept note')
  expect(screen.queryByText('private server wording')).not.toBeInTheDocument()
  expect(writes()).toHaveLength(1)
})

it('keeps an open command on its viewed CAS until explicit refresh after a passive row change', async () => {
  route()
  await ready()
  const dialog = await open(t('enums.commands.REQUEST_REVIEW'))
  const note = within(dialog).getByRole('textbox', {
    name: t('questionDetail.optionalReviewNote')
  })
  fireEvent.change(note, { target: { value: 'Keep viewed note' } })
  snapshot = {
    ...snapshot,
    question: { ...snapshot.question, rowVersion: 2 },
    versions: {
      ...snapshot.versions,
      items: [{ ...newer, rowVersion: 2 }, older]
    }
  }
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['phase7-admin', 'questions'] })
  })
  await waitFor(() =>
    expect(
      within(dialog).queryByRole('button', {
        name: t('questionDetail.execute')
      })
    ).not.toBeInTheDocument()
  )
  expect(writes()).toHaveLength(0)
  expect(note).toHaveValue('Keep viewed note')
  await userEvent.click(
    within(dialog).getByRole('button', {
      name: t('questionDetail.retryConflict')
    })
  )
  await waitFor(() =>
    expect(
      within(dialog).getByRole('button', { name: t('questionDetail.execute') })
    ).toBeEnabled()
  )
  await execute(dialog)
  await waitFor(() => expect(writes()).toHaveLength(1))
  expect(writes()[0]![0]).toMatchObject({
    body: { expectedRowVersion: 2, comment: 'Keep viewed note' }
  })
})

it('regression: pins ARCHIVE to the open candidate rowVersion even when an older published version is selected', async () => {
  route('?version=' + oldVersionId)
  const archive = await screen.findByRole('button', {
    name: t('enums.commands.ARCHIVE')
  })
  await waitFor(() => expect(archive).toBeEnabled())
  const dialog = await open(t('enums.commands.ARCHIVE'))
  snapshot = {
    ...snapshot,
    versions: {
      ...snapshot.versions,
      items: [{ ...newer, rowVersion: 2 }, older]
    }
  }
  await act(async () => {
    await client.invalidateQueries({
      queryKey: ['phase7-admin', 'questions', 'versions']
    })
  })
  await waitFor(() =>
    expect(
      within(dialog).queryByRole('button', {
        name: t('questionDetail.execute')
      })
    ).not.toBeInTheDocument()
  )
  expect(writes()).toHaveLength(0)
  await userEvent.click(
    within(dialog).getByRole('button', {
      name: t('questionDetail.retryConflict')
    })
  )
  await waitFor(() =>
    expect(
      within(dialog).getByRole('button', { name: t('questionDetail.execute') })
    ).toBeEnabled()
  )
  await execute(dialog)
  await waitFor(() => expect(writes()).toHaveLength(1))
  expect(writes()[0]![0]).toMatchObject({
    operation: 'archiveAdminQuestion',
    body: {
      expectedQuestionRowVersion: 1,
      expectedOpenCandidateVersionId: versionId,
      expectedOpenCandidateRowVersion: 2
    }
  })
})
it.each([false, true])(
  'regression: restores ARCHIVE after Google fresh only while the pinned candidate is unchanged (candidate moved=%s)',
  async (moved) => {
    write = async () => {
      throw { code: 'FRESH_ASSURANCE_REQUIRED' }
    }
    const assign = vi
      .spyOn(appDocumentNavigation, 'assign')
      .mockImplementation(() => undefined)
    const first = route('?version=' + oldVersionId)
    const archive = await screen.findByRole('button', {
      name: t('enums.commands.ARCHIVE')
    })
    await waitFor(() => expect(archive).toBeEnabled())
    const dialog = await open(t('enums.commands.ARCHIVE'))
    await execute(dialog)
    const fresh = await within(dialog).findByRole('button', {
      name: t('reportDetail.fresh')
    })
    await userEvent.click(fresh)
    expect(assign).toHaveBeenCalledExactlyOnceWith(
      '/login?redirect=' + encodeURIComponent('/admin/questions/' + questionId)
    )
    if (!moved)
      expect(readQuestionFreshContext(actorId, questionId)).toMatchObject({
        versionId: oldVersionId,
        questionRowVersion: 1,
        versionRowVersion: 1,
        openCandidateVersionId: versionId,
        openCandidateRowVersion: 1
      })
    first.unmount()
    client.clear()
    invalidateCanonicalAuthTransitions()
    useAppStore.getState().setCurrentUser(null)
    if (moved)
      snapshot = {
        ...snapshot,
        versions: {
          ...snapshot.versions,
          items: [{ ...newer, rowVersion: 2 }, older]
        }
      }
    route()
    await screen.findByRole('heading', {
      name: t('questionDetail.previewTitle')
    })
    await waitFor(() =>
      expect(readQuestionFreshContext(actorId, questionId)).toBeNull()
    )
    if (moved) {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(
        screen.getByText(t('questionDetail.versionConflictDescription'))
      ).toBeVisible()
    } else {
      expect(
        screen.getByRole('dialog', {
          name: t('questionDetail.commandDialogTitle', {
            command: t('enums.commands.ARCHIVE')
          })
        })
      ).toBeVisible()
    }
    expect(writes()).toHaveLength(1)
  }
)
