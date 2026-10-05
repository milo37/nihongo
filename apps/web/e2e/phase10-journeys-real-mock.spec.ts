import { expect, test } from '@playwright/test'
import {
  createStudySessionV2ResponseSchema,
  type CreateStudySessionV2Response
} from '@nihongo/contracts/study/create-study-session'
import {
  submitStudySessionV2ResponseSchema,
  type SubmitStudySessionV2Response
} from '@nihongo/contracts/study/submit-study-session'
import type { BrowserContext, Page, Route } from '@playwright/test'
import {
  assertAndAttachLedger,
  assertExactRequestMultiset,
  ledgerEntriesFor,
  trackRequestLedger,
  waitForLedgerToQuiesce
} from './phase10-request-ledger'
import type {
  RequestLedger,
  RequestLedgerEntry,
  RequestLedgerContractEntry
} from './phase10-request-ledger'

type DashboardFault = 'malformed' | 'network' | 'rate-limit'

interface Credentials {
  readonly email: string
  readonly name: string
  readonly password: string
}

interface RealBrowserFixture {
  readonly journeyLearner: Credentials
  readonly learner: Credentials
}

interface RegistrationCredentials extends Credentials {
  readonly targetLevel: 'N4'
}

const browserMode = process.env.PHASE10_BROWSER_MODE
if (browserMode !== 'mock' && browserMode !== 'real') {
  throw new Error('PHASE10_BROWSER_MODE must be mock or real.')
}
const isMockBrowser = browserMode === 'mock'

const demoLearner = {
  email: 'user@example.com',
  name: '데모 학습자',
  password: 'Demo-user-2026!'
} as const satisfies Credentials

const parseJsonEnvironment = <Value>(
  name: string,
  required: boolean
): Value | undefined => {
  const serialized = process.env[name]
  if (!serialized) {
    if (required) throw new Error(`${name} is required.`)
    return undefined
  }
  return JSON.parse(serialized) as Value
}

const realFixture = parseJsonEnvironment<RealBrowserFixture>(
  'PHASE10_BROWSER_FIXTURE',
  !isMockBrowser
)
const registration = parseJsonEnvironment<RegistrationCredentials>(
  'PHASE10_REGISTRATION_FIXTURE',
  !isMockBrowser
)
const learner = realFixture?.learner ?? demoLearner
const journeyLearner = realFixture?.journeyLearner ?? demoLearner

const successfulStatuses = (count: number): readonly number[] =>
  Array.from({ length: count }, () => 200)

const userJourneyRequestContract = [
  { method: 'GET', path: '/api/v1/bookmarks', statuses: successfulStatuses(3) },
  { method: 'GET', path: '/api/v1/dashboard', statuses: [200] },
  { method: 'GET', path: '/api/v1/dashboard/insights', statuses: [200] },
  { method: 'GET', path: '/api/v1/me', statuses: successfulStatuses(5) },
  {
    method: 'GET',
    path: '/api/v1/review-queue',
    statuses: successfulStatuses(2)
  },
  { method: 'GET', path: '/api/v1/study-sessions', statuses: [200] },
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
  { method: 'GET', path: '/api/v1/wrong-notes/:id', statuses: [200] },
  { method: 'GET', path: '/api/v1/wrong-notes/:id/memo', statuses: [200] },
  {
    method: 'GET',
    path: '/api/v1/wrong-notes/:id/review-events',
    statuses: [200]
  },
  { method: 'POST', path: '/api/auth/sign-in/email', statuses: [200] },
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
  { method: 'GET', path: '/api/v1/dashboard', statuses: [200] },
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
  },
  { method: 'GET', path: '/api/v1/me', statuses: successfulStatuses(4) },
  { method: 'GET', path: '/api/v1/study-sessions', statuses: [200] },
  { method: 'POST', path: '/api/auth/sign-in/email', statuses: [200] }
] as const satisfies readonly RequestLedgerContractEntry[]

const setRealClientAddress = async (
  page: Page,
  address: string
): Promise<void> => {
  if (isMockBrowser) return
  await page.context().setExtraHTTPHeaders({ 'X-Forwarded-For': address })
}

const login = async (
  page: Page,
  ledger: RequestLedger,
  credentials: Credentials,
  address: string
): Promise<void> => {
  await setRealClientAddress(page, address)
  const loginStartIndex = ledger.entries.length
  await page.goto('/login')
  const form = page.locator('form').filter({
    has: page.locator('input[name="password"]')
  })
  await form.getByLabel('이메일').fill(credentials.email)
  await form.getByLabel('비밀번호').fill(credentials.password)
  await Promise.all([
    page.waitForURL((url) => url.pathname === '/', { timeout: 15_000 }),
    form.getByRole('button', { exact: true, name: '로그인' }).click()
  ])
  await expect(
    page.getByRole('link', { exact: true, name: credentials.name })
  ).toBeVisible()
  await waitForLedgerToQuiesce(ledger, loginStartIndex)
}

const navigateToDeliveredVerification = async (
  context: BrowserContext,
  page: Page
): Promise<void> => {
  const controlUrl = process.env.PHASE10_BROWSER_CONTROL_URL
  const controlSecret = process.env.PHASE10_BROWSER_CONTROL_SECRET
  if (!controlUrl || !controlSecret) {
    throw new Error('Phase 10 browser email control is unavailable.')
  }

  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const response = await fetch(`${controlUrl}/verification-ready`, {
      headers: { Authorization: `Bearer ${controlSecret}` },
      signal: AbortSignal.timeout(2_000)
    })
    if (response.status === 404) {
      await response.body?.cancel().catch(() => undefined)
      await new Promise((resolve) => setTimeout(resolve, 100))
      continue
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error('Phase 10 browser email control request failed.')
    }
    await response.body?.cancel().catch(() => undefined)
    const parsedControlUrl = new URL(controlUrl)
    if (
      parsedControlUrl.protocol !== 'http:' ||
      parsedControlUrl.hostname !== '127.0.0.1'
    ) {
      throw new Error('Phase 10 browser email control origin is unsafe.')
    }
    await context.addCookies([
      {
        domain: parsedControlUrl.hostname,
        httpOnly: true,
        name: 'phase10_control',
        path: '/verification-navigation',
        sameSite: 'Strict',
        secure: false,
        value: controlSecret
      }
    ])
    await page.goto(`${controlUrl}/verification-navigation`)
    return
  }
  throw new Error('Phase 10 browser verification email timed out.')
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

const armDashboardFault = async (
  page: Page,
  fault: DashboardFault
): Promise<() => Promise<void>> => {
  if (isMockBrowser) {
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

const assertFaultRecovery = async (
  page: Page,
  ledger: RequestLedger,
  fault: DashboardFault
): Promise<void> => {
  const path = '/api/v1/dashboard/insights'
  const startIndex = ledger.entries.length
  const removeFault = await armDashboardFault(page, fault)
  await invalidateDashboardInsights(page)
  await expect(
    page.getByRole('heading', {
      exact: true,
      name: '최신 인사이트로 갱신하지 못했습니다'
    })
  ).toBeVisible({ timeout: 15_000 })
  await removeFault()

  const successfulRetry = page.waitForResponse((response) => {
    const request = response.request()
    return (
      response.status() === 200 &&
      request.method() === 'GET' &&
      new URL(response.url()).pathname === path &&
      response.headers()['x-phase10-test-fault'] === undefined
    )
  })
  await page.getByRole('button', { name: /인사이트 다시 시도$/u }).click()
  await successfulRetry
  await expect(
    page.getByRole('heading', {
      exact: true,
      name: '최신 인사이트로 갱신하지 못했습니다'
    })
  ).toBeHidden()

  await expect
    .poll(() => ledgerEntriesFor(ledger, 'GET', path, startIndex).length)
    .toBe(fault === 'network' ? 3 : fault === 'rate-limit' ? 4 : 2)
  const entries = ledgerEntriesFor(ledger, 'GET', path, startIndex)
  const expectedStatuses =
    fault === 'network'
      ? ['NETWORK_ERROR', 'NETWORK_ERROR', 200]
      : fault === 'rate-limit'
        ? [429, 429, 429, 200]
        : [200, 200]
  expect(entries.map(({ status }) => status)).toEqual(expectedStatuses)
  expect(entries.at(-1)?.provenance).toBe(
    isMockBrowser ? 'canonical-mock-service-worker' : 'canonical-real-network'
  )
  if (fault !== 'network') {
    expect(entries[0]?.provenance).toBe('injected-test-fault')
  }
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

const startVocabularySessionThroughUi = async (
  page: Page
): Promise<CreateStudySessionV2Response> => {
  const bootstrapResponse = page.waitForResponse((response) => {
    const request = response.request()
    return (
      request.method() === 'GET' &&
      new URL(response.url()).pathname === '/api/v1/me'
    )
  })
  await page.goto('/practice')
  expect((await bootstrapResponse).status()).toBe(200)
  await page.getByRole('button', { exact: true, name: 'N5' }).click()
  await page.getByRole('button', { exact: true, name: '문자·어휘' }).click()
  await page.getByRole('button', { exact: true, name: '5문제' }).click()
  await page.getByRole('button', { name: /^랜덤 문제/u }).click()
  await freezePracticeClock(page)
  const responsePromise = page.waitForResponse((response) => {
    const request = response.request()
    return (
      request.method() === 'POST' &&
      new URL(response.url()).pathname === '/api/v1/study-sessions'
    )
  })
  await page.getByRole('button', { exact: true, name: 'N5 어휘 시작' }).click()
  const response = await responsePromise
  expect(response.status()).toBe(201)
  const created = createStudySessionV2ResponseSchema.parse(
    JSON.parse(await response.text()) as unknown
  )
  expect(created.session).toMatchObject({
    actualCount: 5,
    level: 'N5',
    mode: 'RANDOM',
    practiceContractVersion: 2,
    subject: 'VOCABULARY'
  })
  await expect(page).toHaveURL(
    new RegExp(`/practice/session/${created.session.id}$`, 'u')
  )
  return created
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

const submitCurrentSessionThroughUi = async (
  page: Page,
  sessionId: string
): Promise<SubmitStudySessionV2Response> => {
  const responsePromise = page.waitForResponse((response) => {
    const request = response.request()
    return (
      request.method() === 'POST' &&
      new URL(response.url()).pathname ===
        `/api/v1/study-sessions/${sessionId}/submission`
    )
  })
  await page.getByRole('button', { exact: true, name: '답안 제출' }).click()
  const dialog = page.getByRole('dialog', {
    name: '답안을 제출하시겠습니까?'
  })
  await expect(dialog).toBeVisible()
  await dialog
    .getByRole('button', { exact: true, name: '제출하고 결과 보기' })
    .click()
  const response = await responsePromise
  expect(response.status()).toBe(201)
  const submitted = submitStudySessionV2ResponseSchema.parse(
    JSON.parse(await response.text()) as unknown
  )
  await expect(page).toHaveURL(
    new RegExp(`/practice/result/${sessionId}$`, 'u')
  )
  await expect(
    page.getByRole('heading', { exact: true, name: '학습 결과' })
  ).toBeVisible()
  await restorePracticeClock(page)
  return submitted
}

const expectDashboardMetric = async (
  page: Page,
  label: string,
  value: string
): Promise<void> => {
  const metric = page.locator('dl > div').filter({
    has: page.getByText(label, { exact: true })
  })
  await expect(metric).toHaveCount(1)
  await expect(metric.locator('dd')).toContainText(value)
}

test('guest registration boundary and authenticated practice transition match the active mode', async ({
  context,
  page
}, testInfo) => {
  test.setTimeout(90_000)
  const ledger = trackRequestLedger(context)
  await page.goto('/practice')
  await expect(
    page.getByText('현재 역할: 게스트', { exact: true })
  ).toBeVisible()

  if (isMockBrowser) {
    await page.goto('/login?mode=signup')
    await expect
      .poll(() => new URL(page.url()).searchParams.get('mode'))
      .toBeNull()
    await expect(
      page.getByRole('button', { exact: true, name: '회원가입' })
    ).toBeDisabled()
    await expect(
      page.getByText(
        '회원가입·이메일 인증·비밀번호 재설정은 VITE_API_MODE=real인 실제 API 모드에서 확인해 주세요.',
        { exact: true }
      )
    ).toBeVisible()
    expect(
      ledgerEntriesFor(ledger, 'POST', '/api/auth/sign-up/email')
    ).toHaveLength(0)

    await page.goto('/verify-email#token=mock-browser-token')
    const unsupportedResponse = page.waitForResponse((response) => {
      const request = response.request()
      return (
        request.method() === 'POST' &&
        new URL(response.url()).pathname === '/api/auth/verify-email'
      )
    })
    await page
      .getByRole('button', { exact: true, name: '이메일 인증하기' })
      .click()
    expect((await unsupportedResponse).status()).toBe(501)
    await expect(
      page.getByText(
        'Mock 모드에서는 이메일 인증을 지원하지 않습니다. real API 모드에서 다시 시도해 주세요.',
        { exact: true }
      )
    ).toBeVisible()
    await login(page, ledger, learner, '203.0.113.243')
  } else {
    if (!registration) {
      throw new Error('Phase 10 registration fixture is missing.')
    }
    await setRealClientAddress(page, '203.0.113.242')
    await page.goto('/login?mode=signup')
    const form = page.locator('form').filter({
      has: page.locator('input[name="name"]')
    })
    await form.getByLabel('이름').fill(registration.name)
    await form.getByLabel('이메일').fill(registration.email)
    await form.getByLabel('비밀번호').fill(registration.password)
    await form.getByLabel('목표 급수').selectOption(registration.targetLevel)
    const signUpResponse = page.waitForResponse((response) => {
      const request = response.request()
      return (
        request.method() === 'POST' &&
        new URL(response.url()).pathname === '/api/auth/sign-up/email'
      )
    })
    await form
      .getByRole('button', { exact: true, name: '이메일 인증 요청' })
      .click()
    expect((await signUpResponse).status()).toBe(200)
    await expect(
      page.getByText(
        '가입 요청을 완료했습니다. 받은 편지함에서 이메일 인증을 마친 뒤 로그인해 주세요.',
        { exact: true }
      )
    ).toBeVisible()

    await navigateToDeliveredVerification(context, page)
    await expect.poll(() => new URL(page.url()).hash === '').toBe(true)
    const verificationResponse = page.waitForResponse((response) => {
      const request = response.request()
      return (
        request.method() === 'POST' &&
        new URL(response.url()).pathname === '/api/auth/verify-email'
      )
    })
    await page
      .getByRole('button', { exact: true, name: '이메일 인증하기' })
      .click()
    expect((await verificationResponse).status()).toBe(200)
    await expect(
      page.getByRole('heading', {
        exact: true,
        name: '이메일 인증을 완료했습니다'
      })
    ).toBeFocused()
    await page
      .locator('#main-content')
      .getByRole('link', { exact: true, name: '로그인' })
      .click()
    await login(page, ledger, registration, '203.0.113.242')

    expect(
      ledgerEntriesFor(ledger, 'POST', '/api/auth/sign-up/email')
    ).toHaveLength(1)
    expect(
      ledgerEntriesFor(ledger, 'POST', '/api/auth/verify-email')
    ).toHaveLength(1)
  }

  await page.goto('/practice')
  await expect(
    page.getByText('현재 역할: 학습자', { exact: true })
  ).toBeVisible()
  await waitForLedgerToQuiesce(ledger)
  assertExactRequestMultiset(ledger, [
    { method: 'GET', path: '/api/v1/me', statuses: successfulStatuses(7) },
    { method: 'GET', path: '/api/v1/study-sessions', statuses: [200] },
    { method: 'POST', path: '/api/auth/sign-in/email', statuses: [200] },
    ...(!isMockBrowser
      ? ([
          {
            method: 'POST',
            path: '/api/auth/sign-up/email',
            statuses: [200]
          }
        ] as const)
      : []),
    {
      method: 'POST',
      path: '/api/auth/verify-email',
      statuses: [isMockBrowser ? 501 : 200]
    }
  ])
  await assertAndAttachLedger(
    ledger,
    testInfo,
    `phase10-guest-auth-${browserMode}-request-ledger`
  )
})

test('USER completes one setup-to-dashboard journey with an exact mutation ledger', async ({
  context,
  page
}, testInfo) => {
  test.setTimeout(150_000)
  const ledger = trackRequestLedger(context)
  await login(page, ledger, journeyLearner, '203.0.113.245')

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

  await page.reload()
  await expect(
    page.getByRole('heading', { exact: true, name: '학습 결과' })
  ).toBeVisible()
  await page.locator('select[name="ui-locale"]').first().selectOption('ja')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
  await expect(
    page.getByRole('heading', { exact: true, name: '学習結果' })
  ).toBeVisible()
  await page.locator('select[name="ui-locale"]').first().selectOption('ko')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko')

  await page.getByRole('link', { exact: true, name: '오답노트 보기' }).click()
  await expect(page).toHaveURL(/\/wrong-notes(?:\?.*)?$/u)
  await expect(
    page.getByRole('heading', { exact: true, name: '오답 복습' })
  ).toBeVisible()
  const unreviewedView = page.getByRole('button', {
    name: /^아직 복습 전\s*3$/u
  })
  await expect(unreviewedView).toBeVisible()
  await unreviewedView.click()
  await expect(unreviewedView).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.getByRole('heading', { name: '조건에 맞는 오답 3개' })
  ).toBeVisible()
  await page
    .getByRole('link', { exact: true, name: '상세·메모·복습 기록' })
    .first()
    .click()
  await expect(
    page.getByRole('heading', { exact: true, name: '마지막 오답 문제 상세' })
  ).toBeVisible()

  const targetedResponsePromise = page.waitForResponse((response) => {
    const request = response.request()
    return (
      request.method() === 'POST' &&
      /^\/api\/v1\/wrong-notes\/[0-9a-f-]+\/review-session$/u.test(
        new URL(response.url()).pathname
      )
    )
  })
  await page
    .getByRole('button', { exact: true, name: '이 문제만 다시 풀기' })
    .click()
  const targetedResponse = await targetedResponsePromise
  expect(targetedResponse.status()).toBe(201)
  const targeted = createStudySessionV2ResponseSchema.parse(
    JSON.parse(await targetedResponse.text()) as unknown
  )
  expect(targeted.session).toMatchObject({
    actualCount: 1,
    mode: 'WRONG_NOTE',
    practiceContractVersion: 2
  })
  await expect(page).toHaveURL(
    new RegExp(`/practice/session/${targeted.session.id}$`, 'u')
  )
  await freezePracticeClock(page)
  await answerEveryQuestionWithFirstOption(page, 1)
  const targetedSubmission = await submitCurrentSessionThroughUi(
    page,
    targeted.session.id
  )
  expect(targetedSubmission).toMatchObject({
    correctCount: 0,
    incorrectCount: 1,
    totalCount: 1
  })

  const dashboardStartIndex = ledger.entries.length
  await page
    .getByRole('navigation', { name: '주요 메뉴' })
    .getByRole('link', { exact: true, name: '대시보드' })
    .click()
  await expect(
    page.getByRole('heading', { exact: true, name: '학습 흐름을 확인하세요' })
  ).toBeVisible()
  await expectDashboardMetric(page, '전체 풀이', '6문제')
  await expectDashboardMetric(page, '누적 오답', '3개')
  await waitForLedgerToQuiesce(ledger)

  const signInEntries = ledgerEntriesFor(
    ledger,
    'POST',
    '/api/auth/sign-in/email'
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
  const firstDashboardFinish = Math.min(
    requireFinished(dashboardSummaryEntries[0]),
    requireFinished(dashboardInsightEntries[0])
  )
  expect(dashboardSummaryEntries[0]?.startSequence).toBeLessThan(
    firstDashboardFinish
  )
  expect(dashboardInsightEntries[0]?.startSequence).toBeLessThan(
    firstDashboardFinish
  )
  expect(requireFinished(submissionEntries[1])).toBeLessThan(
    Math.min(
      dashboardSummaryEntries[0]?.startSequence ?? -1,
      dashboardInsightEntries[0]?.startSequence ?? -1
    )
  )

  expect(
    ledger.entries.some(({ path }) =>
      /^\/api\/(?:study\/session|dashboard\/stats|wrong-note)/u.test(path)
    )
  ).toBe(false)
  expect(
    ledger.entries.every(
      ({ provenance, status }) =>
        status !== 'NETWORK_ERROR' &&
        provenance ===
          (isMockBrowser
            ? 'canonical-mock-service-worker'
            : 'canonical-real-network')
    )
  ).toBe(true)
  assertExactRequestMultiset(ledger, userJourneyRequestContract)
  await assertAndAttachLedger(
    ledger,
    testInfo,
    `phase10-user-journey-${browserMode}-request-ledger`
  )
})

test('network, rate-limit, and malformed responses require explicit recovery without duplicate requests', async ({
  context,
  page
}, testInfo) => {
  test.setTimeout(120_000)
  const ledger = trackRequestLedger(context)
  await login(page, ledger, learner, '203.0.113.244')
  await expect(page).toHaveURL(/\/dashboard\?view=learning$/u)
  const landingReads = ledgerEntriesFor(ledger, 'GET', '/api/v1/study-sessions')
  expect(landingReads).toHaveLength(1)
  expect(landingReads[0]).toMatchObject({
    provenance: isMockBrowser
      ? 'canonical-mock-service-worker'
      : 'canonical-real-network',
    status: 200
  })
  expect(landingReads[0]?.finishSequence).toBeGreaterThan(
    landingReads[0]?.startSequence ?? -1
  )
  const signInRequests = ledgerEntriesFor(
    ledger,
    'POST',
    '/api/auth/sign-in/email'
  )
  expect(signInRequests).toHaveLength(1)
  expect(landingReads[0]?.startSequence).toBeGreaterThan(
    signInRequests[0]?.finishSequence ?? -1
  )
  await page.goto('/dashboard')
  await expect(
    page.getByRole('heading', { exact: true, name: '약점과 다음 학습 추천' })
  ).toBeVisible()

  for (const fault of [
    'network',
    'rate-limit',
    'malformed'
  ] as const satisfies readonly DashboardFault[]) {
    await assertFaultRecovery(page, ledger, fault)
  }

  await waitForLedgerToQuiesce(ledger)
  assertExactRequestMultiset(ledger, resilienceRequestContract)
  await assertAndAttachLedger(
    ledger,
    testInfo,
    `phase10-resilience-${browserMode}-request-ledger`
  )
})
