import { expect, test } from '@playwright/test'
import { z } from 'zod'
import { getCurrentPrincipalResponseSchema } from '@nihongo/contracts/auth/get-current-principal'
import {
  isSsoAuthorizationURLForProvider,
  signInSocialResponseSchema
} from '@nihongo/contracts/auth/sign-in-social'
import { getDashboardStatsResponseSchema } from '@nihongo/contracts/dashboard/get-dashboard-stats'
import type { BrowserContext, Page, Request, Response } from '@playwright/test'
import {
  assertAndAttachLedger,
  assertExactRequestMultiset,
  selectRequestLedger,
  trackRequestLedger,
  waitForLedgerToQuiesce,
  waitForLedgerToSettle
} from './request-ledger'
import type { RequestLedger } from './request-ledger'

type BrowserMode = 'mock' | 'real'

interface ApiTransportEvidence {
  readonly failedRequests: string[]
  readonly unexpectedResponses: string[]
}

interface TimingStatistics {
  readonly max: number
  readonly median: number
  readonly min: number
  readonly p95: number
}

// My page reads only the all-time stats (JLP-812).
const canonicalDashboardPaths = ['/api/v1/dashboard'] as const

const browserPerformanceBaselineP95Milliseconds = {
  mock: 952.266,
  real: 875.085
} as const satisfies Readonly<Record<BrowserMode, number>>
const browserPerformanceRatioLimit = 8
const browserPerformanceAbsoluteCeilingMilliseconds = 10_000
const browserPerformanceSampleCount = 20

const parseBrowserMode = (): BrowserMode => {
  const mode = process.env.DASHBOARD_BROWSER_MODE
  if (mode !== 'mock' && mode !== 'real') {
    throw new Error('DASHBOARD_BROWSER_MODE must be mock or real.')
  }
  return mode
}

const browserMode = parseBrowserMode()
const isMockBrowser = browserMode === 'mock'

const insightsActorSchema = z
  .object({
    userId: z.string().uuid(),
    role: z.literal('USER'),
    targetLevel: z.literal('N2'),
    callbackCode: z.literal('test-google-insightsLearner')
  })
  .strict()

const login = async (page: Page): Promise<void> => {
  // Public TEST callback metadata is parsed only at execution, never fabricated for collection.
  const actor = isMockBrowser
    ? undefined
    : z
        .object({ insightsLearner: insightsActorSchema })
        .parse(
          JSON.parse(process.env.DASHBOARD_BROWSER_FIXTURE ?? 'null') as unknown
        ).insightsLearner
  await page.goto('/login')
  await expect(page.getByRole('button', { name: /Google/u })).toBeVisible()
  await expect(page.locator('input[name="password"]')).toHaveCount(0)
  if (isMockBrowser) {
    await page.evaluate(async () => {
      const path = '/src/test/journeyBrowserMockControl.ts'
      const control = (await import(/* @vite-ignore */ path)) as {
        selectMockGoogleActor: (actor: 'insightsLearner') => void
      }
      control.selectMockGoogleActor('insightsLearner')
    })
  }
  const started = await page.evaluate(async () => {
    const response = await fetch('/api/auth/sign-in/social', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'google', callbackURL: '/practice' })
    })
    return { status: response.status, body: (await response.json()) as unknown }
  })
  expect(started.status).toBe(200)
  const authorization = signInSocialResponseSchema.parse(started.body)
  expect(isSsoAuthorizationURLForProvider('google', authorization.url)).toBe(
    true
  )
  if (isMockBrowser) {
    await page.evaluate(async () => {
      const path = '/src/test/journeyBrowserMockControl.ts'
      const control = (await import(/* @vite-ignore */ path)) as {
        completeMockGoogleActorCallback: (
          actor: 'insightsLearner'
        ) => Promise<void>
      }
      await control.completeMockGoogleActorCallback('insightsLearner')
    })
  } else {
    if (!actor) throw new Error('Real insights actor is required.')
    const state = new URL(authorization.url).searchParams.get('state')
    if (!state) throw new Error('Google TEST authorization omitted state.')
    // Enter only the installed TEST provider callback; follow the canonical server return.
    await page.goto(
      `/api/auth/callback/google?${new URLSearchParams({ state, code: actor.callbackCode })}`
    )
    await expect(page).toHaveURL((url) => url.pathname === '/practice')
  }
  const confirmed = await page.evaluate(async () => {
    const response = await fetch('/api/v1/me', { credentials: 'include' })
    return { status: response.status, body: (await response.json()) as unknown }
  })
  expect(confirmed.status).toBe(200)
  const principal = getCurrentPrincipalResponseSchema.parse(confirmed.body)
  if (principal.kind !== 'USER')
    throw new Error('Insights learner was not confirmed.')
  expect(principal.user.role).toBe('USER')
  expect(principal.user.targetLevel).toBe('N2')
  if (actor) expect(principal.user.id).toBe(actor.userId)
  await page.goto('/practice')
}

const waitForResponse = (
  page: Page,
  method: 'GET' | 'POST',
  pathname: string
): Promise<Response> =>
  page.waitForResponse((response) => {
    const request = response.request()
    return (
      request.method() === method &&
      new URL(response.url()).pathname === pathname
    )
  })

const trackApiTransport = (context: BrowserContext): ApiTransportEvidence => {
  const evidence: ApiTransportEvidence = {
    failedRequests: [],
    unexpectedResponses: []
  }
  context.on('response', (response) => {
    const pathname = new URL(response.url()).pathname
    const isUnexpected = isMockBrowser
      ? !response.fromServiceWorker()
      : response.fromServiceWorker()
    if (pathname.startsWith('/api/') && isUnexpected) {
      evidence.unexpectedResponses.push(
        `${response.request().method()} ${pathname}`
      )
    }
  })
  context.on('requestfailed', (request) => {
    const pathname = new URL(request.url()).pathname
    if (pathname.startsWith('/api/')) {
      evidence.failedRequests.push(
        `${request.method()} ${pathname}: ${request.failure()?.errorText ?? 'unknown failure'}`
      )
    }
  })
  return evidence
}

const expectExpectedApiTransport = (response: Response): void => {
  expect(response.fromServiceWorker()).toBe(isMockBrowser)
}

const roundMilliseconds = (value: number): number =>
  Math.round(value * 1_000) / 1_000

const calculateTimingStatistics = (
  samples: readonly number[]
): TimingStatistics => {
  expect(samples).toHaveLength(browserPerformanceSampleCount)
  const sorted = samples.toSorted((left, right) => left - right)
  return {
    max: sorted.at(-1)!,
    median: roundMilliseconds((sorted[9]! + sorted[10]!) / 2),
    min: sorted[0]!,
    p95: sorted[18]!
  }
}

const selectCanonicalDashboardLedger = (
  ledger: RequestLedger,
  startIndex: number,
  endIndex = ledger.entries.length
): RequestLedger =>
  selectRequestLedger(
    ledger,
    ({ method, path }) =>
      method === 'GET' &&
      canonicalDashboardPaths.includes(
        path as (typeof canonicalDashboardPaths)[number]
      ),
    startIndex,
    endIndex
  )

const assertCanonicalDashboardLedger = (ledger: RequestLedger): void => {
  assertExactRequestMultiset(ledger, [
    { method: 'GET', path: '/api/v1/dashboard', statuses: [200] }
  ])
  const expectedProvenance = isMockBrowser
    ? 'canonical-mock-service-worker'
    : 'canonical-real-network'
  expect(ledger.entries.map(({ provenance }) => provenance)).toEqual([
    expectedProvenance
  ])
  expect(ledger.entries.map(({ path }) => path)).toEqual(
    canonicalDashboardPaths
  )
  expect(ledger.entries[0]!.finishSequence).not.toBeNull()
}

const assertCanonicalDashboardAggregate = (
  ledger: RequestLedger,
  triggerCount: number
): void => {
  assertExactRequestMultiset(ledger, [
    {
      method: 'GET',
      path: '/api/v1/dashboard',
      statuses: Array.from({ length: triggerCount }, () => 200)
    }
  ])
  for (let index = 0; index < triggerCount; index += 1) {
    assertCanonicalDashboardLedger({
      entries: ledger.entries.slice(index, index + 1)
    })
  }
}

// The account page loads only the all-time stats; it has no recommendations.
const openDashboardSections = async (
  page: Page,
  ledger: RequestLedger
): Promise<void> => {
  const startIndex = ledger.entries.length
  const statsResponsePromise = waitForResponse(page, 'GET', '/api/v1/dashboard')
  await page.goto('/account')
  await expect(page).toHaveURL((url) => url.pathname === '/account')
  const statsResponse = await statsResponsePromise
  expect(statsResponse.status()).toBe(200)
  expect(statsResponse.headers()['cache-control']).toBe('private, no-store')
  expectExpectedApiTransport(statsResponse)
  const stats = getDashboardStatsResponseSchema.parse(
    JSON.parse(await statsResponse.text()) as unknown
  )
  expect(stats.totalAnsweredCount).toBe(0)
  await expect(
    page.getByText('아직 푼 문제가 없어요', { exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole('region', { name: '추천 학습', exact: true })
  ).toHaveCount(0)
  await waitForLedgerToQuiesce(ledger, startIndex)
}

const measureDashboardNavigation = async (
  page: Page,
  ledger: RequestLedger
): Promise<number> => {
  const startIndex = ledger.entries.length
  const startedAt = performance.now()
  await openDashboardSections(page, ledger)
  await expect
    .poll(
      () => selectCanonicalDashboardLedger(ledger, startIndex).entries.length
    )
    .toBe(1)
  const measuredLedger = selectCanonicalDashboardLedger(ledger, startIndex)
  await waitForLedgerToSettle(measuredLedger)
  assertCanonicalDashboardLedger(measuredLedger)
  return roundMilliseconds(performance.now() - startedAt)
}

test('current stats and learning routes preserve contracts without dashboard insights reads', async ({
  context,
  page
}, testInfo) => {
  test.setTimeout(90_000)
  const transport = trackApiTransport(context)
  const ledger = trackRequestLedger(context)

  const sessionPostRequests: Request[] = []
  let legacyDashboardRequestCount = 0

  context.on('request', (request) => {
    const pathname = new URL(request.url()).pathname
    if (pathname.endsWith('/dashboard/stats')) {
      legacyDashboardRequestCount += 1
    }
    if (request.method() === 'POST' && pathname === '/api/v1/study-sessions') {
      sessionPostRequests.push(request)
    }
  })

  await login(page)

  const initialDashboardStartIndex = ledger.entries.length
  await openDashboardSections(page, ledger)

  await expect
    .poll(
      () =>
        selectCanonicalDashboardLedger(ledger, initialDashboardStartIndex)
          .entries.length
    )
    .toBe(1)
  const initialDashboardLedger = selectCanonicalDashboardLedger(
    ledger,
    initialDashboardStartIndex
  )
  await waitForLedgerToSettle(initialDashboardLedger)
  assertCanonicalDashboardLedger(initialDashboardLedger)
  expect(legacyDashboardRequestCount).toBe(0)

  expect(sessionPostRequests).toHaveLength(0)

  const performanceSamples: number[] = []
  for (let index = 0; index < browserPerformanceSampleCount; index += 1) {
    performanceSamples.push(await measureDashboardNavigation(page, ledger))
  }
  await waitForLedgerToQuiesce(ledger, initialDashboardStartIndex)
  const dashboardAggregateLedger = selectCanonicalDashboardLedger(
    ledger,
    initialDashboardStartIndex
  )
  assertCanonicalDashboardAggregate(
    dashboardAggregateLedger,
    browserPerformanceSampleCount + 1
  )
  await assertAndAttachLedger(
    dashboardAggregateLedger,
    testInfo,
    `dashboard-${browserMode}-request-ledger`
  )
  const statisticsMs = calculateTimingStatistics(performanceSamples)
  const baselineP95Milliseconds =
    browserPerformanceBaselineP95Milliseconds[browserMode]
  const observedToBaselineRatio = roundMilliseconds(
    statisticsMs.p95 / baselineP95Milliseconds
  )
  const ratioCeilingMilliseconds = roundMilliseconds(
    baselineP95Milliseconds * browserPerformanceRatioLimit
  )
  const effectiveCeilingMilliseconds = Math.min(
    ratioCeilingMilliseconds,
    browserPerformanceAbsoluteCeilingMilliseconds
  )
  const passed =
    statisticsMs.p95 <= ratioCeilingMilliseconds &&
    statisticsMs.p95 <= browserPerformanceAbsoluteCeilingMilliseconds
  await testInfo.attach(`dashboard-${browserMode}-performance`, {
    body: JSON.stringify(
      {
        schemaVersion: 1,
        kind: 'nihongo.browser-performance',
        surface: 'dashboard-navigation',
        mode: browserMode,
        warmupCount: 1,
        sampleCount: browserPerformanceSampleCount,
        samplesMs: performanceSamples,
        statisticsMs,
        budget: {
          absoluteCeilingMilliseconds:
            browserPerformanceAbsoluteCeilingMilliseconds,
          baselineP95Milliseconds,
          effectiveCeilingMilliseconds,
          observedToBaselineRatio,
          passed,
          ratioCeilingMilliseconds,
          ratioLimit: browserPerformanceRatioLimit
        }
      },
      null,
      2
    ),
    contentType: 'application/json'
  })
  expect(statisticsMs.p95).toBeLessThanOrEqual(ratioCeilingMilliseconds)
  expect(statisticsMs.p95).toBeLessThanOrEqual(
    browserPerformanceAbsoluteCeilingMilliseconds
  )
  expect(passed).toBe(true)
  expect(legacyDashboardRequestCount).toBe(0)

  expect(legacyDashboardRequestCount).toBe(0)
  // My page offers no session start, so no session is created here.
  expect(sessionPostRequests).toHaveLength(0)
  expect(transport.unexpectedResponses).toEqual([])
  expect(transport.failedRequests).toEqual([])
})
