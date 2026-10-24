import {
  createStudySessionV2BodySchema,
  createStudySessionV2ResponseSchema,
  type CreateStudySessionV2Response
} from '@nihongo/contracts/study/create-study-session'
import {
  submitStudySessionV2ResponseSchema,
  type SubmitStudySessionV2Response
} from '@nihongo/contracts/study/submit-study-session'
import { getStudyResultResponseSchema } from '@nihongo/contracts/study/get-study-result'
import { getDashboardStatsResponseSchema } from '@nihongo/contracts/dashboard/get-dashboard-stats'
import { getDashboardInsightsResponseSchema } from '@nihongo/contracts/dashboard/get-dashboard-insights'
import {
  listResumableStudySessionsQuerySchema,
  listResumableStudySessionsResponseSchema
} from '@nihongo/contracts/study/list-resumable-study-sessions'
import type {
  RequestLedger,
  RequestLedgerEntry,
  RequestLedgerContractEntry
} from './phase10-request-ledger'

import process from 'node:process'
import { expect, test } from '@playwright/test'
import type { Page, Response, Route } from '@playwright/test'
import { getCurrentPrincipalResponseSchema } from '@nihongo/contracts/auth/get-current-principal'
import {
  isSsoAuthorizationURLForProvider,
  signInSocialResponseSchema
} from '@nihongo/contracts/auth/sign-in-social'
import { listQuestionsResponseSchema } from '@nihongo/contracts/question/list-questions'
import {
  assertAndAttachLedger,
  assertExactRequestMultiset,
  ledgerEntriesFor,
  selectRequestLedger,
  trackRequestLedger,
  waitForLedgerToQuiesce
} from './phase10-request-ledger'

const mode = process.env.PHASE10_BROWSER_MODE
if (mode !== 'real' && mode !== 'mock') {
  throw new Error('PHASE10_BROWSER_MODE must be real or mock.')
}

const browserJson = async (page: Page, path: string, body?: unknown) =>
  page.evaluate(
    async ({ path, body }) => {
      const response = await fetch(path, {
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'include',
        ...(body === undefined
          ? {}
          : {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body)
            })
      })
      return {
        status: response.status,
        body: (await response.json()) as unknown
      }
    },
    { path, body }
  )

for (const locale of ['ko', 'ja'] as const) {
  test(`${locale}: Google TEST handoff confirms the same public USER contract`, async ({
    context,
    page
  }, testInfo) => {
    await context.route(
      /^https:\/\/(?:accounts\.google\.com|appleid\.apple\.com)\//u,
      (route) => route.abort()
    )
    await page.addInitScript((locale) => {
      localStorage.setItem(
        'jlpt-drill-note:ui-locale:v1',
        JSON.stringify({ version: 1, locale })
      )
    }, locale)
    const ledger = trackRequestLedger(context)
    await page.goto('/login')
    await expect(page.getByRole('button', { name: /Google/u })).toBeVisible()
    await expect(page.locator('input[name="password"]')).toHaveCount(0)
    await expect(page.locator('html')).toHaveAttribute('lang', locale)
    if (mode === 'mock') {
      await page.evaluate(async () => {
        const path = '/src/test/phase10BrowserMockControl.ts'
        const control = (await import(/* @vite-ignore */ path)) as {
          resetPhase10MockState: () => Promise<void>
        }
        await control.resetPhase10MockState()
      })
    }
    try {
      const initial = await browserJson(page, '/api/v1/me')
      expect(initial.status).toBe(200)
      expect(getCurrentPrincipalResponseSchema.parse(initial.body).kind).toBe(
        'GUEST'
      )
      const started = await browserJson(page, '/api/auth/sign-in/social', {
        provider: 'google',
        callbackURL: '/practice'
      })
      expect(started.status).toBe(200)
      const authorization = signInSocialResponseSchema.parse(started.body)
      expect(
        isSsoAuthorizationURLForProvider('google', authorization.url)
      ).toBe(true)
      if (mode === 'mock') {
        await page.evaluate(async () => {
          const path = '/src/test/phase10BrowserMockControl.ts'
          const control = (await import(/* @vite-ignore */ path)) as {
            completePhase10MockGoogleCallback: () => Promise<void>
          }
          await control.completePhase10MockGoogleCallback()
        })
      } else {
        const state = new URL(authorization.url).searchParams.get('state')
        if (!state) throw new Error('Google TEST authorization omitted state.')
        const callback = `/api/auth/callback/google?${new URLSearchParams({
          state,
          code: 'phase7-sso-browser-test-code'
        })}`
        const accepted = await page.evaluate(async (path) => {
          try {
            const response = await fetch(path, {
              credentials: 'include',
              redirect: 'follow'
            })
            return response.ok
          } catch {
            return false
          }
        }, callback)
        expect(accepted).toBe(true)
      }
      const confirmed = await browserJson(page, '/api/v1/me')
      expect(confirmed.status).toBe(200)
      const principal = getCurrentPrincipalResponseSchema.parse(confirmed.body)
      expect(principal.kind).toBe('USER')
      if (principal.kind !== 'USER')
        throw new Error('Public USER was not confirmed.')
      expect(principal.user.role).toBe('USER')
      // The schema accepts the real nullable level and Mock N2; neither implies N5.
      expect(
        principal.user.id.length > 0 && principal.user.name.length > 0
      ).toBe(true)
      const catalog = await browserJson(
        page,
        '/api/v1/questions?level=N5&subject=VOCABULARY&page=1&pageSize=5'
      )
      expect(catalog.status).toBe(200)
      const questions = listQuestionsResponseSchema.parse(catalog.body)
      expect(questions.items.length > 0).toBe(true)
      expect(
        questions.items.every(
          (question) =>
            question.level === 'N5' && question.subject === 'VOCABULARY'
        )
      ).toBe(true)
      await waitForLedgerToQuiesce(ledger)
      const authLedger = selectRequestLedger(
        ledger,
        ({ path }) =>
          path.startsWith('/api/auth/') || path.startsWith('/api/_mock/auth/')
      )
      assertExactRequestMultiset(authLedger, [
        { method: 'POST', path: '/api/auth/sign-in/social', statuses: [200] },
        mode === 'mock'
          ? {
              method: 'POST',
              path: '/api/_mock/auth/social/callback',
              statuses: [200]
            }
          : {
              method: 'GET',
              path: '/api/auth/callback/google',
              statuses: [303]
            }
      ])
      for (const entry of ledger.entries) {
        expect(entry.provenance).toBe(
          mode === 'mock'
            ? 'canonical-mock-service-worker'
            : 'canonical-real-network'
        )
      }
      expect(
        ledgerEntriesFor(ledger, 'GET', '/api/v1/me').length
      ).toBeGreaterThanOrEqual(2)
      await assertAndAttachLedger(
        ledger,
        testInfo,
        `phase10-${mode}-${locale}-handoff`
      )
    } finally {
      if (mode === 'mock') {
        await page.evaluate(async () => {
          const path = '/src/test/phase10BrowserMockControl.ts'
          const control = (await import(/* @vite-ignore */ path)) as {
            resetPhase10MockState: () => Promise<void>
          }
          await control.resetPhase10MockState()
        })
      }
    }
  })
}

type DashboardFault = 'malformed' | 'network' | 'rate-limit'

const canonicalProvenance =
  mode === 'mock' ? 'canonical-mock-service-worker' : 'canonical-real-network'

const successfulStatuses = (count: number): readonly number[] =>
  Array.from({ length: count }, () => 200)

const ssoRequestContract = [
  { method: 'POST', path: '/api/auth/sign-in/social', statuses: [200] },
  mode === 'mock'
    ? {
        method: 'POST',
        path: '/api/_mock/auth/social/callback',
        statuses: [200]
      }
    : {
        method: 'GET',
        path: '/api/auth/callback/google',
        statuses: [303]
      }
] as const satisfies readonly RequestLedgerContractEntry[]

const userJourneyRequestContract = [
  ...ssoRequestContract,
  { method: 'GET', path: '/api/v1/me', statuses: successfulStatuses(4) },
  {
    method: 'GET',
    path: '/api/v1/study-sessions',
    statuses: successfulStatuses(3)
  },
  { method: 'GET', path: '/api/v1/dashboard/insights', statuses: [200, 200] },
  { method: 'GET', path: '/api/v1/bookmarks', statuses: successfulStatuses(3) },
  {
    method: 'GET',
    path: '/api/v1/study-sessions/:id',
    statuses: successfulStatuses(4)
  },
  {
    method: 'GET',
    path: '/api/v1/study-sessions/:id/draft-answers',
    statuses: successfulStatuses(15)
  },
  { method: 'GET', path: '/api/v1/study-sessions/:id/result', statuses: [200] },
  { method: 'GET', path: '/api/v1/review-queue', statuses: [200, 200] },
  { method: 'GET', path: '/api/v1/wrong-notes/:id', statuses: [200, 200] },
  {
    method: 'GET',
    path: '/api/v1/wrong-notes/:id/review-events',
    statuses: [200]
  },
  { method: 'GET', path: '/api/v1/dashboard', statuses: [200] },
  { method: 'POST', path: '/api/v1/study-sessions', statuses: [201] },
  {
    method: 'POST',
    path: '/api/v1/study-sessions/:id/submission',
    statuses: [201, 201]
  },
  {
    method: 'POST',
    path: '/api/v1/wrong-notes/:id/review-session',
    statuses: [201]
  },
  {
    method: 'PUT',
    path: '/api/v1/study-sessions/:id/draft-answers',
    statuses: successfulStatuses(6)
  }
] as const satisfies readonly RequestLedgerContractEntry[]

const resilienceRequestContract = [
  ...ssoRequestContract,
  { method: 'GET', path: '/api/v1/me', statuses: [200, 200] },
  { method: 'GET', path: '/api/v1/study-sessions', statuses: [200] },
  {
    method: 'GET',
    path: '/api/v1/dashboard/insights',
    statuses: [
      200,
      'NETWORK_ERROR',
      'NETWORK_ERROR',
      200,
      429,
      429,
      429,
      200,
      200,
      200
    ]
  }
] as const satisfies readonly RequestLedgerContractEntry[]

const waitForApiResponse = (
  page: Page,
  method: string,
  path: string
): Promise<Response> => {
  const origin = new URL(page.url()).origin
  return page.waitForResponse(
    (response) =>
      response.request().method() === method &&
      new URL(response.url()).origin === origin &&
      new URL(response.url()).pathname === path
  )
}

const readCanonicalResponse = async (response: Response): Promise<unknown> => {
  expect(response.status()).toBe(200)
  expect(response.fromServiceWorker()).toBe(mode === 'mock')
  expect(response.headers()['cache-control']).toBe('private, no-store')
  return response.json() as Promise<unknown>
}

const settleJourneyPage = async (page: Page): Promise<void> => {
  await page.waitForLoadState('networkidle')
  await expect(page.locator('main h1')).toHaveCount(1)
}

const prepareJourney = async (page: Page, address: string): Promise<void> => {
  if (mode === 'real') {
    await page.context().setExtraHTTPHeaders({ 'X-Forwarded-For': address })
  }
  // Reset the existing isolated Mock fixture before starting this journey's ledger.
  await page.goto('/login')
  await settleJourneyPage(page)
  if (mode === 'mock') {
    await page.evaluate(async () => {
      const path = '/src/test/phase10BrowserMockControl.ts'
      const control = (await import(/* @vite-ignore */ path)) as {
        resetPhase10MockState: () => Promise<void>
      }
      await control.resetPhase10MockState()
    })
    await page.goto('/login')
    await settleJourneyPage(page)
  }
  await expect(
    page.locator('main button[data-provider="google"]')
  ).toBeEnabled()
}

const loginThroughUi = async (page: Page): Promise<void> => {
  const origin = new URL(page.url()).origin
  const google = page.locator('main button[data-provider="google"]')
  await expect(google).toBeEnabled()
  await expect(page.locator('input[name="password"]')).toHaveCount(0)
  const principalResponse = waitForApiResponse(page, 'GET', '/api/v1/me').then(
    async (response) => {
      const principal = getCurrentPrincipalResponseSchema.parse(
        await readCanonicalResponse(response)
      )
      expect(principal.kind).toBe('USER')
      if (principal.kind !== 'USER')
        throw new Error('Canonical USER was not confirmed.')
      expect(principal.user.role).toBe('USER')
    }
  )
  const resumableResponse = waitForApiResponse(
    page,
    'GET',
    '/api/v1/study-sessions'
  ).then(async (response) => {
    expect(
      listResumableStudySessionsQuerySchema.parse(
        Object.fromEntries(new URL(response.url()).searchParams)
      )
    ).toEqual({ page: 1, pageSize: 5, status: 'IN_PROGRESS' })
    expect(
      await response.request().headerValue('X-Nihongo-Practice-Contract')
    ).toBe('2')
    expect(response.headers()['x-nihongo-practice-contract']).toBe('2')
    const sessions = listResumableStudySessionsResponseSchema.parse(
      await readCanonicalResponse(response)
    )
    expect(sessions).toEqual({ items: [], total: 0, page: 1, pageSize: 5 })
  })
  const insightsResponse = waitForApiResponse(
    page,
    'GET',
    '/api/v1/dashboard/insights'
  ).then(async (response) =>
    getDashboardInsightsResponseSchema.parse(
      await readCanonicalResponse(response)
    )
  )
  const startedResponse = waitForApiResponse(
    page,
    'POST',
    '/api/auth/sign-in/social'
  )
  const providerURL = /^https:\/\/accounts\.google\.com\//u
  if (mode === 'real') await page.route(providerURL, (route) => route.abort())
  try {
    const completeSignIn = async (): Promise<void> => {
      if (mode === 'mock') {
        const [started, completed] = await Promise.all([
          startedResponse,
          waitForApiResponse(page, 'POST', '/api/_mock/auth/social/callback'),
          google.click()
        ])
        expect(started.status()).toBe(200)
        expect(completed.status()).toBe(200)
        const authorization = signInSocialResponseSchema.parse(
          await started.json()
        )
        expect(
          isSsoAuthorizationURLForProvider('google', authorization.url)
        ).toBe(true)
      } else {
        const authorizationRequest = page.waitForRequest(
          (request) =>
            request.isNavigationRequest() &&
            request.frame() === page.mainFrame() &&
            providerURL.test(request.url())
        )
        const [started, redirected] = await Promise.all([
          startedResponse,
          authorizationRequest,
          google.click()
        ])
        expect(started.status()).toBe(200)
        expect(
          isSsoAuthorizationURLForProvider('google', redirected.url())
        ).toBe(true)
        const state = new URL(redirected.url()).searchParams.get('state')
        if (!state) throw new Error('Google TEST authorization omitted state.')
        await page.goto(
          `/api/auth/callback/google?${new URLSearchParams({ state, code: 'phase7-sso-browser-test-code' })}`
        )
      }
    }
    await Promise.all([
      principalResponse,
      resumableResponse,
      insightsResponse,
      completeSignIn()
    ])
    await expect(page).toHaveURL(
      (url) =>
        url.origin === origin &&
        url.pathname === '/dashboard' &&
        url.search === '?view=learning'
    )
    await settleJourneyPage(page)
  } finally {
    if (mode === 'real') await page.unroute(providerURL)
  }
}

const invalidateDashboardInsights = async (page: Page): Promise<void> => {
  await page.evaluate(async () => {
    const modulePath = '/src/libs/queryClient.ts'
    const { queryClient } = (await import(/* @vite-ignore */ modulePath)) as {
      queryClient: {
        invalidateQueries: (options: {
          exact: boolean
          queryKey: readonly string[]
        }) => Promise<void>
      }
    }
    await queryClient.invalidateQueries({
      exact: true,
      queryKey: ['dashboard', 'get-insights']
    })
  })
}

const assertCanonicalLedger = (ledger: RequestLedger): void => {
  expect(
    ledger.entries.every(
      ({ provenance, status }) =>
        status !== 'NETWORK_ERROR' && provenance === canonicalProvenance
    )
  ).toBe(true)
  expect(
    ledger.entries.some(
      ({ path }) =>
        /^\/api\/(?:study\/session|dashboard\/stats|wrong-note)/u.test(path) ||
        /^\/api\/auth\/(?:sign-in\/email|sign-up\/email|verify-email|forget-password|reset-password)/u.test(
          path
        )
    )
  ).toBe(false)
}

const armDashboardFault = async (
  page: Page,
  fault: DashboardFault
): Promise<() => Promise<void>> => {
  if (mode === 'mock') {
    await page.evaluate(async (faultKind) => {
      const modulePath = '/src/test/phase10BrowserMockControl.ts'
      const control = (await import(/* @vite-ignore */ modulePath)) as {
        armPhase10DashboardInsightsFault: (value: DashboardFault) => void
      }
      control.armPhase10DashboardInsightsFault(faultKind)
    }, fault)
    return async () => undefined
  }

  const failureCount = fault === 'network' ? 2 : fault === 'rate-limit' ? 3 : 1
  let remaining = failureCount
  const pattern = '**/api/v1/dashboard/insights'
  const handler = async (route: Route): Promise<void> => {
    if (remaining <= 0) {
      await route.continue()
      return
    }
    remaining -= 1
    if (fault === 'network') {
      await route.abort('failed')
      return
    }
    if (fault === 'malformed') {
      await route.fulfill({
        body: JSON.stringify({ malformed: true }),
        contentType: 'application/json',
        headers: {
          'Cache-Control': 'private, no-store',
          'X-Phase10-Test-Fault': 'dashboard-insights-malformed'
        },
        status: 200
      })
      return
    }
    const requestId = crypto.randomUUID()
    await route.fulfill({
      body: JSON.stringify({
        code: 'RATE_LIMITED',
        message: 'Phase 10 browser rate-limit fault injection',
        requestId,
        retryable: true
      }),
      contentType: 'application/json',
      headers: {
        'Cache-Control': 'private, no-store',
        'Retry-After': '0',
        'X-Phase10-Test-Fault': 'dashboard-insights-429',
        'X-Request-Id': requestId
      },
      status: 429
    })
  }
  await page.route(pattern, handler)
  return async () => page.unroute(pattern, handler)
}

const waitForSavedDraft = async (page: Page): Promise<void> => {
  await expect(page.locator('[data-save-state]')).toHaveAttribute(
    'data-save-state',
    'saved',
    { timeout: 15_000 }
  )
}

const freezePracticeClock = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const fixedNow = performance.now()
    Object.defineProperty(performance, 'now', {
      configurable: true,
      value: () => fixedNow
    })
  })
}

const restorePracticeClock = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    if (!Reflect.deleteProperty(performance, 'now')) {
      throw new Error('Failed to restore the Phase 10 practice clock.')
    }
  })
}

const answerEveryQuestionWithFirstOption = async (
  page: Page,
  count: number
): Promise<void> => {
  for (let ordinal = 1; ordinal <= count; ordinal += 1) {
    if (ordinal > 1) {
      await page
        .getByRole('button', { name: new RegExp(`^${ordinal}번 문제`, 'u') })
        .click()
    }
    const saveResponse = page.waitForResponse((response) => {
      const request = response.request()
      return (
        request.method() === 'PUT' &&
        /^\/api\/v1\/study-sessions\/[0-9a-f-]+\/draft-answers$/u.test(
          new URL(response.url()).pathname
        )
      )
    })
    await page.getByRole('radio').first().click()
    expect((await saveResponse).status()).toBe(200)
    await waitForSavedDraft(page)
  }
}

const assertFaultRecovery = async (
  page: Page,
  ledger: RequestLedger,
  fault: DashboardFault
): Promise<void> => {
  const path = '/api/v1/dashboard/insights'
  const startIndex = ledger.entries.length
  const removeFault = await armDashboardFault(page, fault)
  const error = page
    .locator('details.practice-recommendations')
    .getByRole('alert')
  try {
    await invalidateDashboardInsights(page)
    await expect(
      error.getByText(
        '추천을 확인하지 못했습니다. 다시 확인하거나 다른 학습을 선택해 주세요.',
        { exact: true }
      )
    ).toBeVisible()
    await expect(
      error.getByRole('button', { name: '다시 확인', exact: true })
    ).toBeEnabled()
  } finally {
    await removeFault()
  }
  const failedEntries = ledgerEntriesFor(ledger, 'GET', path, startIndex)
  const failureCount = fault === 'network' ? 2 : fault === 'rate-limit' ? 3 : 1
  expect(failedEntries).toHaveLength(failureCount)
  expect(failedEntries.map(({ status }) => status)).toEqual(
    fault === 'network'
      ? ['NETWORK_ERROR', 'NETWORK_ERROR']
      : fault === 'rate-limit'
        ? [429, 429, 429]
        : [200]
  )
  expect(
    failedEntries.every(
      ({ provenance }) =>
        provenance ===
        (fault === 'network' ? 'network-failure' : 'injected-test-fault')
    )
  ).toBe(true)

  const recovered = waitForApiResponse(page, 'GET', path).then(
    async (response) => {
      expect(response.headers()['x-phase10-test-fault']).toBeUndefined()
      getDashboardInsightsResponseSchema.parse(
        await readCanonicalResponse(response)
      )
    }
  )
  await error.getByRole('button', { name: '다시 확인', exact: true }).click()
  await recovered
  await expect(error).toBeHidden()
  await expect(
    page.locator('details.practice-recommendations h2')
  ).toBeFocused()
  await waitForLedgerToQuiesce(ledger)
  const entries = ledgerEntriesFor(ledger, 'GET', path, startIndex)
  expect(entries).toHaveLength(failureCount + 1)
  expect(entries.map(({ status }) => status)).toEqual(
    fault === 'network'
      ? ['NETWORK_ERROR', 'NETWORK_ERROR', 200]
      : fault === 'rate-limit'
        ? [429, 429, 429, 200]
        : [200, 200]
  )
  expect(entries.at(-1)?.provenance).toBe(canonicalProvenance)
}

const startVocabularySessionThroughUi = async (
  page: Page
): Promise<CreateStudySessionV2Response> => {
  const bootstrap = waitForApiResponse(page, 'GET', '/api/v1/me')
  const resumable = waitForApiResponse(page, 'GET', '/api/v1/study-sessions')
  await page.goto('/practice')
  const principal = getCurrentPrincipalResponseSchema.parse(
    await readCanonicalResponse(await bootstrap)
  )
  expect(principal.kind).toBe('USER')
  listResumableStudySessionsResponseSchema.parse(
    await readCanonicalResponse(await resumable)
  )
  await page.getByRole('radio', { name: 'N5', exact: true }).check()
  await page.getByRole('radio', { name: '어휘', exact: true }).check()
  await page.getByRole('radio', { name: '5문제', exact: true }).check()
  await expect(
    page.locator('input[name="practice-level"][value="N5"]')
  ).toBeChecked()
  await expect(
    page.locator('input[name="practice-subject"][value="VOCABULARY"]')
  ).toBeChecked()
  await expect(
    page.locator('input[name="practice-count"][value="5"]')
  ).toBeChecked()
  await page.locator('details.practice-mode-options > summary').click()
  await expect(
    page.getByRole('combobox', { name: '출제 방식', exact: true })
  ).toHaveValue('RANDOM')
  await freezePracticeClock(page)
  const createdResponse = waitForApiResponse(
    page,
    'POST',
    '/api/v1/study-sessions'
  )
  await page
    .getByRole('button', { name: 'N5 어휘 · 5문제 시작', exact: true })
    .click()
  const response = await createdResponse
  expect(response.status()).toBe(201)
  expect(response.fromServiceWorker()).toBe(mode === 'mock')
  expect(response.headers()['x-nihongo-practice-contract']).toBe('2')
  expect(
    createStudySessionV2BodySchema.parse(response.request().postDataJSON())
  ).toEqual({ level: 'N5', subject: 'VOCABULARY', count: 5, mode: 'RANDOM' })
  const created = createStudySessionV2ResponseSchema.parse(
    await response.json()
  )
  expect(created.session).toMatchObject({
    actualCount: 5,
    level: 'N5',
    mode: 'RANDOM',
    practiceContractVersion: 2,
    subject: 'VOCABULARY'
  })
  expect(created.questions).toHaveLength(5)
  await expect(page).toHaveURL(
    new RegExp(`/practice/session/${created.session.id}$`, 'u')
  )
  return created
}

const submitCurrentSessionThroughUi = async (
  page: Page,
  sessionId: string,
  heading: '학습 결과' | '복습 완료' = '학습 결과'
): Promise<SubmitStudySessionV2Response> => {
  const submittedResponse = waitForApiResponse(
    page,
    'POST',
    `/api/v1/study-sessions/${sessionId}/submission`
  )
  await page.getByRole('button', { name: '답안 제출', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '답안을 제출하시겠습니까?' })
  await expect(dialog).toBeVisible()
  await dialog
    .getByRole('button', { name: '제출하고 결과 보기', exact: true })
    .click()
  const response = await submittedResponse
  expect(response.status()).toBe(201)
  expect(response.fromServiceWorker()).toBe(mode === 'mock')
  expect(response.headers()['x-nihongo-practice-contract']).toBe('2')
  const submitted = submitStudySessionV2ResponseSchema.parse(
    await response.json()
  )
  await expect(page).toHaveURL(
    new RegExp(`/practice/result/${sessionId}$`, 'u')
  )
  await expect(
    page.getByRole('heading', { name: heading, exact: true })
  ).toBeVisible()
  await restorePracticeClock(page)
  return submitted
}

test('guest SSO boundary and authenticated practice transition match the active mode', async ({
  context,
  page
}, testInfo) => {
  test.setTimeout(90_000)
  await prepareJourney(page, '203.0.113.243')
  const ledger = trackRequestLedger(context)
  const guestPrincipal = waitForApiResponse(page, 'GET', '/api/v1/me').then(
    async (response) => {
      const principal = getCurrentPrincipalResponseSchema.parse(
        await readCanonicalResponse(response)
      )
      expect(principal.kind).toBe('GUEST')
    }
  )
  await page.goto('/practice')
  await guestPrincipal
  await settleJourneyPage(page)
  await expect(
    page.getByText('로그인 없이 시작할 수 있어요.', { exact: true })
  ).toBeVisible()
  await page.locator('details.practice-mode-options > summary').click()
  const studyMode = page.getByRole('combobox', {
    name: '출제 방식',
    exact: true
  })
  for (const value of ['BOOKMARK', 'DAILY_REVIEW', 'WRONG_NOTE']) {
    await expect(studyMode.locator(`option[value="${value}"]`)).toBeDisabled()
  }
  for (const path of [
    '/login?mode=signup#retired-token',
    '/reset-password#retired-token',
    '/verify-email#retired-token'
  ]) {
    await page.goto(path)
    await expect(page).toHaveURL(
      (url) => url.pathname === '/login' && url.search === '' && url.hash === ''
    )
    await expect(
      page.getByText(
        '로그인 방법이 변경되었어요. 연결한 계정으로 계속해 주세요.',
        { exact: true }
      )
    ).toBeVisible()
    await expect(
      page.locator(
        'input[name="email"], input[name="password"], input[name="name"]'
      )
    ).toHaveCount(0)
    await expect(
      page.locator('main button[data-provider="google"]')
    ).toBeEnabled()
    await settleJourneyPage(page)
  }
  await loginThroughUi(page)
  await page.locator('#primary-navigation a[href="/practice"]').click()
  await expect(page).toHaveURL(/\/practice$/u)
  await page.locator('details.practice-mode-options > summary').click()
  for (const value of ['BOOKMARK', 'DAILY_REVIEW', 'WRONG_NOTE']) {
    await expect(
      page
        .getByRole('combobox', { name: '출제 방식', exact: true })
        .locator(`option[value="${value}"]`)
    ).toBeEnabled()
  }
  await expect(
    page.getByText('로그인 없이 시작할 수 있어요.', { exact: true })
  ).toHaveCount(0)
  await waitForLedgerToQuiesce(ledger)
  assertCanonicalLedger(ledger)
  await assertAndAttachLedger(
    ledger,
    testInfo,
    `phase10-guest-auth-${mode}-request-ledger`
  )
  assertExactRequestMultiset(ledger, [
    ...ssoRequestContract,
    { method: 'GET', path: '/api/v1/me', statuses: successfulStatuses(5) },
    { method: 'GET', path: '/api/v1/study-sessions', statuses: [200] },
    { method: 'GET', path: '/api/v1/dashboard/insights', statuses: [200] }
  ])
})

test('USER completes one setup-to-dashboard journey with an exact mutation ledger', async ({
  context,
  page
}, testInfo) => {
  test.setTimeout(150_000)
  await prepareJourney(page, '203.0.113.245')
  const ledger = trackRequestLedger(context)
  await page.goto('/login')
  await settleJourneyPage(page)
  await loginThroughUi(page)
  const created = await startVocabularySessionThroughUi(page)
  await answerEveryQuestionWithFirstOption(page, created.session.actualCount)
  const primarySubmission = await submitCurrentSessionThroughUi(
    page,
    created.session.id
  )
  expect(primarySubmission).toMatchObject({
    correctCount: 2,
    correctRate: 40,
    incorrectCount: 3,
    totalCount: 5
  })
  const incorrect = primarySubmission.items.find((item) => !item.isCorrect)
  expect(incorrect).toBeDefined()
  if (!incorrect)
    throw new Error('The original three-incorrect fixture was not produced.')

  const reloadedResult = waitForApiResponse(
    page,
    'GET',
    `/api/v1/study-sessions/${created.session.id}/result`
  ).then(async (response) =>
    getStudyResultResponseSchema.parse(await readCanonicalResponse(response))
  )
  await page.reload()
  const persisted = await reloadedResult
  expect(persisted).toEqual(primarySubmission)
  await expect(
    page.getByRole('heading', { name: '학습 결과', exact: true })
  ).toBeVisible()
  const locale = page.locator('select[name="ui-locale"]:visible')
  await expect(locale).toHaveCount(1)
  await locale.selectOption('ja')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
  await expect(
    page.getByRole('heading', { name: '学習結果', exact: true })
  ).toBeVisible()
  await locale.selectOption('ko')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko')

  await page.getByRole('link', { name: '오답노트 보기', exact: true }).click()
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === '/wrong-notes' &&
      url.searchParams.get('view') === 'UNREVIEWED'
  )
  await expect(
    page.getByRole('heading', { name: '복습', exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole('combobox', { name: '복습 범위', exact: true })
  ).toHaveValue('UNREVIEWED')
  await expect(
    page.getByRole('heading', { name: '3문제', exact: true })
  ).toBeVisible()
  const returnTo = new URL(page.url()).pathname + new URL(page.url()).search
  const detail = page.locator(
    `.review-item-link[href^="/wrong-notes/${incorrect.question.id}?"]`
  )
  await expect(detail).toHaveCount(1)
  await expect(detail).toContainText('해설 보기')
  await detail.click()
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === `/wrong-notes/${incorrect.question.id}` &&
      url.searchParams.get('returnTo') === returnTo
  )
  await expect(
    page.getByRole('heading', { name: '마지막 오답 문제 상세', exact: true })
  ).toBeVisible()
  await expect(
    page.getByText(incorrect.question.questionText, { exact: true })
  ).toBeVisible()

  const targetedResponsePromise = waitForApiResponse(
    page,
    'POST',
    `/api/v1/wrong-notes/${incorrect.question.id}/review-session`
  )
  await page
    .getByRole('button', { name: '이 문제만 다시 풀기', exact: true })
    .click()
  const targetedResponse = await targetedResponsePromise
  expect(targetedResponse.status()).toBe(201)
  expect(targetedResponse.fromServiceWorker()).toBe(mode === 'mock')
  expect(targetedResponse.headers()['x-nihongo-practice-contract']).toBe('2')
  const targeted = createStudySessionV2ResponseSchema.parse(
    await targetedResponse.json()
  )
  expect(targeted.session).toMatchObject({
    actualCount: 1,
    mode: 'WRONG_NOTE',
    practiceContractVersion: 2
  })
  expect(targeted.questions).toHaveLength(1)
  expect(targeted.questions[0]?.question.id).toBe(incorrect.question.id)
  await expect(page).toHaveURL(
    new RegExp(`/practice/session/${targeted.session.id}$`, 'u')
  )
  await freezePracticeClock(page)
  await answerEveryQuestionWithFirstOption(page, 1)
  const targetedSubmission = await submitCurrentSessionThroughUi(
    page,
    targeted.session.id,
    '복습 완료'
  )
  expect(targetedSubmission).toMatchObject({
    correctCount: 0,
    incorrectCount: 1,
    totalCount: 1
  })
  await expect(
    page.getByRole('heading', { name: '다시 확인해 볼까요?', exact: true })
  ).toBeVisible()
  await expect(
    page.getByText('같은 문제를 다시 틀렸어요. 해설을 읽고 다시 복습해요.', {
      exact: true
    })
  ).toBeVisible()

  const dashboardStartIndex = ledger.entries.length
  await page.getByRole('link', { name: '복습 목록으로', exact: true }).click()
  await expect(page).toHaveURL((url) => url.pathname + url.search === returnTo)
  const summaryResponse = waitForApiResponse(
    page,
    'GET',
    '/api/v1/dashboard'
  ).then(async (response) =>
    getDashboardStatsResponseSchema.parse(await readCanonicalResponse(response))
  )
  await page.locator('details.review-recent-results > summary').click()
  const summary = await summaryResponse
  expect(summary).toMatchObject({ totalAnsweredCount: 6, wrongNoteCount: 3 })
  expect(summary.recentStudySessions.map(({ id }) => id).toSorted()).toEqual(
    [created.session.id, targeted.session.id].toSorted()
  )
  for (const sessionId of [created.session.id, targeted.session.id]) {
    await expect(
      page.locator(
        `details.review-recent-results a[href="/practice/result/${sessionId}"]`
      )
    ).toBeVisible()
  }
  const finalInsightsResponse = waitForApiResponse(
    page,
    'GET',
    '/api/v1/dashboard/insights'
  ).then(async (response) =>
    getDashboardInsightsResponseSchema.parse(
      await readCanonicalResponse(response)
    )
  )
  await page.locator('#primary-navigation a[href="/"]').click()
  await expect(page).toHaveURL(/\/dashboard\?view=learning$/u)
  const insights = await finalInsightsResponse
  expect(insights.stats.overall.attemptedCount).toBe(6)
  await page.locator('details.practice-recommendations > summary').click()
  await expect(
    page.locator('details.practice-recommendations h2')
  ).toBeVisible()
  await waitForLedgerToQuiesce(ledger)

  const signInEntries = ledgerEntriesFor(
    ledger,
    'POST',
    '/api/auth/sign-in/social'
  )
  const createEntries = ledgerEntriesFor(
    ledger,
    'POST',
    '/api/v1/study-sessions'
  )
  const draftEntries = ledgerEntriesFor(
    ledger,
    'PUT',
    '/api/v1/study-sessions/:id/draft-answers'
  )
  const submissionEntries = ledgerEntriesFor(
    ledger,
    'POST',
    '/api/v1/study-sessions/:id/submission'
  )
  const targetedEntries = ledgerEntriesFor(
    ledger,
    'POST',
    '/api/v1/wrong-notes/:id/review-session'
  )
  expect(signInEntries).toHaveLength(1)
  expect(createEntries).toHaveLength(1)
  expect(draftEntries).toHaveLength(6)
  expect(submissionEntries).toHaveLength(2)
  expect(targetedEntries).toHaveLength(1)
  const mutationEntries = [
    ...draftEntries,
    ...submissionEntries,
    ...targetedEntries
  ]
  expect(
    mutationEntries.every(
      ({ idempotencyKeyDigest }) =>
        idempotencyKeyDigest !== null &&
        /^[a-f0-9]{64}$/u.test(idempotencyKeyDigest)
    )
  ).toBe(true)
  expect(
    mutationEntries.every(
      ({ bodyDigest }) =>
        bodyDigest !== null && /^[a-f0-9]{64}$/u.test(bodyDigest)
    )
  ).toBe(true)
  const idempotencyKeyDigests = mutationEntries.map(
    ({ idempotencyKeyDigest }) => idempotencyKeyDigest
  )
  const bodyDigests = mutationEntries.map(({ bodyDigest }) => bodyDigest)
  expect(new Set(idempotencyKeyDigests).size).toBe(idempotencyKeyDigests.length)
  expect(new Set(bodyDigests).size).toBe(bodyDigests.length)

  const requireFinished = (entry: RequestLedgerEntry | undefined): number => {
    expect(entry).toBeDefined()
    expect(entry?.finishSequence).not.toBeNull()
    return entry?.finishSequence ?? -1
  }
  expect(requireFinished(signInEntries[0])).toBeLessThan(
    createEntries[0]?.startSequence ?? -1
  )
  expect(requireFinished(createEntries[0])).toBeLessThan(
    draftEntries[0]?.startSequence ?? -1
  )
  expect(requireFinished(draftEntries[4])).toBeLessThan(
    submissionEntries[0]?.startSequence ?? -1
  )
  expect(requireFinished(submissionEntries[0])).toBeLessThan(
    targetedEntries[0]?.startSequence ?? -1
  )
  expect(requireFinished(draftEntries[5])).toBeLessThan(
    submissionEntries[1]?.startSequence ?? -1
  )

  const dashboardSummaryEntries = ledgerEntriesFor(
    ledger,
    'GET',
    '/api/v1/dashboard',
    dashboardStartIndex
  )
  const dashboardInsightEntries = ledgerEntriesFor(
    ledger,
    'GET',
    '/api/v1/dashboard/insights',
    dashboardStartIndex
  )
  expect(dashboardSummaryEntries).toHaveLength(1)
  expect(dashboardInsightEntries).toHaveLength(1)
  for (const entry of [
    ...dashboardSummaryEntries,
    ...dashboardInsightEntries
  ]) {
    expect(requireFinished(entry)).toBeGreaterThan(entry.startSequence)
    expect(requireFinished(submissionEntries[1])).toBeLessThan(
      entry.startSequence
    )
  }
  expect(requireFinished(targetedEntries[0])).toBeLessThan(
    draftEntries[5]?.startSequence ?? -1
  )

  assertCanonicalLedger(ledger)
  await assertAndAttachLedger(
    ledger,
    testInfo,
    `phase10-user-journey-${mode}-request-ledger`
  )
  assertExactRequestMultiset(ledger, userJourneyRequestContract)
})

test('network, rate-limit, and malformed responses require explicit recovery without duplicate requests', async ({
  context,
  page
}, testInfo) => {
  test.setTimeout(120_000)
  await prepareJourney(page, '203.0.113.244')
  const ledger = trackRequestLedger(context)
  await page.goto('/login')
  await settleJourneyPage(page)
  await loginThroughUi(page)
  await expect(page).toHaveURL(/\/dashboard\?view=learning$/u)
  const landingReads = ledgerEntriesFor(ledger, 'GET', '/api/v1/study-sessions')
  expect(landingReads).toHaveLength(1)
  expect(landingReads[0]).toMatchObject({
    provenance: canonicalProvenance,
    status: 200
  })
  expect(landingReads[0]?.finishSequence).toBeGreaterThan(
    landingReads[0]?.startSequence ?? -1
  )
  const signIn = ledgerEntriesFor(ledger, 'POST', '/api/auth/sign-in/social')
  expect(signIn).toHaveLength(1)
  expect(landingReads[0]?.startSequence).toBeGreaterThan(
    signIn[0]?.finishSequence ?? -1
  )
  await page.locator('details.practice-recommendations > summary').click()
  await expect(
    page.locator('details.practice-recommendations h2')
  ).toBeVisible()
  for (const fault of [
    'network',
    'rate-limit',
    'malformed'
  ] as const satisfies readonly DashboardFault[]) {
    await assertFaultRecovery(page, ledger, fault)
  }
  await waitForLedgerToQuiesce(ledger)
  await assertAndAttachLedger(
    ledger,
    testInfo,
    `phase10-resilience-${mode}-request-ledger`
  )
  assertExactRequestMultiset(ledger, resilienceRequestContract)
})
