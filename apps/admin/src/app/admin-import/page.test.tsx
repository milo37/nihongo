import type { MockInstance } from 'vitest'
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  QueryClient,
  QueryClientProvider,
  onlineManager
} from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type {
  AdminImportValidationResponse,
  AdminImportApplyResponse
} from '@nihongo/contracts/admin/content-operations'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { ToastProvider } from '@nihongo/browser/common/components/Toast'
import { invalidateCanonicalAuthTransitions } from '@nihongo/browser/app/login/authSession'
import { appDocumentNavigation } from '@nihongo/browser/libs/appNavigation'
import { useAppStore } from '@nihongo/browser/store/index'
import { appI18n } from '@nihongo/browser/i18n/config'
import { writeUiLocalePreference } from '@nihongo/browser/libs/localeStorage'
import * as authApi from '@nihongo/browser/api/auth/getCurrentUser/index'
import * as api from '@nihongo/browser/api/content-operations/requestContentOperation'
import * as listApi from '@nihongo/browser/api/admin-question/listAdminQuestion/index'
import { adminRoutes } from '@/router'
import {
  actor,
  questionId,
  versionId
} from '@app/admin-question/test/workflowFixture'
import { createInput, question } from '@app/admin-question/test/questionFixture'
const t = appI18n.getFixedT('ko', 'admin')
const request = { items: [{ clientItemId: 'row-1', content: createInput }] }
const digest = '0'.repeat(64)
const validated: AdminImportValidationResponse = {
  valid: true,
  validationDigest: digest,
  itemCount: 1,
  errors: []
}
const applied: AdminImportApplyResponse = {
  createdCount: 1,
  items: [
    {
      clientItemId: 'row-1',
      questionId,
      questionVersionId: versionId,
      lifecycleStatus: 'ACTIVE',
      versionStatus: 'DRAFT',
      questionRowVersion: 1,
      versionRowVersion: 1
    }
  ],
  occurredAt: '2026-10-01T00:00:00Z'
}
let client: QueryClient
let validate: () => Promise<AdminImportValidationResponse>
let apply: () => Promise<AdminImportApplyResponse>
let endpoint: MockInstance<typeof api.requestContentOperation>
const jsonFile = (text = JSON.stringify(request), name = 'original.json') => {
  const file = new File([text], name, { type: 'application/json' })
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => {
      const data = new TextEncoder().encode(text)
      const buffer = new ArrayBuffer(data.byteLength)
      new Uint8Array(buffer).set(data)
      return buffer
    }
  })
  return file
}
beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
  onlineManager.setOnline(true)
  invalidateCanonicalAuthTransitions()
  useAppStore.getState().setCurrentUser(null)
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  vi.spyOn(authApi, 'getCurrentUser').mockResolvedValue(actor())
  validate = async () => validated
  apply = async () => applied
  endpoint = vi
    .spyOn(api, 'requestContentOperation')
    .mockImplementation((async (input) => {
      if (input.operation === 'validateQuestionImport') return validate()
      if (input.operation === 'applyQuestionImport') return apply()
      throw new Error('Unexpected import operation')
    }) as typeof api.requestContentOperation)
})
afterEach(() => {
  cleanup()
  client.clear()
  onlineManager.setOnline(true)
  writeUiLocalePreference('ko')
  vi.restoreAllMocks()
})
const route = (entry = '/admin/questions/import') => {
  const router = createMemoryRouter(adminRoutes, {
    basename: '/admin',
    initialEntries: [entry]
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
const input = () =>
  screen.getByLabelText<HTMLInputElement>(t('import.fileLabel'), {
    selector: 'input'
  })
const validateButton = () =>
  screen.getByRole('button', { name: t('import.validate') })
const applyButton = () =>
  screen.getByRole('button', { name: t('import.apply') })
const upload = async (file = jsonFile()) => {
  await screen.findByLabelText(t('import.fileLabel'), { selector: 'input' })
  await userEvent.upload(input(), file)
  await waitFor(() => expect(validateButton()).toBeEnabled())
}
const runValidate = async () => {
  await userEvent.click(validateButton())
  await screen.findByRole('heading', { name: t('import.valid') })
}
const applies = () =>
  endpoint.mock.calls.filter(
    ([value]) => value.operation === 'applyQuestionImport'
  )
it('restores the approved static route before dynamic question detail and waits for explicit validation', async () => {
  route()
  expect(
    await screen.findByRole('heading', { name: t('import.title') })
  ).toBeVisible()
  expect(validateButton()).toBeDisabled()
  expect(endpoint).not.toHaveBeenCalled()
  expect(
    screen.queryByRole('heading', { name: t('questionDetail.title') })
  ).not.toBeInTheDocument()
  await upload()
  expect(endpoint).not.toHaveBeenCalled()
  expect(
    screen.queryByRole('button', { name: t('import.apply') })
  ).not.toBeInTheDocument()
})
it('validates exact items then explicitly applies the same digest and blocks duplicate application even after reselect', async () => {
  route()
  await upload()
  await runValidate()
  expect(endpoint).toHaveBeenCalledExactlyOnceWith({
    operation: 'validateQuestionImport',
    params: {},
    query: {},
    body: request
  })
  await waitFor(() =>
    expect(
      screen.getByRole('heading', { name: t('import.valid') })
    ).toHaveFocus()
  )
  await userEvent.click(applyButton())
  expect(
    await screen.findByText(t('import.applied', { formattedCount: '1' }))
  ).toBeVisible()
  expect(applies()).toHaveLength(1)
  expect(applies()[0]![0]).toMatchObject({
    body: { ...request, validationDigest: digest }
  })
  await waitFor(() =>
    expect(
      screen.getByRole('heading', { name: t('import.title') })
    ).toHaveFocus()
  )
  expect(applyButton()).toBeDisabled()
  await upload()
  await runValidate()
  expect(applyButton()).toBeDisabled()
  fireEvent.click(applyButton())
  expect(applies()).toHaveLength(1)
})
it('shows item/field validation issues using localized codes without raw server text or apply', async () => {
  validate = async () => ({
    ...validated,
    valid: false,
    errors: [
      {
        itemIndex: 0,
        fieldPath: '/items/0/content/tagNames/0',
        code: 'UNKNOWN_TAG',
        message: '<script>private wording</script>'
      }
    ]
  })
  const { container } = route()
  await upload()
  await userEvent.click(validateButton())
  expect(
    await screen.findByRole('heading', { name: t('import.invalid') })
  ).toBeVisible()
  expect(applyButton()).toBeDisabled()
  expect(screen.getByText(/items\/0\/content\/tagNames\/0/)).toBeVisible()
  expect(container.querySelector('script')).toBeNull()
  expect(
    screen.queryByText('<script>private wording</script>')
  ).not.toBeInTheDocument()
  expect(applies()).toHaveLength(0)
})
it.each([
  ['', 'SIZE'],
  ['{"items":[],"items":[]}', 'FORMAT']
] as const)(
  'announces file %s error and focuses the file control',
  async (text, kind) => {
    route()
    await screen.findByLabelText(t('import.fileLabel'), { selector: 'input' })
    await userEvent.upload(input(), jsonFile(text))
    expect(
      await screen.findByText(
        t(kind === 'SIZE' ? 'import.fileSizeError' : 'import.fileFormatError')
      )
    ).toBeVisible()
    expect(input()).toHaveAttribute('aria-invalid', 'true')
    expect(input()).toHaveFocus()
    expect(validateButton()).toBeDisabled()
    expect(endpoint).not.toHaveBeenCalled()
  }
)
it('ignores late file reads after a newer selection and keeps the new file request', async () => {
  let finish!: (value: ArrayBuffer) => void
  const delayed = new File(['{broken'], 'first.json', {
    type: 'application/json'
  })
  Object.defineProperty(delayed, 'arrayBuffer', {
    value: () =>
      new Promise<ArrayBuffer>((resolve) => {
        finish = resolve
      })
  })
  route()
  await screen.findByLabelText(t('import.fileLabel'), { selector: 'input' })
  await userEvent.upload(input(), delayed)
  expect(screen.getByText(t('import.readingFile'))).toBeVisible()
  const next = { items: [{ ...request.items[0]!, clientItemId: 'row-2' }] }
  await upload(jsonFile(JSON.stringify(next), 'second.json'))
  await act(async () => {
    finish(new TextEncoder().encode('{broken').buffer)
  })
  expect(
    screen.queryByText(t('import.fileFormatError'))
  ).not.toBeInTheDocument()
  await runValidate()
  expect(endpoint).toHaveBeenLastCalledWith(
    expect.objectContaining({ body: next })
  )
})
it('discards a stale validation result if selection changes before it settles', async () => {
  let finish!: (value: AdminImportValidationResponse) => void
  validate = () =>
    new Promise((resolve) => {
      finish = resolve
    })
  route()
  await upload()
  await userEvent.click(validateButton())
  expect(input()).toBeDisabled()
  fireEvent.change(input(), {
    target: {
      files: [
        jsonFile(
          JSON.stringify({
            items: [{ ...request.items[0]!, clientItemId: 'row-2' }]
          }),
          'second.json'
        )
      ]
    }
  })
  await act(async () => {
    finish(validated)
  })
  await waitFor(() => expect(validateButton()).toBeEnabled())
  expect(
    screen.queryByRole('heading', { name: t('import.valid') })
  ).not.toBeInTheDocument()
  expect(applies()).toHaveLength(0)
})
it('preserves file selection on service error and requires explicit revalidation', async () => {
  validate = async () => {
    throw { code: 'SERVICE_UNAVAILABLE' }
  }
  route()
  await upload()
  await userEvent.click(validateButton())
  expect(
    await screen.findByRole('heading', { name: t('import.error') })
  ).toBeVisible()
  expect(input().files?.[0]?.name).toBe('original.json')
  expect(endpoint).toHaveBeenCalledTimes(1)
  validate = async () => validated
  await runValidate()
  expect(endpoint).toHaveBeenCalledTimes(2)
})
it('preserves selection offline, refuses validation/apply, and never replays on reconnect', async () => {
  route()
  await upload()
  await act(async () => {
    onlineManager.setOnline(false)
  })
  expect(validateButton()).toBeDisabled()
  expect(input().files?.[0]?.name).toBe('original.json')
  fireEvent.click(validateButton())
  await act(async () => {
    onlineManager.setOnline(true)
  })
  expect(endpoint).not.toHaveBeenCalled()
  await runValidate()
  await act(async () => {
    onlineManager.setOnline(false)
  })
  expect(applyButton()).toBeDisabled()
  expect(applies()).toHaveLength(0)
})
it('serializes an explicit apply and blocks repeated activation while it is pending', async () => {
  let finish!: (value: AdminImportApplyResponse) => void
  apply = () =>
    new Promise((resolve) => {
      finish = resolve
    })
  route()
  await upload()
  await runValidate()
  const button = applyButton()
  await userEvent.click(button)
  fireEvent.click(button)
  expect(applies()).toHaveLength(1)
  expect(input()).toBeDisabled()
  await act(async () => {
    finish(applied)
  })
  expect(
    await screen.findByText(t('import.applied', { formattedCount: '1' }))
  ).toBeVisible()
})
it.each(['IMPORT_VALIDATION_FAILED', 'IMPORT_IDENTITY_CONFLICT'])(
  'requires explicit validation again after %s and retains the file',
  async (code) => {
    apply = async () => {
      throw { code }
    }
    route()
    await upload()
    await runValidate()
    await userEvent.click(applyButton())
    expect(
      await screen.findByRole('heading', { name: t('import.error') })
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: t('import.apply') })
    ).not.toBeInTheDocument()
    expect(input().files?.[0]?.name).toBe('original.json')
    expect(applies()).toHaveLength(1)
  }
)
it('offers Google fresh explicitly and returns to an empty import workflow without stored source or replay', async () => {
  apply = async () => {
    throw { code: 'FRESH_ASSURANCE_REQUIRED' }
  }
  const assign = vi
    .spyOn(appDocumentNavigation, 'assign')
    .mockImplementation(() => undefined)
  const first = route()
  await upload()
  await runValidate()
  await userEvent.click(applyButton())
  const fresh = await screen.findByRole('button', {
    name: t('reportDetail.fresh')
  })
  expect(assign).not.toHaveBeenCalled()
  expect(screen.getByText(t('import.freshRevalidateHint'))).toBeVisible()
  await userEvent.click(fresh)
  expect(assign).toHaveBeenCalledExactlyOnceWith(
    '/login?redirect=' + encodeURIComponent('/admin/questions/import')
  )
  expect(Object.values(sessionStorage).join('')).not.toContain(
    JSON.stringify(request)
  )
  first.unmount()
  client.clear()
  invalidateCanonicalAuthTransitions()
  useAppStore.getState().setCurrentUser(null)
  route()
  await screen.findByLabelText(t('import.fileLabel'), { selector: 'input' })
  expect(input().files).toHaveLength(0)
  expect(validateButton()).toBeDisabled()
  expect(applies()).toHaveLength(1)
})
it.each(['GUEST', 'USER'])(
  'rejects %s before import transport',
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
it('connects the existing list entry and preserves its current create/edit targets', async () => {
  vi.spyOn(listApi, 'listAdminQuestion').mockResolvedValue({
    items: [question],
    total: 1,
    page: 1,
    pageSize: 20
  })
  route('/admin/questions?level=N3&page=1')
  expect(
    await screen.findByRole('link', { name: t('common.import') })
  ).toHaveAttribute('href', '/admin/questions/import')
  expect(
    await screen.findByRole('link', { name: questionId + ' 문제 수정' })
  ).toHaveAttribute(
    'href',
    '/admin/questions/' +
      questionId +
      '/edit?returnTo=' +
      encodeURIComponent('/admin/questions?level=N3&page=1')
  )
})
it('renders Japanese import copy from the shared catalog', async () => {
  writeUiLocalePreference('ja')
  route()
  expect(
    await screen.findByRole('heading', { name: '問題の下書きをインポート' })
  ).toBeVisible()
  expect(
    screen.getByRole('button', { name: '書き込みなしで検証' })
  ).toBeDisabled()
  expect(screen.queryByText('import.title')).not.toBeInTheDocument()
})
