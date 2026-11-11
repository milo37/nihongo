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
import { getStudyDraftAnswersResponseSchema } from '@nihongo/contracts/study/get-study-draft-answers'
import {
  saveStudyDraftAnswersBodySchema,
  saveStudyDraftAnswersResponseSchema
} from '@nihongo/contracts/study/save-study-draft-answers'
import { getDashboardStatsResponseSchema } from '@nihongo/contracts/dashboard/get-dashboard-stats'
import {
  listResumableStudySessionsQuerySchema,
  listResumableStudySessionsResponseSchema
} from '@nihongo/contracts/study/list-resumable-study-sessions'
import type {
  RequestLedger,
  RequestLedgerEntry,
  RequestLedgerContractEntry
} from './request-ledger'

import process from 'node:process'
import { expect, test } from '@playwright/test'
import type { JSHandle, Page, Response, Route } from '@playwright/test'
import { getCurrentPrincipalResponseSchema } from '@nihongo/contracts/auth/get-current-principal'
import { ssoAccountCapabilitiesSchema } from '@nihongo/contracts/auth/sso-account-management'
import { getWrongNoteResponseSchema } from '@nihongo/contracts/wrong-note/get-wrong-note'
import { importGuestResultResponseSchema } from '@nihongo/contracts/study/import-guest-result'
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
} from './request-ledger'

const mode = process.env.JOURNEY_BROWSER_MODE
if (mode !== 'real' && mode !== 'mock') {
  throw new Error('JOURNEY_BROWSER_MODE must be real or mock.')
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
        'harumaru:ui-locale:v1',
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
        const path = '/src/test/journeyBrowserMockControl.ts'
        const control = (await import(/* @vite-ignore */ path)) as {
          resetJourneyMockState: () => Promise<void>
        }
        await control.resetJourneyMockState()
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
          const path = '/src/test/journeyBrowserMockControl.ts'
          const control = (await import(/* @vite-ignore */ path)) as {
            completeMockGoogleCallback: () => Promise<void>
          }
          await control.completeMockGoogleCallback()
        })
      } else {
        const state = new URL(authorization.url).searchParams.get('state')
        if (!state) throw new Error('Google TEST authorization omitted state.')
        const callback = `/api/auth/callback/google?${new URLSearchParams({
          state,
          code: 'sso-browser-test-code'
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
        `journey-${mode}-${locale}-handoff`
      )
    } finally {
      if (mode === 'mock') {
        await page.evaluate(async () => {
          const path = '/src/test/journeyBrowserMockControl.ts'
          const control = (await import(/* @vite-ignore */ path)) as {
            resetJourneyMockState: () => Promise<void>
          }
          await control.resetJourneyMockState()
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
      },
  // The first signed-in render moves the guest's last result once (JLP-823).
  { method: 'POST', path: '/api/v1/me/guest-result-import', statuses: [200] }
] as const satisfies readonly RequestLedgerContractEntry[]

// Opening My page reads the sign-in methods and the all-time stats once.
const accountPageRequestContract = [
  { method: 'GET', path: '/api/auth/sso/accounts', statuses: [200] }
] as const satisfies readonly RequestLedgerContractEntry[]

const userJourneyRequestContract = [
  ...ssoRequestContract,
  ...accountPageRequestContract,
  {
    method: 'GET',
    path: '/api/v1/me',
    statuses: successfulStatuses(mode === 'mock' ? 5 : 4)
  },
  {
    method: 'GET',
    path: '/api/v1/study-sessions',
    statuses: successfulStatuses(3)
  },
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
  // The review page twice, and the member first screen's 'to review' line
  // on each of its two visits (JLP-823).
  {
    method: 'GET',
    path: '/api/v1/review-list',
    statuses: successfulStatuses(4)
  },
  { method: 'GET', path: '/api/v1/wrong-notes/:id', statuses: [200, 200] },
  {
    method: 'GET',
    path: '/api/v1/wrong-notes/:id/review-events',
    statuses: [200]
  },
  { method: 'GET', path: '/api/v1/dashboard', statuses: [200] },
  // Today's question on the learning home, once per level shown (D, #801).
  { method: 'GET', path: '/api/v1/daily-question', statuses: [200, 200] },
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
  ...accountPageRequestContract,
  {
    method: 'GET',
    path: '/api/v1/me',
    statuses: successfulStatuses(mode === 'mock' ? 3 : 2)
  },
  { method: 'GET', path: '/api/v1/study-sessions', statuses: [200] },
  // Today's question on the learning home (D, #801).
  { method: 'GET', path: '/api/v1/daily-question', statuses: [200] },
  // The member first screen's 'to review' line (JLP-823).
  { method: 'GET', path: '/api/v1/review-list', statuses: [200] },
  {
    method: 'GET',
    path: '/api/v1/dashboard',
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

const openPracticeModes = async (page: Page) => {
  const disclosure = page.locator('details.practice-mode-options')
  const summary = disclosure.locator('summary')
  await expect(summary).toBeVisible()
  if ((await disclosure.getAttribute('open')) === null) await summary.click()
  await expect(disclosure).toHaveAttribute('open', '')
  const modeSelect = disclosure.locator('select[name="practice-mode"]')
  await expect(modeSelect).toHaveCount(1)
  await expect(modeSelect).toBeVisible()
  await expect(modeSelect).toHaveAccessibleName('출제 방식')
  // Random or the review set only (subtract table 3).
  await expect(modeSelect.locator('option')).toHaveCount(2)
  return modeSelect
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
      const path = '/src/test/journeyBrowserMockControl.ts'
      const control = (await import(/* @vite-ignore */ path)) as {
        resetJourneyMockState: () => Promise<void>
      }
      await control.resetJourneyMockState()
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
  const principalResponses: Response[] = []
  const collectPrincipal = (response: Response): void => {
    const url = new URL(response.url())
    if (
      response.request().method() === 'GET' &&
      url.origin === origin &&
      url.pathname === '/api/v1/me'
    ) {
      principalResponses.push(response)
    }
  }
  page.on('response', collectPrincipal)
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
    ).toEqual({ page: 1, pageSize: 1, status: 'IN_PROGRESS' })
    expect(
      await response.request().headerValue('X-Nihongo-Practice-Contract')
    ).toBe('2')
    expect(response.headers()['x-nihongo-practice-contract']).toBe('2')
    const sessions = listResumableStudySessionsResponseSchema.parse(
      await readCanonicalResponse(response)
    )
    expect(sessions).toEqual({ items: [], total: 0, page: 1, pageSize: 1 })
  })
  const startedResponse = waitForApiResponse(
    page,
    'POST',
    '/api/auth/sign-in/social'
  )
  const providerURL = /^https:\/\/accounts\.google\.com\//u
  // Answer the provider with a blank page: an aborted navigation lands on
  // Chromium's error page late enough to interrupt the callback below.
  if (mode === 'real')
    await page.route(providerURL, (route) =>
      route.fulfill({ contentType: 'text/html', body: '<!doctype html>' })
    )
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
        await page.waitForURL(providerURL)
        await page.goto(
          `/api/auth/callback/google?${new URLSearchParams({ state, code: 'sso-browser-test-code' })}`
        )
      }
    }
    await Promise.all([principalResponse, resumableResponse, completeSignIn()])
    await expect(page).toHaveURL(
      (url) =>
        url.origin === origin &&
        url.pathname === '/dashboard' &&
        url.search === '?view=learning'
    )
    await settleJourneyPage(page)
    expect(principalResponses).toHaveLength(mode === 'mock' ? 2 : 1)
    const identities: string[] = []
    for (const response of principalResponses) {
      const principal = getCurrentPrincipalResponseSchema.parse(
        await readCanonicalResponse(response)
      )
      expect(principal.kind).toBe('USER')
      if (principal.kind !== 'USER')
        throw new Error('Canonical USER revalidation failed.')
      expect(principal.user.role).toBe('USER')
      identities.push(principal.user.id)
    }
    expect(new Set(identities).size).toBe(1)
  } finally {
    page.off('response', collectPrincipal)
    if (mode === 'real') await page.unroute(providerURL)
  }
}

const queryClientModulePath =
  '/@fs' +
  new URL(import.meta.resolve('@nihongo/browser/libs/queryClient')).pathname

const invalidateDashboardStats = async (page: Page): Promise<void> => {
  await page.evaluate(async (modulePath) => {
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
      queryKey: ['dashboard', 'get-stats']
    })
  }, queryClientModulePath)
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
      const modulePath = '/src/test/journeyBrowserMockControl.ts'
      const control = (await import(/* @vite-ignore */ modulePath)) as {
        armDashboardStatsFault: (value: DashboardFault) => void
      }
      control.armDashboardStatsFault(faultKind)
    }, fault)
    return async () => undefined
  }

  const failureCount = fault === 'network' ? 2 : fault === 'rate-limit' ? 3 : 1
  let remaining = failureCount
  const pattern = '**/api/v1/dashboard'
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
          'X-Nihongo-Test-Fault': 'dashboard-stats-malformed'
        },
        status: 200
      })
      return
    }
    const requestId = crypto.randomUUID()
    await route.fulfill({
      body: JSON.stringify({
        code: 'RATE_LIMITED',
        message: 'Browser rate-limit fault injection',
        requestId,
        retryable: true
      }),
      contentType: 'application/json',
      headers: {
        'Cache-Control': 'private, no-store',
        'Retry-After': '0',
        'X-Nihongo-Test-Fault': 'dashboard-stats-429',
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
    /^(saved|savedAt)$/u,
    { timeout: 15_000 }
  )
}

const freezePracticeClock = async (
  page: Page
): Promise<JSHandle<() => number>> =>
  page.evaluateHandle(() => {
    const originalNow = performance.now
    const fixedNow = performance.now()
    Object.defineProperty(performance, 'now', {
      configurable: true,
      value: () => fixedNow
    })
    return originalNow
  })

const restorePracticeClock = async (
  page: Page,
  originalNow: JSHandle<() => number>
): Promise<void> => {
  await page.evaluate((originalNow) => {
    Object.defineProperty(performance, 'now', {
      configurable: true,
      value: originalNow
    })
  }, originalNow)
  await originalNow.dispose()
}

const answerEveryQuestionWithFirstOption = async (
  page: Page,
  created: CreateStudySessionV2Response,
  ledger: RequestLedger
): Promise<void> => {
  const helperStartIndex = ledger.entries.length
  const draftLedgerPath = '/api/v1/study-sessions/:id/draft-answers'
  let lastPutStartedAt: number | null = null
  await expect(page.locator('[data-save-state]')).toHaveAttribute(
    'data-save-state',
    'synced'
  )
  await expect(page.locator('main h1')).toBeFocused()
  const isSingleReview =
    created.session.mode === 'WRONG_NOTE' && created.session.actualCount === 1
  // The number sheet opens from the top bar's "1 / N" (direction §6-4).
  const sheetTrigger = page.getByRole('button', { name: /^문제 번호 /u })
  if (isSingleReview) {
    expect(created.questions).toHaveLength(1)
    await expect(page.locator('.study-review-session')).toBeVisible()
    await expect(sheetTrigger).toHaveCount(0)
    await expect(
      page.getByRole('link', { name: '해설로 돌아가기', exact: true })
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: '제출하기', exact: true })
    ).toBeVisible()
  } else {
    await expect(page.locator('.study-review-session')).toHaveCount(0)
    await expect(sheetTrigger).toBeVisible()
  }
  const draftPath = `/api/v1/study-sessions/${created.session.id}/draft-answers`
  for (const [index, item] of created.questions.entries()) {
    const ordinal = index + 1
    const options = page.locator(
      `input[type="radio"][name="question-${item.question.id}"]`
    )
    const firstAnswer = options.first()
    const savesBefore = ledgerEntriesFor(
      ledger,
      'PUT',
      draftLedgerPath,
      helperStartIndex
    ).length
    expect(savesBefore).toBe(index)
    const saveResponse = waitForApiResponse(page, 'PUT', draftPath)
    const clockTime = Math.max(
      Date.now(),
      lastPutStartedAt ?? Number.NEGATIVE_INFINITY
    )
    const saveDelayMs = Math.max(
      2_000,
      (lastPutStartedAt ?? Number.NEGATIVE_INFINITY) + 5_000 - clockTime
    )
    // Freeze wall time until paused; runFor must advance it after setup.
    await page.clock.setFixedTime(clockTime)
    await page.clock.pauseAt(clockTime)
    await page.clock.setSystemTime(clockTime)
    try {
      if (!isSingleReview) {
        if (ordinal > 1)
          await page.getByRole('button', { name: '다음', exact: true }).click()
        await expect(sheetTrigger).toHaveText(
          `${ordinal} / ${created.questions.length}`
        )
      }
      await expect(options).toHaveCount(4)
      await expect(page.locator('main h1')).toBeFocused()
      await expect(firstAnswer).toBeEnabled()
      await expect(firstAnswer).not.toBeChecked()
      expect(item.question.options[0]).toBeDefined()
      await expect(firstAnswer).toHaveValue(item.question.options[0]!.id)
      await firstAnswer.press('Space')
      await expect(firstAnswer).toBeChecked()
      await expect(page.locator('[data-save-state]')).toHaveAttribute(
        'data-save-state',
        /^(dirty|saving|savedAt)$/u
      )
      await page.clock.runFor(saveDelayMs - 1)
      expect(
        ledgerEntriesFor(ledger, 'PUT', draftLedgerPath, helperStartIndex)
      ).toHaveLength(savesBefore)
      await expect(page.locator('[data-save-state]')).toHaveAttribute(
        'data-save-state',
        'dirty'
      )
      await page.clock.runFor(1)
      await expect
        .poll(
          () =>
            ledgerEntriesFor(ledger, 'PUT', draftLedgerPath, helperStartIndex)
              .length
        )
        .toBe(savesBefore + 1)
      const putStartedAt = await page.evaluate(() => Date.now())
      expect(putStartedAt - clockTime).toBe(saveDelayMs)
      if (lastPutStartedAt !== null)
        expect(putStartedAt - lastPutStartedAt).toBeGreaterThanOrEqual(5_000)
      lastPutStartedAt = putStartedAt
    } finally {
      await page.clock.resume()
      await page.clock.setSystemTime(Date.now())
    }
    const [response] = await Promise.all([
      saveResponse,
      waitForSavedDraft(page)
    ])
    expect(response.status()).toBe(200)
    expect(response.fromServiceWorker()).toBe(mode === 'mock')
    expect(response.headers()['x-nihongo-practice-contract']).toBe('2')
    const body = saveStudyDraftAnswersBodySchema.parse(
      response.request().postDataJSON()
    )
    expect(body).toMatchObject({
      expectedRevision: index,
      currentOrdinal: ordinal
    })
    expect(
      body.answers.map(({ studySessionQuestionId }) => studySessionQuestionId)
    ).toEqual(
      created.questions.map(({ sessionQuestionId }) => sessionQuestionId)
    )
    expect(
      body.answers.filter(({ selectedOptionId }) => selectedOptionId !== null)
    ).toHaveLength(ordinal)
    expect(
      body.answers.some(
        ({ selectedOptionId }) =>
          selectedOptionId === item.question.options[0]!.id
      )
    ).toBe(true)
    const saved = saveStudyDraftAnswersResponseSchema.parse(
      await readCanonicalResponse(response)
    )
    expect(saved).toMatchObject({
      studySessionId: created.session.id,
      revision: ordinal,
      currentOrdinal: ordinal
    })
    await expect(firstAnswer).toBeChecked()
    await waitForLedgerToQuiesce(ledger)
  }
}

const openMyPage = async (page: Page): Promise<void> => {
  const accountResponse = waitForApiResponse(
    page,
    'GET',
    '/api/auth/sso/accounts'
  ).then(async (response) => {
    const capabilities = ssoAccountCapabilitiesSchema.parse(
      await readCanonicalResponse(response)
    )
    expect(
      capabilities.providers.some(
        ({ provider, reauthAvailable }) =>
          provider === 'google' && reauthAvailable
      )
    ).toBe(true)
  })
  await page.getByRole('button', { name: '계정 메뉴', exact: true }).click()
  await page.getByRole('menuitem', { name: '마이페이지', exact: true }).click()
  await expect(page).toHaveURL(/\/account$/u)
  await accountResponse
}

const recommendationRegion = (page: Page) =>
  page.getByRole('region', { name: '추천 학습', exact: true })

const myStudyRegion = (page: Page) =>
  page.getByRole('region', { name: '내 학습', exact: true })

const myStudyLoadingCopy = '불러오는 중…'

// On My page a failed stats re-read keeps the last summary without an alert;
// the next successful read refreshes it (JLP-812: My page reads only stats).
const assertFaultRecovery = async (
  page: Page,
  ledger: RequestLedger,
  fault: DashboardFault
): Promise<void> => {
  const path = '/api/v1/dashboard'
  const startIndex = ledger.entries.length
  const failureCount = fault === 'network' ? 2 : fault === 'rate-limit' ? 3 : 1
  // The baseline must be the loaded summary, never the loading copy.
  await expect(myStudyRegion(page)).toBeVisible()
  await expect(myStudyRegion(page)).not.toContainText(myStudyLoadingCopy)
  const summaryBefore = await myStudyRegion(page).innerText()
  const removeFault = await armDashboardFault(page, fault)
  try {
    await invalidateDashboardStats(page)
    await expect
      .poll(() => ledgerEntriesFor(ledger, 'GET', path, startIndex).length, {
        timeout: 20_000
      })
      .toBe(failureCount)
    await waitForLedgerToQuiesce(ledger, startIndex)
    await expect(myStudyRegion(page)).toHaveText(summaryBefore, {
      useInnerText: true
    })
    await expect(page.locator('main [role="alert"]')).toHaveCount(0)
  } finally {
    await removeFault()
  }
  const failedEntries = ledgerEntriesFor(ledger, 'GET', path, startIndex)
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
      expect(response.headers()['x-nihongo-test-fault']).toBeUndefined()
      getDashboardStatsResponseSchema.parse(
        await readCanonicalResponse(response)
      )
    }
  )
  await invalidateDashboardStats(page)
  await recovered
  await expect(myStudyRegion(page)).toBeVisible()
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
): Promise<{
  created: CreateStudySessionV2Response
  originalNow: JSHandle<() => number>
}> => {
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
  await settleJourneyPage(page)
  for (const [label, parameter, value] of [
    ['N5', 'level', 'N5'],
    ['문자·어휘', 'subject', 'VOCABULARY']
  ] as const) {
    // A subject's name also carries its one-line description (B4 ④).
    const radio = page.getByRole('radio', {
      name: new RegExp(`^${label}(?: |$)`, 'u')
    })
    const choice = page.locator('label.choice-option').filter({ has: radio })
    await expect(choice).toHaveCount(1)
    // A default choice (target level, VOCABULARY) stays out of the URL.
    const isDefault =
      (await radio.isChecked()) &&
      new URL(page.url()).searchParams.get(parameter) === null
    await choice.click()
    await expect(radio).toBeChecked()
    await expect(page).toHaveURL(
      (url) => url.searchParams.get(parameter) === (isDefault ? null : value)
    )
  }
  await expect(
    page.locator('input[name="practice-level"][value="N5"]')
  ).toBeChecked()
  await expect(
    page.locator('input[name="practice-subject"][value="VOCABULARY"]')
  ).toBeChecked()
  // A member picks 5, 10 or 20 (B4 §9); each visit starts at 10.
  await expect(page.locator('input[name="practice-count"]')).toHaveCount(3)
  await expect(
    page.locator('input[name="practice-count"][value="10"]')
  ).toBeChecked()
  const studyMode = await openPracticeModes(page)
  await expect(studyMode).toHaveValue('RANDOM')
  const originalNow = await freezePracticeClock(page)
  const initialDraft = page
    .waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        /^\/api\/v1\/study-sessions\/[^/]+\/draft-answers$/u.test(
          new URL(response.url()).pathname
        )
    )
    .then(async (response) =>
      getStudyDraftAnswersResponseSchema.parse(
        await readCanonicalResponse(response)
      )
    )
  const createdResponse = waitForApiResponse(
    page,
    'POST',
    '/api/v1/study-sessions'
  )
  await page
    .getByRole('button', { name: /^N5 문자·어휘 \d+문제 시작$/u })
    .click()
  const response = await createdResponse
  expect(response.status()).toBe(201)
  expect(response.fromServiceWorker()).toBe(mode === 'mock')
  expect(response.headers()['x-nihongo-practice-contract']).toBe('2')
  expect(
    createStudySessionV2BodySchema.parse(response.request().postDataJSON())
  ).toEqual({ level: 'N5', subject: 'VOCABULARY', count: 10, mode: 'RANDOM' })
  const created = createStudySessionV2ResponseSchema.parse(
    await response.json()
  )
  // Asks for 10; the isolated seed may hold fewer N5 vocabulary questions,
  // and the server then gives what it has.
  expect(created.session.actualCount).toBeGreaterThan(0)
  expect(created.session.actualCount).toBeLessThanOrEqual(10)
  expect(created.session).toMatchObject({
    level: 'N5',
    mode: 'RANDOM',
    practiceContractVersion: 2,
    subject: 'VOCABULARY'
  })
  expect(created.questions).toHaveLength(created.session.actualCount)
  await expect(page).toHaveURL(
    new RegExp(`/practice/session/${created.session.id}$`, 'u')
  )
  const draft = await initialDraft
  expect(draft).toMatchObject({
    studySessionId: created.session.id,
    revision: 0,
    currentOrdinal: 1
  })
  expect(draft.answers).toHaveLength(created.session.actualCount)
  expect(
    draft.answers.every(({ selectedOptionId }) => selectedOptionId === null)
  ).toBe(true)
  return { created, originalNow }
}

const submitCurrentSessionThroughUi = async (
  page: Page,
  sessionId: string,
  originalNow: JSHandle<() => number>,
  heading: '결과' | '복습 결과' = '결과'
): Promise<SubmitStudySessionV2Response> => {
  const submittedResponse = waitForApiResponse(
    page,
    'POST',
    `/api/v1/study-sessions/${sessionId}/submission`
  )
  // Every question is answered, so there is no confirm dialog (subtract #9).
  await page.getByRole('button', { name: '제출하기', exact: true }).click()
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
  // A normal result is headed by its score sentence (B4 §11).
  await expect(
    heading === '결과'
      ? page.getByRole('heading', { level: 1, name: /문제 중 .*맞음/u })
      : page.getByRole('heading', { name: heading, exact: true })
  ).toBeVisible()
  // The grading reveal renders with the result (not after a single review).
  if (await page.locator('.grading-reveal').count()) {
    await page.getByRole('button', { name: '결과 보기', exact: true }).click()
    await expect(page.locator('.grading-reveal')).toHaveCount(0)
  }
  await restorePracticeClock(page, originalNow)
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
    page.getByRole('heading', { level: 1, name: '무엇을 풀까요?' })
  ).toBeVisible()
  // A fresh guest gets no rule line here and no tries count in the start
  // button (plan-notes §4); no locks (JLP-823).
  await expect(page.getByText(/로그인 없이 하루/u)).toHaveCount(0)
  await expect(page.getByText(/번 남음/u)).toHaveCount(0)
  await expect(page.locator('select[name="practice-mode"]')).toHaveCount(0)
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
        '로그인 방법이 Google로 바뀌었어요. Google 계정으로 계속해 주세요.',
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
  await expect(recommendationRegion(page)).toHaveCount(0)
  await settleJourneyPage(page)
  const memberStudyMode = await openPracticeModes(page)
  await expect(
    memberStudyMode.locator('option[value="DAILY_REVIEW"]')
  ).toBeEnabled()
  await expect(page.getByText(/^로그인 없이 하루/u)).toHaveCount(0)
  await waitForLedgerToQuiesce(ledger)
  assertCanonicalLedger(ledger)
  await assertAndAttachLedger(
    ledger,
    testInfo,
    `guest-auth-${mode}-request-ledger`
  )
  assertExactRequestMultiset(ledger, [
    ...ssoRequestContract,
    {
      method: 'GET',
      path: '/api/v1/me',
      statuses: successfulStatuses(mode === 'mock' ? 6 : 5)
    },
    { method: 'GET', path: '/api/v1/guest-allowance', statuses: [200] },
    // The first screen shows today's question (D, #801).
    { method: 'GET', path: '/api/v1/daily-question', statuses: [200] },
    // After login the member first screen reads its 'to review' line (JLP-823).
    { method: 'GET', path: '/api/v1/review-list', statuses: [200] },
    { method: 'GET', path: '/api/v1/study-sessions', statuses: [200] }
  ])
})

// The mock does not move guest sessions; the real server does. Registered
// only for real so the mock evidence keeps its exact test count.
if (mode === 'real')
  test('guest result moves to the wrong notes on sign-in (JLP-823 D1)', async ({
    page
  }) => {
    test.setTimeout(120_000)
    await prepareJourney(page, '203.0.113.246')
    await page.goto('/practice')
    await settleJourneyPage(page)
    const created = waitForApiResponse(page, 'POST', '/api/v1/study-sessions')
    await page.locator('main button[type="submit"]:visible').first().click()
    const sessionId = createStudySessionV2ResponseSchema.parse(
      await (await created).json()
    ).session.id
    await expect(page).toHaveURL(
      new RegExp(`/practice/session/${sessionId}`, 'u')
    )
    const answers = page.locator(
      'main input[type="radio"]:not([name^="practice-"])'
    )
    const next = page.locator('main button').filter({ hasText: /^다음$/u })
    for (;;) {
      await answers.first().waitFor({ state: 'attached' })
      await answers.first().check({ force: true })
      if (!((await next.count()) > 0 && (await next.first().isEnabled()))) break
      await next.first().click()
    }
    await page
      .locator('button')
      .filter({ hasText: /^제출하기$/u })
      .locator('visible=true')
      .first()
      .evaluate((button: HTMLButtonElement) => button.click())
    const confirm = page.getByRole('dialog')
    if (await confirm.count())
      await confirm
        .getByRole('button')
        .last()
        .evaluate((button: HTMLButtonElement) => button.click())
    await expect(page).toHaveURL(
      new RegExp(`/practice/result/${sessionId}`, 'u')
    )
    await settleJourneyPage(page)
    await page.goto('/login')
    await settleJourneyPage(page)
    const imported = waitForApiResponse(
      page,
      'POST',
      '/api/v1/me/guest-result-import'
    )
    await loginThroughUi(page)
    const moved = importGuestResultResponseSchema.parse(
      await readCanonicalResponse(await imported)
    )
    expect(moved.importedSessionId).toBe(sessionId)
    // Every first option across a whole set: some are wrong.
    expect(moved.wrongAnswerCount).toBeGreaterThan(0)
    await expect(
      page
        .getByRole('region', { name: '알림' })
        .getByText(
          `방금 푼 틀린 문제 ${moved.wrongAnswerCount}개를 오답노트에 모았어요.`
        )
    ).toBeVisible()
    const reviewList = waitForApiResponse(page, 'GET', '/api/v1/review-list')
    await page.locator('#primary-navigation a[href="/wrong-notes"]').click()
    const listed = (await readCanonicalResponse(await reviewList)) as {
      total: number
    }
    expect(listed.total).toBeGreaterThanOrEqual(moved.wrongAnswerCount)
  })

test('USER completes one setup-to-dashboard journey with an exact mutation ledger', async ({
  context,
  page
}, testInfo) => {
  test.setTimeout(150_000)
  await page.clock.install()
  await prepareJourney(page, '203.0.113.245')
  const ledger = trackRequestLedger(context)
  await page.goto('/login')
  await settleJourneyPage(page)
  await loginThroughUi(page)
  const { created, originalNow } = await startVocabularySessionThroughUi(page)
  await answerEveryQuestionWithFirstOption(page, created, ledger)
  const primarySubmission = await submitCurrentSessionThroughUi(
    page,
    created.session.id,
    originalNow
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

  await waitForLedgerToQuiesce(ledger)
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
    page.getByRole('heading', { level: 1, name: /문제 중 .*맞음/u })
  ).toBeVisible()
  const chooseLocale = async (value: 'ko' | 'ja'): Promise<void> => {
    await page.locator('#account-menu-button').click()
    await page.locator(`[role="menuitemradio"][lang="${value}"]`).click()
    await page.keyboard.press('Escape')
    await expect(page.locator('html')).toHaveAttribute('lang', value)
  }
  await chooseLocale('ja')
  await expect(
    page.getByRole('heading', { level: 1, name: /問中 .*問正解/u })
  ).toBeVisible()
  await chooseLocale('ko')

  // The result screen keeps two buttons only (subtract table 10), so open
  // the review list in-app (no reload).
  await page.evaluate(() => {
    window.history.pushState(null, '', '/wrong-notes')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect(page).toHaveURL(
    (url) => url.pathname === '/wrong-notes' && url.search === ''
  )
  await expect(page.getByRole('tab', { selected: true })).toHaveCount(1)
  await expect(page.getByRole('combobox')).toHaveCount(0)
  await expect(page.locator('#review-panel ol > li')).toHaveCount(3)
  const returnTo = new URL(page.url()).pathname + new URL(page.url()).search
  const detail = page.locator(
    `#review-panel a[href^="/wrong-notes/${incorrect.question.id}?"]`
  )
  await expect(detail).toHaveCount(1)
  await detail.click()
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === `/wrong-notes/${incorrect.question.id}` &&
      url.searchParams.get('returnTo') === returnTo
  )
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: incorrect.question.questionText,
      exact: true
    })
  ).toBeVisible()

  const targetedInitialDraft = page
    .waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        /^\/api\/v1\/study-sessions\/[^/]+\/draft-answers$/u.test(
          new URL(response.url()).pathname
        )
    )
    .then(async (response) =>
      getStudyDraftAnswersResponseSchema.parse(
        await readCanonicalResponse(response)
      )
    )
  const targetedResponsePromise = waitForApiResponse(
    page,
    'POST',
    `/api/v1/wrong-notes/${incorrect.question.id}/review-session`
  )
  await page
    .getByRole('button', { name: '이 문제 다시 풀기', exact: true })
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
  const targetedDraft = await targetedInitialDraft
  expect(targetedDraft).toMatchObject({
    studySessionId: targeted.session.id,
    revision: 0,
    currentOrdinal: 1
  })
  expect(targetedDraft.answers).toHaveLength(1)
  expect(targetedDraft.answers[0]?.selectedOptionId).toBeNull()
  const targetedOriginalNow = await freezePracticeClock(page)
  await answerEveryQuestionWithFirstOption(page, targeted, ledger)
  const completionState = waitForApiResponse(
    page,
    'GET',
    `/api/v1/wrong-notes/${incorrect.question.id}`
  ).then(async (response) =>
    getWrongNoteResponseSchema.parse(await readCanonicalResponse(response))
  )
  const targetedSubmission = await submitCurrentSessionThroughUi(
    page,
    targeted.session.id,
    targetedOriginalNow,
    '복습 결과'
  )
  expect(targetedSubmission).toMatchObject({
    correctCount: 0,
    incorrectCount: 1,
    totalCount: 1
  })
  await expect(
    page.getByRole('heading', { name: '아쉽게 틀렸어요.', exact: true })
  ).toBeVisible()
  const completed = await completionState
  expect(completed.wrongNote).toMatchObject({
    questionId: incorrect.question.id,
    status: 'AGAIN',
    wrongCount: 2
  })
  await expect(page.locator('.review-feedback p')).toHaveText(
    "아직 '복습할 문제'에 있어요. 해설을 읽고 다시 풀어 봐요."
  )
  await expect(page.locator('.review-current-status')).toHaveText(
    '오답노트복습할 문제'
  )

  const dashboardStartIndex = ledger.entries.length
  await page.getByRole('link', { name: '복습 목록으로', exact: true }).click()
  await expect(page).toHaveURL((url) => url.pathname + url.search === returnTo)
  const finalStatsResponse = waitForApiResponse(
    page,
    'GET',
    '/api/v1/dashboard'
  ).then(async (response) =>
    getDashboardStatsResponseSchema.parse(await readCanonicalResponse(response))
  )
  const home = page.locator('header .app-brand[href="/"]')
  await expect(home).toHaveCount(1)
  await expect(home).toBeVisible()
  await home.click()
  await expect(page).toHaveURL(/\/dashboard\?view=learning$/u)
  await openMyPage(page)
  const finalStats = await finalStatsResponse
  expect(finalStats.totalAnsweredCount).toBe(6)
  await expect(myStudyRegion(page)).toBeVisible()
  await expect(recommendationRegion(page)).toHaveCount(0)
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
  // The review page no longer reads the summary (JLP-812); My page reads it once.
  expect(dashboardSummaryEntries).toHaveLength(1)
  for (const entry of dashboardSummaryEntries) {
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
    `user-journey-${mode}-request-ledger`
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
  const initialStats = waitForApiResponse(page, 'GET', '/api/v1/dashboard')
  await openMyPage(page)
  getDashboardStatsResponseSchema.parse(
    await readCanonicalResponse(await initialStats)
  )
  await expect(myStudyRegion(page)).toBeVisible()
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
    `resilience-${mode}-request-ledger`
  )
  assertExactRequestMultiset(ledger, resilienceRequestContract)
})
