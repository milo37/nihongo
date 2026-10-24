import { expect, test } from '@playwright/test'
import { z } from 'zod'
import { getCurrentPrincipalResponseSchema } from '@nihongo/contracts/auth/get-current-principal'
import {
  isSsoAuthorizationURLForProvider,
  signInSocialResponseSchema
} from '@nihongo/contracts/auth/sign-in-social'
import { getDashboardInsightsResponseSchema } from '@nihongo/contracts/dashboard/get-dashboard-insights'
import { getDashboardStatsResponseSchema } from '@nihongo/contracts/dashboard/get-dashboard-stats'
import {
  createStudySessionV2BodySchema,
  createStudySessionV2ResponseSchema
} from '@nihongo/contracts/study/create-study-session'
import type { BrowserContext, Page, Request, Response } from '@playwright/test'
import {
  assertAndAttachLedger,
  assertExactRequestMultiset,
  selectRequestLedger,
  trackRequestLedger,
  waitForLedgerToQuiesce,
  waitForLedgerToSettle
} from './phase10-request-ledger'
import type { RequestLedger } from './phase10-request-ledger'

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

const canonicalDashboardPaths = [
  '/api/v1/dashboard',
  '/api/v1/dashboard/insights'
] as const

const browserPerformanceBaselineP95Milliseconds = {
  mock: 952.266,
  real: 875.085
} as const satisfies Readonly<Record<BrowserMode, number>>
const browserPerformanceRatioLimit = 8
const browserPerformanceAbsoluteCeilingMilliseconds = 10_000
const browserPerformanceSampleCount = 20

const subjectLabels = {
  VOCABULARY: '문자·어휘',
  GRAMMAR: '문법',
  READING: '독해'
} as const

const parseBrowserMode = (): BrowserMode => {
  const mode = process.env.PHASE8_BROWSER_MODE
  if (mode !== 'mock' && mode !== 'real') {
    throw new Error('PHASE8_BROWSER_MODE must be mock or real.')
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
    callbackCode: z.literal('phase7-test-google-insightsLearner')
  })
  .strict()

const login = async (page: Page): Promise<void> => {
  // Public TEST callback metadata is parsed only at execution, never fabricated for collection.
  const actor = isMockBrowser
    ? undefined
    : z
        .object({ insightsLearner: insightsActorSchema })
        .parse(
          JSON.parse(process.env.PHASE8_BROWSER_FIXTURE ?? 'null') as unknown
        ).insightsLearner
  await page.goto('/login')
  await expect(page.getByRole('button', { name: /Google/u })).toBeVisible()
  await expect(page.locator('input[name="password"]')).toHaveCount(0)
  if (isMockBrowser) {
    await page.evaluate(async () => {
      const path = '/src/test/phase10BrowserMockControl.ts'
      const control = (await import(/* @vite-ignore */ path)) as {
        selectPhase78MockGoogleActor: (actor: 'insightsLearner') => void
      }
      control.selectPhase78MockGoogleActor('insightsLearner')
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
      const path = '/src/test/phase10BrowserMockControl.ts'
      const control = (await import(/* @vite-ignore */ path)) as {
        completePhase78MockGoogleCallback: (
          actor: 'insightsLearner'
        ) => Promise<void>
      }
      await control.completePhase78MockGoogleCallback('insightsLearner')
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
    { method: 'GET', path: '/api/v1/dashboard', statuses: [200] },
    { method: 'GET', path: '/api/v1/dashboard/insights', statuses: [200] }
  ])
  const expectedProvenance = isMockBrowser
    ? 'canonical-mock-service-worker'
    : 'canonical-real-network'
  expect(ledger.entries.map(({ provenance }) => provenance)).toEqual([
    expectedProvenance,
    expectedProvenance
  ])
  expect(ledger.entries.map(({ path }) => path)).toEqual(
    canonicalDashboardPaths
  )
  const [stats, insights] = ledger.entries
  expect(stats!.finishSequence).not.toBeNull()
  expect(stats!.finishSequence!).toBeLessThan(insights!.startSequence)
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
    },
    {
      method: 'GET',
      path: '/api/v1/dashboard/insights',
      statuses: Array.from({ length: triggerCount }, () => 200)
    }
  ])
  for (let index = 0; index < triggerCount; index += 1) {
    assertCanonicalDashboardLedger({
      entries: ledger.entries.slice(index * 2, index * 2 + 2)
    })
  }
}

const openDashboardSections = async (
  page: Page,
  ledger: RequestLedger
): Promise<z.infer<typeof getDashboardInsightsResponseSchema>> => {
  const wrongNotesStartIndex = ledger.entries.length
  await page.goto('/wrong-notes')
  const recentResults = page
    .locator('summary')
    .filter({ hasText: /^최근 결과 다시 보기$/u })
  await expect(recentResults).toBeVisible()
  await expect(recentResults.locator('..')).toHaveJSProperty('open', false)
  const dashboardResponsePromise = waitForResponse(
    page,
    'GET',
    '/api/v1/dashboard'
  )
  await recentResults.click()
  const dashboardResponse = await dashboardResponsePromise
  expect(dashboardResponse.status()).toBe(200)
  expect(dashboardResponse.headers()['cache-control']).toBe('private, no-store')
  expectExpectedApiTransport(dashboardResponse)
  const stats = getDashboardStatsResponseSchema.parse(
    JSON.parse(await dashboardResponse.text()) as unknown
  )
  expect(stats.recentStudySessions).toEqual([])
  await expect(recentResults.locator('..')).toHaveJSProperty('open', true)
  await expect(
    page.getByText('아직 마친 학습이 없어요.', { exact: true })
  ).toBeVisible()

  // Empty review queues also load history independently of the stats response.
  await waitForLedgerToQuiesce(ledger, wrongNotesStartIndex)

  // Insights mount on the learning route before its native disclosure is opened.
  const insightsResponsePromise = waitForResponse(
    page,
    'GET',
    '/api/v1/dashboard/insights'
  )
  await page.goto('/dashboard?view=learning')
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === '/dashboard' &&
      url.searchParams.get('view') === 'learning'
  )
  const insightsResponse = await insightsResponsePromise
  expect(insightsResponse.status()).toBe(200)
  expect(insightsResponse.headers()['cache-control']).toBe('private, no-store')
  expectExpectedApiTransport(insightsResponse)
  const insights = getDashboardInsightsResponseSchema.parse(
    JSON.parse(await insightsResponse.text()) as unknown
  )
  const recommendations = page
    .locator('summary')
    .filter({ hasText: /^학습 추천 더 보기$/u })
  await expect(recommendations).toBeVisible()
  await expect(recommendations.locator('..')).toHaveJSProperty('open', false)
  await recommendations.click()
  await expect(recommendations.locator('..')).toHaveJSProperty('open', true)
  await expect(
    page.getByRole('heading', {
      exact: true,
      name: '목표 급수의 다음 문제를 풀어보세요'
    })
  ).toBeVisible()
  return insights
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
    .toBe(2)
  const measuredLedger = selectCanonicalDashboardLedger(ledger, startIndex)
  await waitForLedgerToSettle(measuredLedger)
  assertCanonicalDashboardLedger(measuredLedger)
  return roundMilliseconds(performance.now() - startedAt)
}

test('current stats and learning routes preserve contracts before an explicit recommendation action', async ({
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
  const insights = await openDashboardSections(page, ledger)

  await expect
    .poll(
      () =>
        selectCanonicalDashboardLedger(ledger, initialDashboardStartIndex)
          .entries.length
    )
    .toBe(2)
  const initialDashboardLedger = selectCanonicalDashboardLedger(
    ledger,
    initialDashboardStartIndex
  )
  await waitForLedgerToSettle(initialDashboardLedger)
  assertCanonicalDashboardLedger(initialDashboardLedger)
  expect(legacyDashboardRequestCount).toBe(0)

  expect(insights.personalizationFallbackReason).toBe(
    'NO_PERSONALIZED_EVIDENCE'
  )
  expect(insights.recommendations).toEqual([
    {
      action: {
        count: 5,
        kind: 'START_SESSION',
        level: 'N2',
        mode: 'RANDOM',
        subject: 'VOCABULARY'
      },
      kind: 'TARGET_LEVEL_PRACTICE',
      rank: 1,
      reason: {
        catalogCount: 5,
        code: 'TARGET_LEVEL_RECENT_GAP',
        lastStudiedAt: null,
        level: 'N2',
        nonRecentCount: 5,
        subject: 'VOCABULARY'
      }
    }
  ])
  const recommendation = insights.recommendations.find(
    ({ kind }) => kind === 'TARGET_LEVEL_PRACTICE'
  )
  if (!recommendation) {
    throw new Error(
      'Fresh Phase 8 learner target-level recommendation is missing.'
    )
  }
  if (recommendation.reason.code !== 'TARGET_LEVEL_RECENT_GAP') {
    throw new Error('Target-level recommendation must explain the recent gap.')
  }
  const { action } = recommendation
  expect(action.kind).toBe('START_SESSION')
  if (action.kind !== 'START_SESSION') {
    throw new Error('Target-level recommendation action must start a session.')
  }

  await expect(
    page.getByRole('heading', {
      exact: true,
      name: '목표 급수의 다음 문제를 풀어보세요'
    })
  ).toBeVisible()
  await expect(
    page.getByText(
      '개인화 근거가 아직 충분하지 않아 목표 급수의 일반 연습을 함께 추천합니다.'
    )
  ).toBeVisible()
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
    `phase8-dashboard-${browserMode}-request-ledger`
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
  await testInfo.attach(`phase8-dashboard-${browserMode}-performance`, {
    body: JSON.stringify(
      {
        schemaVersion: 1,
        kind: 'nihongo.phase10.browser-performance',
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

  const actionSummary = `일반 연습 · ${action.level} ${subjectLabels[action.subject]} · ${action.count}문제`
  const actionButton = page.getByRole('button', {
    exact: true,
    name: '일반 연습 시작하기'
  })
  await expect(page.getByText(actionSummary, { exact: true })).toBeVisible()
  await expect(actionButton).toBeVisible()
  expect(sessionPostRequests).toHaveLength(0)

  const sessionResponsePromise = waitForResponse(
    page,
    'POST',
    '/api/v1/study-sessions'
  )
  await actionButton.focus()
  await expect(actionButton).toBeFocused()
  await page.keyboard.press('Enter')
  const sessionResponse = await sessionResponsePromise
  const sessionRequest = sessionResponse.request()

  expect(sessionPostRequests).toHaveLength(1)
  expect(sessionRequest).toBe(sessionPostRequests[0])
  expect(sessionRequest.headers()['x-nihongo-practice-contract']).toBe('2')
  expect(
    createStudySessionV2BodySchema.parse(sessionRequest.postDataJSON())
  ).toEqual({
    count: action.count,
    level: action.level,
    mode: action.mode,
    subject: action.subject
  })
  expect(sessionResponse.status()).toBe(201)
  expect(sessionResponse.headers()['x-nihongo-practice-contract']).toBe('2')
  expectExpectedApiTransport(sessionResponse)

  const created = createStudySessionV2ResponseSchema.parse(
    JSON.parse(await sessionResponse.text()) as unknown
  )
  expect(created.session).toMatchObject({
    actualCount: expect.any(Number),
    fallbackReason: null,
    level: action.level,
    mode: action.mode,
    practiceContractVersion: 2,
    requestedCount: action.count,
    subject: action.subject,
    usedFallback: false
  })
  expect(created.session.actualCount).toBeGreaterThan(0)
  expect(created.session.actualCount).toBe(
    Math.min(action.count, recommendation.reason.catalogCount)
  )
  expect(created.questions).toHaveLength(created.session.actualCount)
  await expect(page).toHaveURL((url) => {
    return url.pathname === `/practice/session/${created.session.id}`
  })

  expect(legacyDashboardRequestCount).toBe(0)
  expect(sessionPostRequests).toHaveLength(1)
  expect(transport.unexpectedResponses).toEqual([])
  expect(transport.failedRequests).toEqual([])
})
