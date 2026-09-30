import { expect, test } from '@playwright/test'
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

interface Credentials {
  readonly email: string
  readonly name: string
  readonly password: string
}

interface RealCredentials extends Credentials {
  readonly userId: string
}

interface RealBrowserFixture {
  readonly insightsLearner: RealCredentials
}

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

const parseRealBrowserFixture = (): RealBrowserFixture | undefined => {
  if (isMockBrowser) return undefined
  const serialized = process.env.PHASE8_BROWSER_FIXTURE
  if (!serialized) throw new Error('Real Phase 8 browser fixture is missing.')
  const fixture = JSON.parse(serialized) as RealBrowserFixture
  const credentials = fixture.insightsLearner
  if (
    !credentials ||
    [
      credentials.email,
      credentials.name,
      credentials.password,
      credentials.userId
    ].some((value) => typeof value !== 'string' || value.length === 0)
  ) {
    throw new Error('Real Phase 8 browser fixture is invalid.')
  }
  return fixture
}

const demoLearner = {
  email: 'user@example.com',
  name: '데모 학습자',
  password: 'Demo-user-2026!'
} as const satisfies Credentials

const learner = parseRealBrowserFixture()?.insightsLearner ?? demoLearner

const login = async (page: Page, credentials: Credentials): Promise<void> => {
  if (!isMockBrowser) {
    await page.context().setExtraHTTPHeaders({
      'X-Forwarded-For': '203.0.113.240'
    })
  }
  await page.goto('/login')
  const form = page.locator('form').filter({ has: page.getByLabel('이메일') })
  await form.getByLabel('이메일').fill(credentials.email)
  await form.getByLabel('비밀번호').fill(credentials.password)
  await Promise.all([
    page.waitForURL((url) => url.pathname === '/', { timeout: 15_000 }),
    form.getByRole('button', { exact: true, name: '로그인' }).click()
  ])
  await expect(
    page.getByRole('link', { exact: true, name: credentials.name })
  ).toBeVisible()
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
  const startSequences = ledger.entries.map(({ startSequence }) =>
    Number(startSequence)
  )
  const finishSequences = ledger.entries.map(({ finishSequence }) =>
    Number(finishSequence)
  )
  expect(Math.max(...startSequences)).toBeLessThan(Math.min(...finishSequences))
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

const measureDashboardNavigation = async (
  page: Page,
  ledger: RequestLedger
): Promise<number> => {
  const startIndex = ledger.entries.length
  const startedAt = performance.now()
  await page.goto('/dashboard')
  await expect(
    page.getByRole('heading', {
      exact: true,
      name: '학습 흐름을 확인하세요'
    })
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { exact: true, name: '약점과 다음 학습 추천' })
  ).toBeVisible()
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

test('dashboard reads overlap in real and mock mode before an explicit recommendation action', async ({
  context,
  page
}, testInfo) => {
  test.setTimeout(90_000)
  const transport = trackApiTransport(context)
  const ledger = trackRequestLedger(context)
  await login(page, learner)

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

  const initialDashboardStartIndex = ledger.entries.length
  const dashboardResponsePromise = waitForResponse(
    page,
    'GET',
    '/api/v1/dashboard'
  )
  const insightsResponsePromise = waitForResponse(
    page,
    'GET',
    '/api/v1/dashboard/insights'
  )
  await page.goto('/dashboard')
  const [dashboardResponse, insightsResponse] = await Promise.all([
    dashboardResponsePromise,
    insightsResponsePromise
  ])

  expect(dashboardResponse.status()).toBe(200)
  expect(insightsResponse.status()).toBe(200)
  expect(dashboardResponse.headers()['cache-control']).toBe('private, no-store')
  expect(insightsResponse.headers()['cache-control']).toBe('private, no-store')
  expectExpectedApiTransport(dashboardResponse)
  expectExpectedApiTransport(insightsResponse)

  getDashboardStatsResponseSchema.parse(
    JSON.parse(await dashboardResponse.text()) as unknown
  )
  const insights = getDashboardInsightsResponseSchema.parse(
    JSON.parse(await insightsResponse.text()) as unknown
  )

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
  const { action } = recommendation
  expect(action.kind).toBe('START_SESSION')
  if (action.kind !== 'START_SESSION') {
    throw new Error('Target-level recommendation action must start a session.')
  }

  await expect(
    page.getByRole('heading', { exact: true, name: '약점과 다음 학습 추천' })
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
    name: `일반 연습 시작하기: ${actionSummary}`
  })
  await expect(actionButton).toBeVisible()

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
  expect(transport.unexpectedResponses).toEqual([])
  expect(transport.failedRequests).toEqual([])
})
