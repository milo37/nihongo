import { expect, test } from '@playwright/test'
import {
  adminQuestionExportDocumentV1Schema,
  createAdminQuestionResponseSchema,
  createQuestionReportResponseSchema,
  createAdminQuestionVersionResponseSchema,
  getAdminQuestionReportResponseSchema,
  getAdminQuestionResponseSchema,
  listAdminQuestionsResponseSchema,
  validateQuestionImportRequestSchema
} from '@nihongo/contracts/admin/phase7'
import { createStudySessionV2ResponseSchema } from '@nihongo/contracts/study/create-study-session'
import type { BrowserContext, Page, Response, Route } from '@playwright/test'
import { DEMO_USER_ID } from '@mocks/data/users'
import {
  assertAndAttachLedger,
  selectRequestLedger,
  trackRequestLedger,
  waitForLedgerSelectionToQuiesce
} from './phase10-request-ledger'
import type { RequestLedgerEntry } from './phase10-request-ledger'

interface Credentials {
  readonly email: string
  readonly name: string
  readonly password: string
}

interface RealCredentials extends Credentials {
  readonly userId: string
}

interface RealBrowserFixture {
  readonly author: RealCredentials
  readonly learner: RealCredentials
  readonly reviewer: RealCredentials
}

interface RequestEvidence {
  readonly method: string
  readonly pathname: string
}

interface ApiTransportEvidence {
  readonly unexpectedResponses: RequestEvidence[]
  readonly failedRequests: string[]
}

type OperationMethod = 'GET' | 'PATCH' | 'POST'

interface BrowserJsonRequestInput {
  readonly body?: unknown
  readonly headers?: Readonly<Record<string, string>>
  readonly method: 'POST'
  readonly pathname: string
}

interface BrowserJsonResponse {
  readonly bodyText: string
  readonly status: number
}

const browserMode = process.env.PHASE7_BROWSER_MODE === 'real' ? 'real' : 'mock'
const isMockBrowser = browserMode === 'mock'
const isPhase8Acceptance = process.env.PHASE8_BROWSER_ACCEPTANCE === '1'

const armAdminUpdateRaceBarrier = async (
  context: BrowserContext,
  page: Page,
  versionId: string
): Promise<() => Promise<void>> => {
  if (isMockBrowser) {
    await page.evaluate(async (targetVersionId) => {
      const modulePath = '/src/test/phase10BrowserMockControl.ts'
      const control = (await import(/* @vite-ignore */ modulePath)) as {
        armPhase10AdminUpdateRaceBarrier: (value: string) => void
      }
      control.armPhase10AdminUpdateRaceBarrier(targetVersionId)
    }, versionId)
    return async () => {
      await page.evaluate(async () => {
        const modulePath = '/src/test/phase10BrowserMockControl.ts'
        const control = (await import(/* @vite-ignore */ modulePath)) as {
          disarmPhase10AdminUpdateRaceBarrier: () => void
        }
        control.disarmPhase10AdminUpdateRaceBarrier()
      })
    }
  }

  const pattern = `**/api/v1/admin/question-versions/${versionId}`
  let requestCount = 0
  let releaseBarrier = (): void => undefined
  const barrier = new Promise<void>((resolve) => {
    releaseBarrier = resolve
  })
  const timeout = setTimeout(releaseBarrier, 10_000)
  const handler = async (route: Route): Promise<void> => {
    if (route.request().method() !== 'PATCH') {
      await route.continue()
      return
    }
    requestCount += 1
    if (requestCount === 2) {
      clearTimeout(timeout)
      releaseBarrier()
    }
    await barrier
    if (requestCount < 2) {
      throw new Error('Phase 10 real ADMIN race barrier timed out.')
    }
    await route.continue()
  }
  await context.route(pattern, handler)
  return async () => {
    clearTimeout(timeout)
    releaseBarrier()
    await context.unroute(pattern, handler)
  }
}

const parseRealBrowserFixture = (): RealBrowserFixture | undefined => {
  if (browserMode !== 'real') return undefined
  const serialized = process.env.PHASE7_BROWSER_FIXTURE
  if (!serialized) throw new Error('Real Phase 7 browser fixture is missing.')
  const fixture = JSON.parse(serialized) as RealBrowserFixture
  for (const credentials of [
    fixture.author,
    fixture.learner,
    fixture.reviewer
  ]) {
    if (
      !credentials ||
      [
        credentials.email,
        credentials.name,
        credentials.password,
        credentials.userId
      ].some((value) => typeof value !== 'string' || value.length === 0)
    ) {
      throw new Error('Real Phase 7 browser fixture is invalid.')
    }
  }
  return fixture
}

const realFixture = parseRealBrowserFixture()

const realScenarioByContext = new WeakMap<BrowserContext, number>()
let nextRealScenario = 0

test.beforeEach(async ({ context }) => {
  if (isMockBrowser) return
  nextRealScenario += 1
  realScenarioByContext.set(context, nextRealScenario)
})

const trackApiTransport = (page: Page): ApiTransportEvidence => {
  const evidence: ApiTransportEvidence = {
    unexpectedResponses: [],
    failedRequests: []
  }
  page.context().on('response', (response) => {
    const pathname = new URL(response.url()).pathname
    const isUnexpected = isMockBrowser
      ? !response.fromServiceWorker()
      : response.fromServiceWorker()
    if (pathname.startsWith('/api/') && isUnexpected) {
      evidence.unexpectedResponses.push({
        method: response.request().method(),
        pathname
      })
    }
  })
  page.context().on('requestfailed', (request) => {
    const pathname = new URL(request.url()).pathname
    if (pathname.startsWith('/api/')) {
      evidence.failedRequests.push(
        `${request.method()} ${pathname}: ${request.failure()?.errorText ?? 'unknown failure'}`
      )
    }
  })
  return evidence
}

const demoAdmin = {
  email: 'admin@example.com',
  name: '데모 관리자',
  password: 'Demo-admin-2026!'
} as const satisfies Credentials

const demoReviewer = {
  email: 'reviewer@example.com',
  name: '데모 검수 관리자',
  password: 'Demo-reviewer-2026!'
} as const satisfies Credentials

const demoUser = {
  email: 'user@example.com',
  name: '데모 학습자',
  password: 'Demo-user-2026!'
} as const satisfies Credentials

const author = realFixture?.author ?? demoAdmin
const reviewer = realFixture?.reviewer ?? demoReviewer
const learner = realFixture?.learner ?? demoUser

const expectExpectedApiTransport = (response: Response): void => {
  expect(response.fromServiceWorker()).toBe(isMockBrowser)
}

const ageRealAuthorSession = async (): Promise<void> => {
  if (isMockBrowser) return
  const controlUrl = process.env.PHASE7_BROWSER_CONTROL_URL
  const controlSecret = process.env.PHASE7_BROWSER_CONTROL_SECRET
  if (!controlUrl || !controlSecret || !realFixture) {
    throw new Error('Real Phase 7 browser control endpoint is unavailable.')
  }
  const response = await fetch(`${controlUrl}/age-fresh-assurance`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${controlSecret}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ userId: realFixture.author.userId })
  })
  if (!response.ok) {
    throw new Error(
      `Real Phase 7 fresh-assurance aging failed with ${response.status}.`
    )
  }
}

const importedQuestionText = '週末は 図書館（　）日本語を 勉強します。'

const importRequest = validateQuestionImportRequestSchema.parse({
  items: [
    {
      clientItemId: 'slice6-browser-import-001',
      content: {
        level: 'N5',
        subject: 'GRAMMAR',
        questionType: 'GRAMMAR_SELECT',
        difficulty: 'EASY',
        questionText: importedQuestionText,
        passage: null,
        explanationKo: '행동이 이루어지는 장소에는 조사 「で」를 사용합니다.',
        explanationJa: null,
        tagNames: ['조사'],
        options: [
          { clientOptionKey: 'option-1', text: 'で' },
          { clientOptionKey: 'option-2', text: 'を' },
          { clientOptionKey: 'option-3', text: 'に' },
          { clientOptionKey: 'option-4', text: 'が' }
        ],
        correctOptionKey: 'option-1'
      }
    }
  ]
})

const invalidImportRequest = validateQuestionImportRequestSchema.parse({
  items: [
    {
      clientItemId: 'slice6-browser-invalid-import-001',
      content: {
        ...importRequest.items[0]!.content,
        questionText: '朝は 駅の 前で 友だちを 待つ（　）しました。',
        tagNames: ['존재하지 않는 태그']
      }
    }
  ]
})

const login = async (page: Page, credentials: Credentials): Promise<void> => {
  if (!isMockBrowser) {
    const scenario = realScenarioByContext.get(page.context())
    if (!scenario) {
      throw new Error('Real Phase 7 browser client namespace is missing.')
    }
    const actorOffset =
      credentials.email === author.email
        ? 1
        : credentials.email === reviewer.email
          ? 2
          : 3
    await page.context().setExtraHTTPHeaders({
      'X-Forwarded-For': `198.51.100.${scenario * 3 + actorOffset}`
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

const waitForOperation = (
  page: Page,
  method: OperationMethod,
  pathname: string
): Promise<Response> =>
  page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.request().method() === method && url.pathname === pathname
  })

const waitForQuestionList = (
  page: Page,
  expectedLevel: string | null
): Promise<Response> =>
  page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      response.request().method() === 'GET' &&
      url.pathname === '/api/v1/admin/questions' &&
      url.searchParams.get('level') === expectedLevel
    )
  })

const requestBrowserJson = async (
  page: Page,
  input: BrowserJsonRequestInput
): Promise<BrowserJsonResponse> =>
  await page.evaluate(async (requestInput) => {
    const response = await fetch(requestInput.pathname, {
      body:
        requestInput.body === undefined
          ? undefined
          : JSON.stringify(requestInput.body),
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...requestInput.headers
      },
      method: requestInput.method
    })
    return { bodyText: await response.text(), status: response.status }
  }, input)

const primeMockControlledPage = async (page: Page): Promise<void> => {
  if (!isMockBrowser) return

  await page.goto('/mockServiceWorker.js')
  const hasMockController = async (): Promise<boolean> =>
    await page.evaluate(() => {
      const controller = navigator.serviceWorker.controller
      return (
        controller !== null &&
        new URL(controller.scriptURL).pathname === '/mockServiceWorker.js'
      )
    })

  if (!(await hasMockController())) {
    await page.reload()
  }
  await expect.poll(hasMockController).toBe(true)
}

const switchAccount = async (
  page: Page,
  credentials: Credentials
): Promise<void> => {
  await page.goto('/login')
  const logoutButton = page.getByRole('button', {
    exact: true,
    name: '로그아웃'
  })
  await expect(logoutButton).toBeVisible()
  const signOutResponsePromise = waitForOperation(
    page,
    'POST',
    '/api/auth/sign-out'
  )
  await logoutButton.click()
  const signOutResponse = await signOutResponsePromise
  expect(signOutResponse.status()).toBe(200)
  await expect(page.getByText('현재 계정', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('이메일')).toBeVisible()
  await login(page, credentials)
}

const runQuestionCommand = async (
  page: Page,
  label: string,
  pathname: string,
  note?: string
): Promise<Response> => {
  const responsePromise = waitForOperation(page, 'POST', pathname)
  await page.getByRole('button', { exact: true, name: label }).click()
  await expect(
    page.getByRole('heading', { exact: true, name: `${label} 확인` })
  ).toBeVisible()
  if (note !== undefined) {
    await page.getByLabel('사유', { exact: true }).fill(note)
  }
  await page
    .getByRole('button', { exact: true, name: '명시적으로 실행' })
    .click()
  return await responsePromise
}

test('guest and USER cannot enter the ADMIN CMS', async ({ page }) => {
  const transport = trackApiTransport(page)
  await page.goto('/admin/questions')
  await expect(page).toHaveURL(/\/login\?redirect=%2Fadmin%2Fquestions$/u)

  await login(page, learner)
  await page.goto('/admin/questions')
  await expect(page).toHaveURL(/\/forbidden$/u)
  await expect(
    page.getByRole('heading', { name: '이 페이지를 볼 권한이 없습니다' })
  ).toBeVisible()
  await page.waitForLoadState('networkidle')
  expect(transport.unexpectedResponses).toEqual([])
  expect(transport.failedRequests).toEqual([])
})

test('ADMIN completes the canonical lifecycle, fresh assurance, and conflict flow', async ({
  page
}, testInfo) => {
  test.setTimeout(150_000)
  const transport = trackApiTransport(page)
  const phase8Ledger = isPhase8Acceptance
    ? trackRequestLedger(page.context())
    : undefined
  const apiRequests: RequestEvidence[] = []
  page.context().on('request', (request) => {
    const pathname = new URL(request.url()).pathname
    if (pathname.startsWith('/api/')) {
      apiRequests.push({ method: request.method(), pathname })
    }
  })

  const initialTime = new Date('2026-09-28T00:00:00.000Z')
  if (isMockBrowser) await page.clock.setFixedTime(initialTime)
  await login(page, author)

  await expect
    .poll(
      async () =>
        await page.evaluate(async () => {
          const registrations = await navigator.serviceWorker.getRegistrations()
          return registrations.some(
            (registration) =>
              registration.active !== null &&
              new URL(registration.active.scriptURL).pathname ===
                '/mockServiceWorker.js'
          )
        })
    )
    .toBe(isMockBrowser)

  const initialListResponsePromise = waitForQuestionList(page, null)
  await page
    .getByRole('navigation', { name: '주요 메뉴' })
    .getByRole('link', { exact: true, name: '문제 관리' })
    .click()
  const initialListResponse = await initialListResponsePromise
  const initialList = listAdminQuestionsResponseSchema.parse(
    await initialListResponse.json()
  )
  expect(initialListResponse.status()).toBe(200)
  expectExpectedApiTransport(initialListResponse)
  expect(initialList.total).toBeGreaterThan(0)
  await expect(
    page.getByRole('heading', { level: 1, name: '문제 관리' })
  ).toBeVisible()
  const publishedRow = page
    .getByRole('row')
    .filter({ has: page.getByText('공개', { exact: true }) })
    .first()
  const publishedCheckbox = publishedRow.getByRole('checkbox')
  await expect(publishedCheckbox).toBeEnabled()
  await publishedCheckbox.check()
  await expect(
    page.getByRole('button', { exact: true, name: '선택 항목 검수 요청' })
  ).toBeDisabled()
  await expect(
    page.getByRole('button', { exact: true, name: '민감 자료 내보내기' })
  ).toBeEnabled()
  await publishedCheckbox.uncheck()

  const filteredResponsePromise = waitForQuestionList(page, 'N5')
  await page.getByLabel('급수', { exact: true }).selectOption('N5')
  const filteredResponse = await filteredResponsePromise
  const filteredList = listAdminQuestionsResponseSchema.parse(
    await filteredResponse.json()
  )
  expect(filteredResponse.status()).toBe(200)
  expect(filteredList.items.length).toBeGreaterThan(0)
  expect(filteredList.items.every((item) => item.level === 'N5')).toBe(true)
  expect(filteredList.total).toBeLessThan(initialList.total)
  await expect(page).toHaveURL(/level=N5/u)

  await page.goBack()
  await expect(page.getByLabel('급수', { exact: true })).toHaveValue('')
  const backResponsePromise = waitForQuestionList(page, null)
  await page.reload()
  const backResponse = await backResponsePromise
  expect(backResponse.status()).toBe(200)
  expectExpectedApiTransport(backResponse)
  await expect(page.locator('#admin-question-results tbody tr')).toHaveCount(
    Math.min(initialList.total, initialList.pageSize)
  )

  await page.goForward()
  await expect(page.getByLabel('급수', { exact: true })).toHaveValue('N5')
  const forwardResponsePromise = waitForQuestionList(page, 'N5')
  await page.reload()
  const forwardResponse = await forwardResponsePromise
  expect(forwardResponse.status()).toBe(200)
  expectExpectedApiTransport(forwardResponse)
  const filteredLevelCells = page.locator(
    '#admin-question-results tbody tr > td:nth-child(3)'
  )
  await expect(filteredLevelCells).toHaveText(
    filteredList.items.map(() => /N5 ·/u)
  )

  const reloadResponsePromise = waitForQuestionList(page, 'N5')
  await page.reload()
  const reloadResponse = await reloadResponsePromise
  expect(reloadResponse.status()).toBe(200)
  expectExpectedApiTransport(reloadResponse)
  await expect(filteredLevelCells).toHaveText(
    filteredList.items.map(() => /N5 ·/u)
  )
  await expect(page.getByLabel('급수', { exact: true })).toHaveValue('N5')

  const sortSelect = page.getByRole('combobox', {
    exact: true,
    name: '정렬'
  })
  const sortedHeaders = {
    CREATED_DESC: page.getByRole('columnheader', { name: '생성일' }),
    LEVEL_ASC: page.getByRole('columnheader', { name: '분류' }),
    REPORT_COUNT_DESC: page.getByRole('columnheader', { name: '신고' }),
    UPDATED_DESC: page.getByRole('columnheader', { name: '수정일' })
  } as const
  await expect(sortedHeaders.UPDATED_DESC).toHaveAttribute(
    'aria-sort',
    'descending'
  )
  sortSelect.focus()
  for (const [sort, direction] of [
    ['CREATED_DESC', 'descending'],
    ['LEVEL_ASC', 'ascending'],
    ['REPORT_COUNT_DESC', 'descending']
  ] as const) {
    const sortedResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return (
        response.request().method() === 'GET' &&
        url.pathname === '/api/v1/admin/questions' &&
        url.searchParams.get('sort') === sort
      )
    })
    await sortSelect.selectOption(sort)
    const sortedResponse = await sortedResponsePromise
    expect(sortedResponse.status()).toBe(200)
    await expect(sortSelect).toBeFocused()
    await expect(sortedHeaders[sort]).toHaveAttribute('aria-sort', direction)
    for (const [candidateSort, header] of Object.entries(sortedHeaders)) {
      if (candidateSort !== sort)
        await expect(header).not.toHaveAttribute('aria-sort')
    }
  }
  await expect(
    page.getByRole('columnheader', { name: '풀이·정답률' })
  ).toBeVisible()
  await expect(
    page.getByText(/\d+회 · (?:정답률 없음|정답률 \d+\.\d%)/u).first()
  ).toBeVisible()

  await Promise.all([
    page.waitForURL((url) => url.pathname === '/admin/questions/import'),
    page.getByRole('link', { exact: true, name: '가져오기' }).click()
  ])
  await expect(
    page.getByRole('heading', { level: 1, name: '문제 초안 가져오기' })
  ).toBeVisible()
  await page.getByLabel('JSON 파일').setInputFiles({
    name: 'phase7-import.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(importRequest), 'utf8')
  })

  const validationResponsePromise = waitForOperation(
    page,
    'POST',
    '/api/v1/admin/questions/import-validation'
  )
  await page
    .getByRole('button', { exact: true, name: '쓰기 없이 검증' })
    .click()
  const validationResponse = await validationResponsePromise
  expect(validationResponse.status()).toBe(200)
  expectExpectedApiTransport(validationResponse)
  expect(validationResponse.request().postDataJSON()).toEqual(importRequest)
  await expect(
    page.getByRole('heading', { name: '검증 통과 · 1개' })
  ).toBeVisible()
  await expect(page.getByText(/^digest [a-f0-9]{64}$/u)).toBeVisible()

  const applyResponsePromise = waitForOperation(
    page,
    'POST',
    '/api/v1/admin/questions/import-application'
  )
  await page
    .getByRole('button', {
      exact: true,
      name: '동일 검증 결과 원자 적용'
    })
    .click()
  const applyResponse = await applyResponsePromise
  expect(applyResponse.status()).toBe(201)
  expectExpectedApiTransport(applyResponse)
  await expect(
    page.getByText('1개 초안을 원자적으로 만들었습니다.', { exact: true })
  ).toHaveCount(1)

  const refreshedListResponsePromise = waitForQuestionList(page, null)
  await page
    .getByRole('navigation', { name: '현재 위치' })
    .getByRole('link', { exact: true, name: '문제 관리' })
    .click()
  const refreshedListResponse = await refreshedListResponsePromise
  expect(refreshedListResponse.status()).toBe(200)
  expectExpectedApiTransport(refreshedListResponse)

  const importedRow = page
    .getByRole('row')
    .filter({ hasText: importedQuestionText })
  await expect(importedRow).toHaveCount(1)
  const importedQuestionCheckbox = importedRow.getByRole('checkbox', {
    exact: true,
    name: `${importedQuestionText} 선택`
  })
  await expect(importedQuestionCheckbox).toBeEnabled()
  await importedQuestionCheckbox.check()
  await expect(page.getByText(/^1개 선택됨/u)).toBeVisible()

  const exportButton = page.getByRole('button', {
    exact: true,
    name: '민감 자료 내보내기'
  })
  const [exportResponse, download] = await Promise.all([
    waitForOperation(page, 'POST', '/api/v1/admin/questions/export'),
    page.waitForEvent('download'),
    exportButton.click()
  ])
  expect(exportResponse.status()).toBe(200)
  expectExpectedApiTransport(exportResponse)
  expect(exportResponse.headers()['content-type']).toBe(
    'application/json; charset=utf-8'
  )
  expect(exportResponse.headers()['content-disposition']).toBe(
    'attachment; filename="nihongo-admin-questions-v1.json"'
  )
  expect(download.suggestedFilename()).toBe('nihongo-admin-questions-v1.json')

  const exportDocument = adminQuestionExportDocumentV1Schema.parse(
    JSON.parse(new TextDecoder().decode(await exportResponse.body())) as unknown
  )
  expect(exportDocument.questions).toHaveLength(1)
  expect(
    exportDocument.questions[0]?.versions.some(
      (version) => version.content.questionText === importedQuestionText
    )
  ).toBe(true)
  await expect(
    page.getByText('1개 문제 내보내기를 시작했습니다.', { exact: true })
  ).toHaveCount(1)

  const openLink = importedRow.getByRole('link', {
    exact: true,
    name: '열기'
  })
  const detailHref = await openLink.getAttribute('href')
  if (!detailHref) throw new Error('Imported question detail link is missing.')
  const detailPath = new URL(detailHref, 'http://localhost').pathname
  const detailApiPath = `/api/v1${detailPath}`
  const questionId = detailPath.split('/').at(-1)
  if (!questionId) throw new Error('Imported question ID is missing.')

  await page.setViewportSize({ width: 1280, height: 900 })
  const detailResponsePromise = waitForOperation(page, 'GET', detailApiPath)
  await openLink.click()
  const detailResponse = await detailResponsePromise
  const detail = getAdminQuestionResponseSchema.parse(
    await detailResponse.json()
  )
  expect(detailResponse.status()).toBe(200)
  const versionId = detail.question.openCandidateVersionId
  if (!versionId) throw new Error('Imported draft version ID is missing.')
  expect(
    detail.versions.items.some(
      (version) => version.questionVersionId === versionId
    )
  ).toBe(true)
  await expect(
    page.getByRole('heading', { exact: true, name: 'v1 · 초안' })
  ).toBeVisible()

  const reviewPath = `/api/v1/admin/question-versions/${versionId}/review-request`
  const reviewResponse = await runQuestionCommand(page, '검수 요청', reviewPath)
  expect(reviewResponse.status()).toBe(200)
  await expect(
    page.getByRole('heading', { exact: true, name: 'v1 · 검수 중' })
  ).toBeVisible()

  const approvalPath = `/api/v1/admin/question-versions/${versionId}/approval`
  const sameAuthorApprovalResponse = await runQuestionCommand(
    page,
    '승인',
    approvalPath
  )
  expect(sameAuthorApprovalResponse.status()).toBe(409)
  await expect(
    page.getByText(
      '작성과 검수 역할을 분리해야 하므로 이 작업을 실행할 수 없습니다.',
      { exact: true }
    )
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { exact: true, name: 'v1 · 검수 중' })
  ).toBeVisible()

  await switchAccount(page, reviewer)
  await page.goto(detailPath)
  await expect(
    page.getByRole('heading', { exact: true, name: 'v1 · 검수 중' })
  ).toBeVisible()
  const reviewerApprovalResponse = await runQuestionCommand(
    page,
    '승인',
    approvalPath
  )
  expect(reviewerApprovalResponse.status()).toBe(200)
  await expect(
    page.getByRole('heading', { exact: true, name: 'v1 · 승인' })
  ).toBeVisible()
  await switchAccount(page, author)
  const staleTime = new Date(initialTime.getTime() + 6 * 60 * 1000)
  if (isMockBrowser) await page.clock.setFixedTime(staleTime)
  else await ageRealAuthorSession()
  await page.goto(detailPath)
  await expect(
    page.getByRole('heading', { exact: true, name: 'v1 · 승인' })
  ).toBeVisible()
  const freshnessPage = await page.context().newPage()
  await primeMockControlledPage(freshnessPage)
  if (isMockBrowser) await freshnessPage.clock.setFixedTime(staleTime)
  await freshnessPage.goto(detailPath)
  await expect(
    freshnessPage.getByRole('heading', { exact: true, name: 'v1 · 승인' })
  ).toBeVisible()

  const publicationPath = `/api/v1/admin/question-versions/${versionId}/publication`
  const stalePublicationResponse = await runQuestionCommand(
    page,
    '공개',
    publicationPath
  )
  expect(stalePublicationResponse.status()).toBe(401)
  await expect(
    page.getByRole('heading', { exact: true, name: '관리자 본인 확인' })
  ).toBeVisible()
  expect(
    apiRequests.filter(
      ({ method, pathname }) =>
        method === 'POST' && pathname === publicationPath
    )
  ).toHaveLength(1)

  const passwordInput = page.getByLabel('현재 비밀번호')
  const failedReauthenticationPromise = waitForOperation(
    page,
    'POST',
    '/api/v1/admin/reauthentication'
  )
  await passwordInput.fill(reviewer.password)
  await page.getByRole('button', { exact: true, name: '본인 확인' }).click()
  const failedReauthentication = await failedReauthenticationPromise
  expect(failedReauthentication.status()).toBe(401)
  await expect(passwordInput).toHaveValue('')
  await expect(passwordInput).toBeFocused()

  const successfulReauthenticationPromise = waitForOperation(
    page,
    'POST',
    '/api/v1/admin/reauthentication'
  )
  await passwordInput.fill(author.password)
  await page.getByRole('button', { exact: true, name: '본인 확인' }).click()
  const successfulReauthentication = await successfulReauthenticationPromise
  expect(successfulReauthentication.status()).toBe(200)
  await expect(
    page.getByRole('heading', { exact: true, name: '관리자 본인 확인' })
  ).toHaveCount(0)
  await expect(
    page.getByText(
      '본인 확인이 완료되었습니다. 원래 작업은 자동 실행되지 않았습니다. 내용을 확인한 뒤 다시 실행해 주세요.',
      { exact: true }
    )
  ).toBeAttached()
  expect(
    apiRequests.filter(
      ({ method, pathname }) =>
        method === 'POST' && pathname === publicationPath
    )
  ).toHaveLength(1)

  const crossTabFreshResponse = await requestBrowserJson(freshnessPage, {
    body: { expectedRowVersion: 3 },
    method: 'POST',
    pathname: approvalPath
  })
  expect(crossTabFreshResponse.status).toBe(409)
  await freshnessPage.close()

  const publicationResponse = await runQuestionCommand(
    page,
    '공개',
    publicationPath
  )
  expect(publicationResponse.status()).toBe(200)
  await expect(
    page.getByRole('heading', { exact: true, name: 'v1 · 공개' })
  ).toBeVisible()
  await expect(
    page.getByRole('heading', {
      exact: true,
      name: '명령을 완료하지 못했습니다'
    })
  ).toHaveCount(0)

  await switchAccount(page, learner)
  const learnerDeliveryResponse = await requestBrowserJson(page, {
    body: {
      count: 20,
      level: 'N5',
      mode: 'RANDOM',
      subject: 'GRAMMAR'
    },
    headers: { 'X-Nihongo-Practice-Contract': '2' },
    method: 'POST',
    pathname: '/api/v1/study-sessions'
  })
  expect(learnerDeliveryResponse.status).toBe(201)
  const learnerDelivery = createStudySessionV2ResponseSchema.parse(
    JSON.parse(learnerDeliveryResponse.bodyText) as unknown
  )
  const deliveredQuestion = learnerDelivery.questions.find(
    (item) => item.question.id === questionId
  )
  expect(deliveredQuestion?.question).toMatchObject({
    id: questionId,
    questionText: importedQuestionText,
    questionVersionId: versionId
  })
  expect(deliveredQuestion?.question).not.toHaveProperty('correctOptionId')
  expect(deliveredQuestion?.question).not.toHaveProperty('explanationKo')
  await switchAccount(page, author)
  await page.goto(detailPath)
  await expect(
    page.getByRole('heading', { exact: true, name: 'v1 · 공개' })
  ).toBeVisible()

  const createVersionPath = `/api/v1/admin/questions/${questionId}/versions`
  const createVersionResponsePromise = waitForOperation(
    page,
    'POST',
    createVersionPath
  )
  await page
    .getByRole('button', { exact: true, name: '새 초안 버전 만들기' })
    .click()
  await expect(
    page.getByRole('heading', {
      exact: true,
      name: '새 버전 만들기 확인'
    })
  ).toBeVisible()
  await page
    .getByRole('button', { exact: true, name: '명시적으로 실행' })
    .click()
  const createVersionResponse = await createVersionResponsePromise
  const createVersionResult = createAdminQuestionVersionResponseSchema.parse(
    await createVersionResponse.json()
  )
  expect(createVersionResponse.status()).toBe(201)
  const draftVersionId = createVersionResult.questionVersionId
  if (!draftVersionId) throw new Error('Created draft version ID is missing.')
  await expect(
    page.getByRole('heading', { exact: true, name: 'v2 · 초안' })
  ).toBeVisible()
  await expect(
    page.getByRole('heading', {
      exact: true,
      name: '학습자 공개 화면 미리보기'
    })
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { exact: true, name: '관리자 정답·해설' })
  ).toBeVisible()

  const secondPage = await page.context().newPage()
  await primeMockControlledPage(secondPage)
  if (isMockBrowser) await secondPage.clock.setFixedTime(staleTime)
  const secondPageMeResponsePromise = waitForOperation(
    secondPage,
    'GET',
    '/api/v1/me'
  )
  await secondPage.goto(detailPath)
  const secondPageMeResponse = await secondPageMeResponsePromise
  expect(secondPageMeResponse.status()).toBe(200)
  expectExpectedApiTransport(secondPageMeResponse)
  await expect(
    secondPage.getByRole('heading', { exact: true, name: 'v2 · 초안' })
  ).toBeVisible()

  const secondOptionInput = page.getByRole('textbox', {
    exact: true,
    name: '2번 보기'
  })
  const originalSecondOption = await secondOptionInput.inputValue()
  await secondOptionInput.press('Alt+ArrowUp')
  await expect(
    page.getByText(
      '2번 보기를 1번 위치로 이동했습니다. 정답 ID는 유지됩니다.',
      { exact: true }
    )
  ).toBeAttached()
  await expect(
    page.getByRole('textbox', { exact: true, name: '1번 보기' })
  ).toHaveValue(originalSecondOption)

  const firstTabDraft = `${importedQuestionText} 첫 번째 탭 편집`
  const secondTabDraft = `${importedQuestionText} 두 번째 탭 저장`
  await page
    .getByRole('textbox', { exact: true, name: '문제 문장' })
    .fill(firstTabDraft)
  await secondPage
    .getByRole('textbox', { exact: true, name: '문제 문장' })
    .fill(secondTabDraft)
  await expect(
    page.getByText(
      '저장하지 않은 편집 내용이 있어 버전 전환과 워크플로 명령을 잠갔습니다. 먼저 초안을 저장해 주세요.',
      { exact: true }
    )
  ).toBeVisible()
  await expect(
    page.getByRole('button', { exact: true, name: '검수 요청' })
  ).toBeDisabled()
  await expect(
    page.getByRole('button', { exact: true, name: '문제 보관' })
  ).toBeDisabled()
  await expect(page.getByRole('button', { name: /^v1 · 공개/u })).toBeDisabled()

  const updateVersionPath = `/api/v1/admin/question-versions/${draftVersionId}`
  const secondTabSavePromise = waitForOperation(
    secondPage,
    'PATCH',
    updateVersionPath
  )
  await secondPage
    .getByRole('button', { exact: true, name: '초안 변경사항 저장' })
    .click()
  const secondTabSave = await secondTabSavePromise
  expect(secondTabSave.status()).toBe(200)
  await expect(
    secondPage.getByText('초안 변경사항을 저장했습니다.', { exact: true })
  ).toBeAttached()

  const firstTabSaveButton = page.getByRole('button', {
    exact: true,
    name: '초안 변경사항 저장'
  })
  await expect(
    page.getByRole('textbox', { exact: true, name: '문제 문장' })
  ).toHaveValue(firstTabDraft)
  await expect(
    page.getByRole('textbox', { exact: true, name: '1번 보기' })
  ).toHaveValue(originalSecondOption)
  await expect(firstTabSaveButton).toBeEnabled()

  const firstTabSavePromise = waitForOperation(page, 'PATCH', updateVersionPath)
  await firstTabSaveButton.click()
  const firstTabSave = await firstTabSavePromise
  expect(firstTabSave.status()).toBe(409)
  await expect(
    page.getByRole('heading', {
      exact: true,
      name: '최신 버전 확인이 필요합니다'
    })
  ).toBeVisible()
  await expect(
    page.getByRole('textbox', { exact: true, name: '문제 문장' })
  ).toHaveValue(firstTabDraft)
  await page
    .getByRole('button', {
      exact: true,
      name: '최신 rowVersion과 차이 불러오기'
    })
    .click()
  await expect(
    page.getByText(
      '서버의 최신 rowVersion과 차이를 불러왔습니다. 로컬 편집 내용은 유지됩니다.',
      { exact: true }
    )
  ).toBeAttached()
  await expect(
    page.getByRole('textbox', { exact: true, name: '문제 문장' })
  ).toHaveValue(firstTabDraft)
  const conflictComparison = page.getByRole('alert').filter({
    has: page.getByRole('heading', {
      exact: true,
      name: '서버 최신본과 로컬 초안을 비교했습니다'
    })
  })
  await expect(conflictComparison).toBeVisible()
  await expect(
    conflictComparison.getByText('문제 문장', { exact: true })
  ).toBeVisible()
  await expect(
    conflictComparison.getByText('보기 내용·순서', { exact: true })
  ).toBeVisible()
  await expect(firstTabSaveButton).toBeDisabled()

  await page
    .getByRole('button', {
      exact: true,
      name: '검토한 로컬 초안을 최신 rowVersion에 적용'
    })
    .click()
  await expect(
    page.getByText(
      '로컬 초안을 최신 rowVersion에 적용하도록 명시적으로 선택했습니다.',
      { exact: true }
    )
  ).toBeAttached()
  await expect(firstTabSaveButton).toBeEnabled()

  const resolvedSavePromise = waitForOperation(page, 'PATCH', updateVersionPath)
  await firstTabSaveButton.click()
  const resolvedSave = await resolvedSavePromise
  expect(resolvedSave.status()).toBe(200)
  await expect(
    page.getByText('초안 변경사항을 저장했습니다.', { exact: true })
  ).toBeAttached()
  await expect(conflictComparison).toHaveCount(0)

  await secondPage.reload()
  await expect(
    secondPage.getByRole('heading', { exact: true, name: 'v2 · 초안' })
  ).toBeVisible()
  await expect(
    secondPage.getByRole('textbox', { exact: true, name: '문제 문장' })
  ).toHaveValue(firstTabDraft)

  const firstRaceDraft = `${importedQuestionText} 동시 저장 첫 번째 탭`
  const secondRaceDraft = `${importedQuestionText} 동시 저장 두 번째 탭`
  await page
    .getByRole('textbox', { exact: true, name: '문제 문장' })
    .fill(firstRaceDraft)
  await secondPage
    .getByRole('textbox', { exact: true, name: '문제 문장' })
    .fill(secondRaceDraft)
  const firstRaceResponsePromise = waitForOperation(
    page,
    'PATCH',
    updateVersionPath
  )
  const secondRaceResponsePromise = waitForOperation(
    secondPage,
    'PATCH',
    updateVersionPath
  )
  const removeRaceBarrier = await armAdminUpdateRaceBarrier(
    page.context(),
    page,
    draftVersionId
  )
  const [firstRaceResponse, secondRaceResponse] = await (async () => {
    try {
      const firstRaceSaveButton = page.getByRole('button', {
        exact: true,
        name: '초안 변경사항 저장'
      })
      const secondRaceSaveButton = secondPage.getByRole('button', {
        exact: true,
        name: '초안 변경사항 저장'
      })
      await expect(firstRaceSaveButton).toBeEnabled()
      await expect(secondRaceSaveButton).toBeEnabled()
      await Promise.all([
        firstRaceSaveButton.evaluate((button: HTMLButtonElement) =>
          button.click()
        ),
        secondRaceSaveButton.evaluate((button: HTMLButtonElement) =>
          button.click()
        )
      ])
      return await Promise.all([
        firstRaceResponsePromise,
        secondRaceResponsePromise
      ])
    } finally {
      await removeRaceBarrier()
    }
  })()
  expect(
    [firstRaceResponse.status(), secondRaceResponse.status()].toSorted()
  ).toEqual([200, 409])
  const loserPage = firstRaceResponse.status() === 409 ? page : secondPage
  const winnerPage = firstRaceResponse.status() === 200 ? page : secondPage
  const winnerDraft =
    firstRaceResponse.status() === 200 ? firstRaceDraft : secondRaceDraft
  const loserDraft =
    firstRaceResponse.status() === 409 ? firstRaceDraft : secondRaceDraft
  await expect(
    loserPage.getByRole('heading', {
      exact: true,
      name: '최신 버전 확인이 필요합니다'
    })
  ).toBeVisible()
  await expect(
    loserPage.getByRole('textbox', { exact: true, name: '문제 문장' })
  ).toHaveValue(loserDraft)

  const verificationPage = winnerPage
  await verificationPage.goto(detailPath)
  await expect(
    verificationPage.getByRole('textbox', {
      exact: true,
      name: '문제 문장'
    })
  ).toHaveValue(winnerDraft)

  await verificationPage.goto('/admin/questions')
  const tableRegion = verificationPage.getByRole('region', {
    name: '관리자 문제 목록 가로 스크롤 영역'
  })
  for (const width of [320, 375, 768, 1280]) {
    await verificationPage.setViewportSize({ width, height: 720 })
    await expect(tableRegion).toBeVisible()
    expect(
      await verificationPage.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true)
    if (width === 320) {
      expect(
        await tableRegion.evaluate(
          (element) => element.scrollWidth > element.clientWidth
        )
      ).toBe(true)
    }
  }

  await verificationPage.goto('/admin/audit-log')
  await expect(
    verificationPage.getByRole('heading', {
      level: 1,
      name: '관리자 감사 기록'
    })
  ).toBeVisible()
  const updateAudit = verificationPage
    .getByRole('listitem')
    .filter({ hasText: '문제 버전 수정' })
    .first()
  await expect(updateAudit).toContainText('행위자')
  await expect(updateAudit).toContainText('활성 관리자')
  await expect(updateAudit).toContainText('상태 변경')
  await expect(updateAudit).toContainText('변경 필드')

  await Promise.all([
    page.waitForLoadState('networkidle'),
    secondPage.waitForLoadState('networkidle'),
    verificationPage.waitForLoadState('networkidle')
  ])
  expect(transport.unexpectedResponses).toEqual([])
  expect(transport.failedRequests).toEqual([])

  const nonGetAdminRequests = apiRequests.filter(
    ({ method, pathname }) =>
      method !== 'GET' && pathname.startsWith('/api/v1/admin/')
  )
  expect(nonGetAdminRequests).toEqual([
    {
      method: 'POST',
      pathname: '/api/v1/admin/questions/import-validation'
    },
    {
      method: 'POST',
      pathname: '/api/v1/admin/questions/import-application'
    },
    { method: 'POST', pathname: '/api/v1/admin/questions/export' },
    { method: 'POST', pathname: reviewPath },
    { method: 'POST', pathname: approvalPath },
    { method: 'POST', pathname: approvalPath },
    { method: 'POST', pathname: publicationPath },
    { method: 'POST', pathname: '/api/v1/admin/reauthentication' },
    { method: 'POST', pathname: '/api/v1/admin/reauthentication' },
    { method: 'POST', pathname: approvalPath },
    { method: 'POST', pathname: publicationPath },
    { method: 'POST', pathname: createVersionPath },
    { method: 'PATCH', pathname: updateVersionPath },
    { method: 'PATCH', pathname: updateVersionPath },
    { method: 'PATCH', pathname: updateVersionPath },
    { method: 'PATCH', pathname: updateVersionPath },
    { method: 'PATCH', pathname: updateVersionPath }
  ])
  expect(
    apiRequests.some(({ pathname }) =>
      pathname.startsWith('/api/admin/question')
    )
  ).toBe(false)
  expect(
    apiRequests.some(
      ({ method, pathname }) =>
        pathname.startsWith('/api/v1/admin/') &&
        (method === 'PUT' || method === 'DELETE')
    )
  ).toBe(false)
  if (phase8Ledger) {
    const isAdminCommand = ({ method, path }: RequestLedgerEntry) =>
      method !== 'GET' && path.startsWith('/api/v1/admin/')
    await waitForLedgerSelectionToQuiesce(phase8Ledger, isAdminCommand)
    const adminCommandLedger = selectRequestLedger(phase8Ledger, isAdminCommand)
    expect(adminCommandLedger.entries).toHaveLength(17)
    const concurrentRaceEntries = adminCommandLedger.entries.slice(-2)
    expect(
      concurrentRaceEntries.every(
        ({ bodyDigest }) =>
          bodyDigest !== null && /^[a-f0-9]{64}$/u.test(bodyDigest)
      )
    ).toBe(true)
    expect(
      new Set(concurrentRaceEntries.map(({ bodyDigest }) => bodyDigest)).size
    ).toBe(2)
    await assertAndAttachLedger(
      adminCommandLedger,
      testInfo,
      `phase8-admin-lifecycle-${browserMode}-request-ledger`
    )
  }
})

test('ADMIN completes direct create, batch, change, withdrawal, retirement, and archive workflows', async ({
  page
}) => {
  test.setTimeout(180_000)
  const transport = trackApiTransport(page)
  const directQuestionText = '来週から 新しい 教室で 勉強する（　）なりました。'

  await login(page, author)
  await page.goto('/admin/questions/import')
  await page.getByLabel('JSON 파일').setInputFiles({
    name: 'phase7-invalid-import.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(invalidImportRequest), 'utf8')
  })
  const invalidValidationPromise = waitForOperation(
    page,
    'POST',
    '/api/v1/admin/questions/import-validation'
  )
  await page
    .getByRole('button', { exact: true, name: '쓰기 없이 검증' })
    .click()
  const invalidValidation = await invalidValidationPromise
  expect(invalidValidation.status()).toBe(200)
  expectExpectedApiTransport(invalidValidation)
  await expect(
    page.getByRole('heading', { exact: true, name: '검증 오류 · 1개' })
  ).toBeVisible()
  const unknownTagIssue = page
    .getByRole('listitem')
    .filter({ hasText: 'UNKNOWN_TAG' })
  await expect(unknownTagIssue).toContainText('등록되지 않은 태그')
  await expect(unknownTagIssue).toContainText('UNKNOWN_TAG')
  await expect(
    page.getByRole('button', {
      exact: true,
      name: '동일 검증 결과 원자 적용'
    })
  ).toHaveCount(0)

  await page.goto('/admin/questions/new')
  await expect(
    page.getByRole('heading', { level: 1, name: '새 문제 초안 만들기' })
  ).toBeVisible()
  await page
    .getByRole('textbox', { exact: true, name: '문제 문장' })
    .fill(directQuestionText)
  for (const [index, text] of [
    ['1', 'ことに'],
    ['2', 'ように'],
    ['3', 'ために'],
    ['4', 'ところに']
  ] as const) {
    await page
      .getByRole('textbox', { exact: true, name: `${index}번 보기` })
      .fill(text)
  }
  await page
    .getByLabel('한국어 해설')
    .fill('결정된 일정에는 「ことになる」 표현을 사용합니다.')
  const tagSearchResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      response.request().method() === 'GET' &&
      url.pathname === '/api/v1/admin/tags' &&
      url.searchParams.get('q') === 'ことになる'
    )
  })
  const tagSearch = page.getByRole('combobox', {
    name: '등록된 태그 검색'
  })
  await tagSearch.fill('ことになる')
  const tagSearchResponse = await tagSearchResponsePromise
  expect(tagSearchResponse.status()).toBe(200)
  expectExpectedApiTransport(tagSearchResponse)
  await page.getByRole('option', { exact: true, name: 'ことになる' }).click()
  await expect(
    page
      .getByLabel('선택된 태그')
      .getByRole('button', { name: 'ことになる 태그 제거' })
  ).toBeVisible()

  const createResponsePromise = waitForOperation(
    page,
    'POST',
    '/api/v1/admin/questions'
  )
  await page.getByRole('button', { exact: true, name: '초안 만들기' }).click()
  const createResponse = await createResponsePromise
  expect(createResponse.status()).toBe(201)
  expectExpectedApiTransport(createResponse)
  const created = createAdminQuestionResponseSchema.parse(
    await createResponse.json()
  )
  const questionId = created.questionId
  const versionId = created.questionVersionId
  if (!versionId) throw new Error('Direct-create version ID is missing.')
  const detailPath = `/admin/questions/${questionId}`
  await expect(page).toHaveURL(detailPath)
  await expect(
    page.getByRole('heading', { exact: true, name: 'v1 · 초안' })
  ).toBeVisible()

  await page.goto('/admin/questions')
  const createdRow = page
    .getByRole('row')
    .filter({ hasText: directQuestionText })
  await expect(createdRow).toHaveCount(1)
  await createdRow.getByRole('checkbox').check()
  const batchPath = '/api/v1/admin/question-versions/review-request-batch'
  const batchResponsePromise = waitForOperation(page, 'POST', batchPath)
  await page
    .getByRole('button', { exact: true, name: '선택 항목 검수 요청' })
    .click()
  const batchResponse = await batchResponsePromise
  expect(batchResponse.status()).toBe(200)
  expectExpectedApiTransport(batchResponse)
  await expect(createdRow).toContainText('검수 중')

  await switchAccount(page, reviewer)
  await page.goto(detailPath)
  await expect(
    page.getByRole('heading', { exact: true, name: 'v1 · 검수 중' })
  ).toBeVisible()
  const changeRequestPath = `/api/v1/admin/question-versions/${versionId}/change-request`
  expect(
    (
      await runQuestionCommand(
        page,
        '수정 요청',
        changeRequestPath,
        '문장 표현을 다시 확인해 주세요.'
      )
    ).status()
  ).toBe(200)
  await expect(
    page.getByRole('heading', { exact: true, name: 'v1 · 수정 요청' })
  ).toBeVisible()

  const reviewPath = `/api/v1/admin/question-versions/${versionId}/review-request`
  const approvalPath = `/api/v1/admin/question-versions/${versionId}/approval`
  const withdrawalPath = `/api/v1/admin/question-versions/${versionId}/approval-withdrawal`
  await switchAccount(page, author)
  await page.goto(detailPath)
  expect(
    (await runQuestionCommand(page, '검수 요청', reviewPath)).status()
  ).toBe(200)
  await expect(
    page.getByRole('heading', { exact: true, name: 'v1 · 검수 중' })
  ).toBeVisible()

  await switchAccount(page, reviewer)
  await page.goto(detailPath)
  expect((await runQuestionCommand(page, '승인', approvalPath)).status()).toBe(
    200
  )
  await expect(
    page.getByRole('heading', { exact: true, name: 'v1 · 승인' })
  ).toBeVisible()
  expect(
    (
      await runQuestionCommand(
        page,
        '승인 철회',
        withdrawalPath,
        '공개 전 최종 재검수가 필요합니다.'
      )
    ).status()
  ).toBe(200)
  await expect(
    page.getByRole('heading', { exact: true, name: 'v1 · 수정 요청' })
  ).toBeVisible()

  await switchAccount(page, author)
  await page.goto(detailPath)
  expect(
    (await runQuestionCommand(page, '검수 요청', reviewPath)).status()
  ).toBe(200)
  await switchAccount(page, reviewer)
  await page.goto(detailPath)
  expect((await runQuestionCommand(page, '승인', approvalPath)).status()).toBe(
    200
  )

  await switchAccount(page, author)
  await page.goto(detailPath)
  const publicationPath = `/api/v1/admin/question-versions/${versionId}/publication`
  expect(
    (await runQuestionCommand(page, '공개', publicationPath)).status()
  ).toBe(200)
  await expect(
    page.getByRole('heading', { exact: true, name: 'v1 · 공개' })
  ).toBeVisible()
  const retirementPath = `/api/v1/admin/question-versions/${versionId}/retirement`
  expect(
    (await runQuestionCommand(page, '공개 중단', retirementPath)).status()
  ).toBe(200)
  await expect(
    page.getByRole('heading', { exact: true, name: 'v1 · 공개 중단' })
  ).toBeVisible()

  await switchAccount(page, reviewer)
  await page.goto(detailPath)
  const archivePath = `/api/v1/admin/questions/${questionId}/archive`
  expect(
    (await runQuestionCommand(page, '문제 보관', archivePath)).status()
  ).toBe(200)
  await expect(page.getByText('보관됨', { exact: true })).toBeVisible()

  await page.goto('/admin/audit-log')
  const questionAuditItems = page
    .getByRole('listitem')
    .filter({ hasText: questionId })
  await expect(
    questionAuditItems.filter({
      has: page.locator('strong', { hasText: /^문제 생성$/u })
    })
  ).toHaveCount(1)
  await expect(
    questionAuditItems.filter({
      has: page.locator('strong', { hasText: /^문제 보관$/u })
    })
  ).toHaveCount(1)
  const versionAuditItems = page
    .getByRole('listitem')
    .filter({ hasText: versionId })
  for (const command of ['수정 요청', '승인 철회', '공개', '공개 중단']) {
    await expect(
      versionAuditItems.filter({
        has: page.locator('strong', {
          hasText: new RegExp(`^${command}$`, 'u')
        })
      })
    ).toHaveCount(1)
  }
  await expect(
    page.getByRole('listitem').filter({
      has: page.locator('strong', { hasText: /^일괄 검수 요청$/u })
    })
  ).toHaveCount(1)

  await page.waitForLoadState('networkidle')
  expect(transport.unexpectedResponses).toEqual([])
  expect(transport.failedRequests).toEqual([])
})

test('USER explicitly retries an offline report and ADMIN resolves it', async ({
  page
}) => {
  test.setTimeout(90_000)
  const transport = trackApiTransport(page)
  let reportPostRequests = 0
  page.context().on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === '/api/v1/question-reports'
    ) {
      reportPostRequests += 1
    }
  })
  await login(page, learner)

  const sessionResponse = await requestBrowserJson(page, {
    body: {
      count: 5,
      level: 'N5',
      mode: 'RANDOM',
      subject: 'VOCABULARY'
    },
    headers: { 'X-Nihongo-Practice-Contract': '2' },
    method: 'POST',
    pathname: '/api/v1/study-sessions'
  })
  expect(sessionResponse.status).toBe(201)
  const session = createStudySessionV2ResponseSchema.parse(
    JSON.parse(sessionResponse.bodyText) as unknown
  )
  const targetQuestionText = '「川」の 読み方は どれですか。'
  const target = session.questions.find(
    (item) => item.question.questionText === targetQuestionText
  )
  if (!target) throw new Error('Report entitlement target is unavailable.')

  const submissionResponse = await requestBrowserJson(page, {
    body: {
      answers: session.questions.map((item) => ({
        elapsedSec: 0,
        selectedOptionId: null,
        studySessionQuestionId: item.sessionQuestionId
      })),
      durationSec: 0,
      expectedDraftRevision: 0
    },
    headers: {
      'Idempotency-Key': crypto.randomUUID(),
      'X-Nihongo-Practice-Contract': '2'
    },
    method: 'POST',
    pathname: `/api/v1/study-sessions/${session.session.id}/submission`
  })
  expect(submissionResponse.status).toBe(201)

  await page.goto(`/practice/result/${session.session.id}`)
  const targetResult = page.getByRole('article').filter({
    has: page.getByRole('heading', {
      exact: true,
      level: 3,
      name: targetQuestionText
    })
  })
  await expect(targetResult).toBeVisible()
  await targetResult
    .getByRole('button', { exact: true, name: '문제 신고' })
    .click()
  const reportDialog = page.getByRole('dialog', { name: '문제 신고' })
  const reportDescription = 'Slice 6 offline report retry'
  await reportDialog.getByLabel('신고 사유').selectOption('TYPO_OR_GRAMMAR')
  await reportDialog.getByLabel('설명').fill(reportDescription)

  await page.context().setOffline(true)
  await reportDialog
    .getByRole('button', { exact: true, name: '신고 접수' })
    .click()
  await expect(
    reportDialog.getByText('오프라인입니다. 작성한 설명은 유지됩니다.', {
      exact: true
    })
  ).toBeVisible()
  await expect(reportDialog.getByLabel('설명')).toHaveValue(reportDescription)
  expect(reportPostRequests).toBe(0)

  await page.context().setOffline(false)
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true)
  const createReportResponsePromise = waitForOperation(
    page,
    'POST',
    '/api/v1/question-reports'
  )
  await reportDialog
    .getByRole('button', { exact: true, name: '신고 접수' })
    .click()
  const createReportResponse = await createReportResponsePromise
  expect(createReportResponse.status()).toBe(201)
  expectExpectedApiTransport(createReportResponse)
  expect(createReportResponse.request().postDataJSON()).toEqual({
    description: reportDescription,
    questionVersionId: target.question.questionVersionId,
    reason: 'TYPO_OR_GRAMMAR'
  })
  const createdReport = createQuestionReportResponseSchema.parse(
    await createReportResponse.json()
  )
  expect(createdReport).toMatchObject({
    questionId: target.question.id,
    questionVersionId: target.question.questionVersionId,
    rowVersion: 1,
    status: 'OPEN'
  })
  expect(reportPostRequests).toBe(1)
  await expect(reportDialog).toHaveCount(0)
  await expect(
    page.getByText('문제 신고를 접수했습니다.', { exact: true })
  ).toBeAttached()

  await switchAccount(page, author)
  await page.goto('/admin/questions')
  const reportListResponsePromise = waitForOperation(
    page,
    'GET',
    '/api/v1/admin/question-reports'
  )
  await page.getByRole('link', { exact: true, name: '신고 큐' }).click()
  const reportListResponse = await reportListResponsePromise
  expect(reportListResponse.status()).toBe(200)
  expectExpectedApiTransport(reportListResponse)
  const reportRow = page
    .getByRole('row')
    .filter({ hasText: target.question.id })
  await expect(reportRow).toContainText('접수됨')
  await expect(reportRow).toContainText('오탈자·문법 오류')
  await expect(reportRow).toContainText('활성 학습자')
  await expect(reportRow).toContainText('미할당')
  await expect(page.getByText(reportDescription, { exact: true })).toHaveCount(
    0
  )

  const reportDetailPath = `/api/v1/admin/question-reports/${createdReport.id}`
  const reportDetailResponsePromise = waitForOperation(
    page,
    'GET',
    reportDetailPath
  )
  await reportRow.getByRole('link', { exact: true, name: '열기' }).click()
  const reportDetailResponse = await reportDetailResponsePromise
  expect(reportDetailResponse.status()).toBe(200)
  const reportDetail = getAdminQuestionReportResponseSchema.parse(
    await reportDetailResponse.json()
  )
  expect(reportDetail.reporter.actorId).toBe(
    realFixture?.learner.userId ?? DEMO_USER_ID
  )
  await expect(
    page.getByRole('heading', { level: 1, name: '문제 신고 상세' })
  ).toBeVisible()
  await expect(page.getByText(reportDescription, { exact: true })).toBeVisible()
  await expect(
    page.getByText(`활성 학습자 · ${reportDetail.reporter.actorId}`, {
      exact: true
    })
  ).toBeVisible()
  await expect(page.getByText('미할당', { exact: true })).toBeVisible()

  const triagePath = `${reportDetailPath}/triage`
  const triageResponsePromise = waitForOperation(page, 'POST', triagePath)
  await page
    .getByRole('button', { exact: true, name: '신고 분류 시작' })
    .click()
  const triageResponse = await triageResponsePromise
  expect(triageResponse.status()).toBe(200)
  expect(triageResponse.request().postDataJSON()).toEqual({
    expectedRowVersion: 1
  })
  await expect(
    page.getByRole('heading', { exact: true, name: '최종 처리' })
  ).toBeVisible()

  const resolutionReason = '내용을 검토하고 운영 기록을 종결했습니다.'
  await page.getByLabel('처리 사유').fill(resolutionReason)
  const resolutionPath = `${reportDetailPath}/resolution`
  const resolutionResponsePromise = waitForOperation(
    page,
    'POST',
    resolutionPath
  )
  await page
    .getByRole('button', { exact: true, name: '최종 처리 실행' })
    .click()
  const resolutionResponse = await resolutionResponsePromise
  expect(resolutionResponse.status()).toBe(200)
  expect(resolutionResponse.request().postDataJSON()).toEqual({
    expectedRowVersion: 2,
    outcome: 'RESOLVED',
    reason: resolutionReason,
    remediationVersionId: null
  })
  await expect(
    page.getByRole('heading', { exact: true, name: '처리 완료: 해결' })
  ).toBeVisible()
  await expect(page.getByText(resolutionReason, { exact: true })).toBeVisible()
  await page.waitForLoadState('networkidle')
  expect(transport.unexpectedResponses).toEqual([])
  expect(transport.failedRequests).toEqual([])
})
