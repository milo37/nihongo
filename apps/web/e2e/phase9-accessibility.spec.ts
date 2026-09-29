import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { createQuestionReportResponseSchema } from '@nihongo/contracts/admin/phase7'
import { createStudySessionV2ResponseSchema } from '@nihongo/contracts/study/create-study-session'
import type {
  BrowserContext,
  Locator,
  Page,
  TestInfo,
  ViewportSize
} from '@playwright/test'
import {
  axeFindingDispositionSelectors,
  createAxeFindingDispositionKey
} from '../src/test/axeFindingDisposition'
import { isFocusedElementUnobscured } from '../src/test/focusGeometry'

type BrowserMode = 'mock' | 'real'
type UiLocale = 'ja' | 'ko'

interface Credentials {
  readonly email: string
  readonly password: string
}

interface RealBrowserFixture {
  readonly author: Credentials
  readonly learner: Credentials
}

interface BrowserJsonResponse {
  readonly bodyText: string
  readonly status: number
}

interface RouteState {
  readonly label: string
  readonly path: string
}

interface TransportEvidence {
  readonly unexpectedApiResponses: string[]
}

interface ViewportEvidenceOptions {
  readonly minimumTarget?: Locator
  readonly textSpacing?: boolean
}

const browserMode = (() => {
  const value = process.env.PHASE9_BROWSER_MODE
  if (value !== 'mock' && value !== 'real') {
    throw new Error('PHASE9_BROWSER_MODE must be mock or real.')
  }
  return value satisfies BrowserMode
})()

const isMockBrowser = browserMode === 'mock'
const locales = ['ko', 'ja'] as const satisfies readonly UiLocale[]
const wcagLevelTags = new Set([
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22a',
  'wcag22aa'
])

const isBlockingAxeFinding = (finding: {
  readonly impact: string | null
  readonly tags: readonly string[]
}): boolean =>
  finding.impact === 'critical' ||
  finding.impact === 'serious' ||
  finding.tags.some((tag) => wcagLevelTags.has(tag))

const demoAdmin = {
  email: 'admin@example.com',
  password: 'Demo-admin-2026!'
} as const satisfies Credentials

const demoUser = {
  email: 'user@example.com',
  password: 'Demo-user-2026!'
} as const satisfies Credentials

const readRealFixture = (): RealBrowserFixture | undefined => {
  if (isMockBrowser) return undefined

  const serialized =
    process.env.PHASE9_BROWSER_FIXTURE ?? process.env.PHASE7_BROWSER_FIXTURE
  if (!serialized) {
    throw new Error('Real Phase 9 browser fixture is missing.')
  }

  const fixture = JSON.parse(serialized) as Partial<RealBrowserFixture>
  for (const credentials of [fixture.author, fixture.learner]) {
    if (
      !credentials ||
      typeof credentials.email !== 'string' ||
      credentials.email.length === 0 ||
      typeof credentials.password !== 'string' ||
      credentials.password.length === 0
    ) {
      throw new Error('Real Phase 9 browser fixture is invalid.')
    }
  }

  return fixture as RealBrowserFixture
}

const realFixture = readRealFixture()
const admin = realFixture?.author ?? demoAdmin
const learner = realFixture?.learner ?? demoUser

const toArtifactSlug = (value: string): string =>
  value.replaceAll(/[^a-z0-9]+/giu, '-').replaceAll(/^-|-$/gu, '')

const trackApiTransport = (context: BrowserContext): TransportEvidence => {
  const evidence: TransportEvidence = { unexpectedApiResponses: [] }

  context.on('response', (response) => {
    const pathname = new URL(response.url()).pathname
    if (!pathname.startsWith('/api/')) return

    const unexpected = isMockBrowser
      ? !response.fromServiceWorker()
      : response.fromServiceWorker()
    if (unexpected) {
      evidence.unexpectedApiResponses.push(
        `${response.request().method()} ${pathname}`
      )
    }
  })

  return evidence
}

const settlePage = async (page: Page): Promise<void> => {
  await expect(page.locator('main')).toBeVisible()
  await expect(page.locator('main h1').first()).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts.ready)
  await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0)
}

const setLocale = async (page: Page, locale: UiLocale): Promise<void> => {
  await page.locator('select[name="ui-locale"]').selectOption(locale)
  await expect(page.locator('html')).toHaveAttribute('lang', locale)
  await expect(page.locator('main h1').first()).toBeVisible()
}

const focusByTab = async (
  page: Page,
  target: Locator,
  maxTabs = 120
): Promise<void> => {
  await expect(target).toBeVisible()
  for (let attempt = 0; attempt < maxTabs; attempt += 1) {
    if (
      await target.evaluate((element) => element === document.activeElement)
    ) {
      return
    }
    await page.keyboard.press('Tab')
  }
  await expect(target).toBeFocused()
}

const attachFocusedElementEvidence = async (
  page: Page,
  testInfo: TestInfo,
  label: string,
  minimumTargetSize = 0
): Promise<void> => {
  const readGeometry = async () =>
    await page.evaluate(() => {
      const activeElement = document.activeElement
      if (!(activeElement instanceof HTMLElement)) return null
      const activeRect = activeElement.getBoundingClientRect()
      const headerRect = document
        .querySelector('header')
        ?.getBoundingClientRect()
      const computedStyle = getComputedStyle(activeElement)
      const labelledBy = activeElement.getAttribute('aria-labelledby')
      const accessibleNameSource =
        activeElement.getAttribute('aria-label') ??
        (labelledBy
          ? labelledBy
              .split(/\s+/u)
              .map((id) => document.getElementById(id)?.textContent ?? '')
              .join(' ')
          : '')
      const semanticRole =
        activeElement.getAttribute('role') ??
        (activeElement.tagName === 'NAV' ? 'navigation' : '')
      const hasSupportedScrollRole = [
        'navigation',
        'region',
        'tablist'
      ].includes(semanticRole)
      const hasScrollableOverflow =
        (activeElement.scrollWidth > activeElement.clientWidth + 1 &&
          ['auto', 'scroll'].includes(computedStyle.overflowX)) ||
        (activeElement.scrollHeight > activeElement.clientHeight + 1 &&
          ['auto', 'scroll'].includes(computedStyle.overflowY))
      return {
        activeElement: activeElement.outerHTML.slice(0, 300),
        bottom: activeRect.bottom,
        headerBottom: headerRect?.bottom ?? 0,
        height: activeRect.height,
        insideHeader: Boolean(activeElement.closest('header')),
        isNamedScrollHost:
          accessibleNameSource.trim().length > 0 &&
          hasSupportedScrollRole &&
          hasScrollableOverflow,
        left: activeRect.left,
        right: activeRect.right,
        top: activeRect.top,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
        width: activeRect.width
      }
    })

  await expect
    .poll(async () => {
      const geometry = await readGeometry()
      if (!geometry) return false
      return isFocusedElementUnobscured(geometry)
    })
    .toBe(true)
  const geometry = await readGeometry()
  expect(geometry, `${label} must have a focused HTML element`).not.toBeNull()
  if (!geometry) return
  expect(
    isFocusedElementUnobscured(geometry),
    `${label} focus is obscured: ${JSON.stringify(geometry)}`
  ).toBe(true)
  if (minimumTargetSize > 0) {
    expect(
      geometry.width >= minimumTargetSize &&
        geometry.height >= minimumTargetSize,
      `${label} focused target is below ${minimumTargetSize}x${minimumTargetSize} CSS px: ${JSON.stringify(
        geometry
      )}`
    ).toBe(true)
  }
  await testInfo.attach(
    `focus-${toArtifactSlug(label)}-${testInfo.project.name}`,
    {
      body: JSON.stringify(geometry, null, 2),
      contentType: 'application/json'
    }
  )
}

const scanCurrentPage = async (
  page: Page,
  testInfo: TestInfo,
  label: string,
  locale: UiLocale
): Promise<void> => {
  await page.addStyleTag({
    content: '.content-auto { content-visibility: visible !important; }'
  })
  const results = await new AxeBuilder({ page }).analyze()
  const disposedIncompleteTargets = new Set<string>()
  const incompleteDispositions: Array<{
    readonly kind: string
    readonly ratio: number
    readonly rule: string
    readonly target: readonly (string | readonly string[])[]
    readonly threshold: number
  }> = []

  for (const finding of results.incomplete) {
    if (finding.id !== 'color-contrast') continue

    for (const node of finding.nodes) {
      const selector = node.target.map(String).join(' ')
      const measurement = await page
        .locator(selector)
        .first()
        .evaluate((element, selectors) => {
          const parseColor = (
            color: string
          ): readonly [number, number, number, number] | null => {
            const channels = color.match(/[\d.]+/gu)?.map(Number)
            if (!channels || channels.length < 3) return null
            return [
              channels[0] ?? 0,
              channels[1] ?? 0,
              channels[2] ?? 0,
              channels[3] ?? 1
            ]
          }
          const luminance = (color: readonly number[]): number => {
            const [red = 0, green = 0, blue = 0] = color.map((channel) => {
              const normalized = channel / 255
              return normalized <= 0.04045
                ? normalized / 12.92
                : ((normalized + 0.055) / 1.055) ** 2.4
            })
            return 0.2126 * red + 0.7152 * green + 0.0722 * blue
          }
          const foreground = parseColor(getComputedStyle(element).color)
          let current: Element | null = element
          let background: readonly [number, number, number, number] | null =
            null
          while (current && (!background || background[3] === 0)) {
            background = parseColor(getComputedStyle(current).backgroundColor)
            current = current.parentElement
          }
          if (!foreground || !background) return null

          const foregroundLuminance = luminance(foreground)
          const backgroundLuminance = luminance(background)
          const ratio =
            (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
            (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
          const kind = element.closest(selectors.paginationCurrent)
            ? 'pagination-current-text'
            : element.matches(selectors.optionReorderControl)
              ? 'option-reorder-control'
              : element.matches(selectors.tableSortIndicator)
                ? 'table-sort-indicator'
                : null

          return kind ? { kind, ratio } : null
        }, axeFindingDispositionSelectors)
      if (!measurement) continue

      const threshold = measurement.kind === 'pagination-current-text' ? 4.5 : 3
      expect(
        measurement.ratio,
        `${measurement.kind} computed contrast for ${selector}`
      ).toBeGreaterThanOrEqual(threshold)
      disposedIncompleteTargets.add(
        createAxeFindingDispositionKey(finding.id, node.target)
      )
      incompleteDispositions.push({
        kind: measurement.kind,
        ratio: measurement.ratio,
        rule: finding.id,
        target: node.target,
        threshold
      })
    }
  }

  const normalized = {
    incomplete: results.incomplete.map((finding) => ({
      help: finding.help,
      helpUrl: finding.helpUrl,
      id: finding.id,
      impact: finding.impact,
      nodes: finding.nodes.map((node) => ({
        failureSummary: node.failureSummary,
        html: node.html,
        target: node.target
      })),
      tags: finding.tags
    })),
    incompleteDispositions,
    label,
    locale,
    url: page.url(),
    violations: results.violations.map((violation) => ({
      help: violation.help,
      helpUrl: violation.helpUrl,
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => ({
        failureSummary: node.failureSummary,
        html: node.html,
        target: node.target
      })),
      tags: violation.tags
    }))
  }
  const blockers = normalized.violations.filter(isBlockingAxeFinding)
  const incompleteBlockers = normalized.incomplete
    .map((finding) => ({
      ...finding,
      nodes: finding.nodes.filter(
        (node) =>
          !disposedIncompleteTargets.has(
            createAxeFindingDispositionKey(finding.id, node.target)
          )
      )
    }))
    .filter(
      (finding) => finding.nodes.length > 0 && isBlockingAxeFinding(finding)
    )

  await testInfo.attach(
    `axe-${toArtifactSlug(label)}-${locale}-${testInfo.project.name}`,
    {
      body: JSON.stringify(normalized, null, 2),
      contentType: 'application/json'
    }
  )

  expect(
    blockers,
    `Blocking axe findings for ${label} (${locale}): ${JSON.stringify(
      blockers,
      null,
      2
    )}`
  ).toEqual([])
  expect(
    incompleteBlockers,
    `Unresolved axe incomplete findings for ${label} (${locale}): ${JSON.stringify(
      incompleteBlockers,
      null,
      2
    )}`
  ).toEqual([])
}

const scanRouteLocales = async (
  page: Page,
  testInfo: TestInfo,
  route: RouteState
): Promise<void> => {
  await page.goto(route.path)
  await settlePage(page)

  for (const locale of locales) {
    await setLocale(page, locale)
    await scanCurrentPage(page, testInfo, route.label, locale)
  }
}

const scanRoutes = async (
  page: Page,
  testInfo: TestInfo,
  routes: readonly RouteState[]
): Promise<void> => {
  for (const route of routes) {
    await scanRouteLocales(page, testInfo, route)
  }
}

const assertNoDocumentOverflow = async (
  page: Page,
  label: string,
  viewport: ViewportSize
) => {
  const geometry = await page.evaluate(() => {
    const viewportWidth = window.innerWidth
    const describe = (element: Element): string => {
      const id = element.id ? `#${element.id}` : ''
      const classes = [...element.classList]
        .slice(0, 3)
        .map((className) => `.${className}`)
        .join('')
      return `${element.tagName.toLowerCase()}${id}${classes}`
    }
    const accessibleName = (element: Element): string => {
      const direct = element.getAttribute('aria-label')?.trim()
      if (direct) return direct
      return (element.getAttribute('aria-labelledby') ?? '')
        .split(/\s+/u)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
        .filter(Boolean)
        .join(' ')
    }
    const isHorizontalScrollRegion = (element: Element): boolean => {
      const htmlElement = element as HTMLElement
      const style = getComputedStyle(element)
      return (
        htmlElement.scrollWidth > htmlElement.clientWidth + 1 &&
        (style.overflowX === 'auto' || style.overflowX === 'scroll')
      )
    }
    const isLabelledScrollRegion = (element: Element): boolean => {
      const role = element.getAttribute('role')
      const hasRegionSemantics =
        role === 'region' ||
        role === 'tablist' ||
        element.tagName.toLowerCase() === 'nav'
      return (
        hasRegionSemantics &&
        accessibleName(element).length > 0 &&
        isHorizontalScrollRegion(element)
      )
    }
    const findScrollRegion = (element: Element): Element | null => {
      let current: Element | null = element.parentElement
      while (current && current !== document.body) {
        if (isHorizontalScrollRegion(current)) return current
        current = current.parentElement
      }
      return null
    }
    const isVisuallyClippedAssistiveText = (
      element: Element,
      style: CSSStyleDeclaration
    ): boolean => {
      const rect = element.getBoundingClientRect()
      return (
        (rect.width <= 1 || rect.height <= 1) &&
        (style.clip !== 'auto' ||
          style.clipPath !== 'none' ||
          style.overflow === 'hidden')
      )
    }

    const unlabelledScrollRegions = [...document.body.querySelectorAll('*')]
      .filter((element) => {
        const style = getComputedStyle(element)
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          isHorizontalScrollRegion(element) &&
          !isLabelledScrollRegion(element)
        )
      })
      .map(describe)
      .slice(0, 20)

    const outsideViewport = [...document.body.querySelectorAll('*')]
      .filter((element) => {
        const style = getComputedStyle(element)
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          Number(style.opacity) === 0 ||
          isVisuallyClippedAssistiveText(element, style)
        ) {
          return false
        }
        const rect = element.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) return false
        if (rect.left >= -1 && rect.right <= viewportWidth + 1) return false

        const scrollRegion = findScrollRegion(element)
        return !scrollRegion || !isLabelledScrollRegion(scrollRegion)
      })
      .map((element) => ({
        element: describe(element),
        left: element.getBoundingClientRect().left,
        right: element.getBoundingClientRect().right
      }))
      .slice(0, 20)

    return {
      bodyScrollWidth: document.body.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      outsideViewport,
      unlabelledScrollRegions,
      viewportWidth
    }
  })

  expect(
    geometry.documentScrollWidth <= geometry.clientWidth + 1 &&
      geometry.bodyScrollWidth <= geometry.clientWidth + 1,
    `${label} overflows at ${viewport.width}x${viewport.height}: ${JSON.stringify(
      geometry
    )}`
  ).toBe(true)
  expect(
    geometry.unlabelledScrollRegions,
    `${label} has unlabelled horizontal scroll regions at ${viewport.width}x${viewport.height}: ${JSON.stringify(
      geometry.unlabelledScrollRegions
    )}`
  ).toEqual([])
  expect(
    geometry.outsideViewport,
    `${label} clips visible elements outside ${viewport.width}x${viewport.height}: ${JSON.stringify(
      geometry.outsideViewport
    )}`
  ).toEqual([])
  return geometry
}

const attachViewportEvidence = async (
  page: Page,
  testInfo: TestInfo,
  label: string,
  viewport: ViewportSize,
  minimumTarget?: Locator
): Promise<void> => {
  const geometry = await assertNoDocumentOverflow(page, label, viewport)
  const minimumTargetBox = minimumTarget
    ? await minimumTarget.boundingBox()
    : undefined
  if (minimumTarget) {
    expect(
      minimumTargetBox,
      `${label} primary target must have measurable geometry`
    ).not.toBeNull()
    expect(
      (minimumTargetBox?.width ?? 0) >= 44 &&
        (minimumTargetBox?.height ?? 0) >= 44,
      `${label} primary target is below 44x44 CSS px: ${JSON.stringify(
        minimumTargetBox
      )}`
    ).toBe(true)
  }

  const artifactSlug = toArtifactSlug(label)
  await testInfo.attach(
    `viewport-${artifactSlug}-geometry-${testInfo.project.name}`,
    {
      body: JSON.stringify(
        { ...geometry, minimumTargetBox, viewport },
        null,
        2
      ),
      contentType: 'application/json'
    }
  )
  await testInfo.attach(
    `viewport-${artifactSlug}-screenshot-${testInfo.project.name}`,
    {
      body: await page.screenshot({ animations: 'disabled', fullPage: false }),
      contentType: 'image/png'
    }
  )
}

const verifyViewport = async (
  page: Page,
  testInfo: TestInfo,
  path: string,
  label: string,
  viewport: ViewportSize,
  options: ViewportEvidenceOptions = {}
): Promise<void> => {
  await page.setViewportSize(viewport)
  await page.goto(path)
  await settlePage(page)
  if (options.textSpacing) {
    await page.addStyleTag({
      content: `
        main * { letter-spacing: 0.12em !important; line-height: 1.5 !important; word-spacing: 0.16em !important; }
        main p { margin-block-end: 2em !important; }
      `
    })
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    )
  }
  await attachViewportEvidence(
    page,
    testInfo,
    label,
    viewport,
    options.minimumTarget
  )
}

const login = async (
  page: Page,
  credentials: Credentials,
  forwardedFor: string
): Promise<void> => {
  if (!isMockBrowser) {
    await page.context().setExtraHTTPHeaders({
      'X-Forwarded-For': forwardedFor
    })
  }

  await page.goto('/login')
  await settlePage(page)
  const form = page.locator('form').filter({
    has: page.locator('input[name="password"]')
  })
  const email = form.locator('input[name="email"]')
  const password = form.locator('input[name="password"]')
  const submit = form.locator('button[type="submit"]')
  await focusByTab(page, email)
  await page.keyboard.type(credentials.email)
  await page.keyboard.press('Tab')
  await expect(password).toBeFocused()
  await page.keyboard.type(credentials.password)
  await focusByTab(page, submit)
  await Promise.all([
    page.waitForURL((url) => url.pathname === '/', { timeout: 15_000 }),
    page.keyboard.press('Enter')
  ])
  await settlePage(page)
}

const requestBrowserJson = async (
  page: Page,
  pathname: string,
  body: unknown,
  headers: Readonly<Record<string, string>> = {}
): Promise<BrowserJsonResponse> =>
  await page.evaluate(
    async ({ body: requestBody, headers: requestHeaders, pathname: path }) => {
      const response = await fetch(path, {
        body: JSON.stringify(requestBody),
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...requestHeaders
        },
        method: 'POST'
      })
      return { bodyText: await response.text(), status: response.status }
    },
    { body, headers, pathname }
  )

const createSession = async (
  page: Page,
  options: {
    readonly count?: number
    readonly subject?: 'READING' | 'VOCABULARY'
  } = {}
) => {
  const response = await requestBrowserJson(
    page,
    '/api/v1/study-sessions',
    {
      count: options.count ?? 5,
      level: 'N5',
      mode: 'RANDOM',
      subject: options.subject ?? 'VOCABULARY'
    },
    { 'X-Nihongo-Practice-Contract': '2' }
  )
  expect(response.status).toBe(201)
  return createStudySessionV2ResponseSchema.parse(
    JSON.parse(response.bodyText) as unknown
  )
}

const submitAllWrong = async (
  page: Page,
  session: Awaited<ReturnType<typeof createSession>>
): Promise<void> => {
  const response = await requestBrowserJson(
    page,
    `/api/v1/study-sessions/${session.session.id}/submission`,
    {
      answers: session.questions.map((question) => ({
        elapsedSec: 0,
        selectedOptionId: null,
        studySessionQuestionId: question.sessionQuestionId
      })),
      durationSec: 0,
      expectedDraftRevision: 0
    },
    {
      'Idempotency-Key': crypto.randomUUID(),
      'X-Nihongo-Practice-Contract': '2'
    }
  )
  expect(response.status).toBe(201)
}

const createReportFixture = async (page: Page) => {
  const session = await createSession(page)
  await submitAllWrong(page, session)
  const target = session.questions[0]
  if (!target) throw new Error('Phase 9 report question fixture is missing.')

  const response = await requestBrowserJson(page, '/api/v1/question-reports', {
    description: 'Phase 9 accessibility route audit fixture',
    questionVersionId: target.question.questionVersionId,
    reason: 'OTHER'
  })
  expect(response.status).toBe(201)

  return {
    questionId: target.question.id,
    report: createQuestionReportResponseSchema.parse(
      JSON.parse(response.bodyText) as unknown
    )
  }
}

test('guest routes pass KO/JA axe, keyboard focus, and mobile reflow checks', async ({
  context,
  page
}, testInfo) => {
  test.setTimeout(300_000)
  const transport = trackApiTransport(context)

  await page.setViewportSize({ height: 568, width: 320 })
  await page.goto('/')
  await settlePage(page)
  await page.keyboard.press('Tab')
  const skipLink = page.locator('a[href="#main-content"]')
  await expect(skipLink).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('main')).toBeFocused()

  await page.goto('/')
  await settlePage(page)
  const menuButton = page.locator('button[aria-controls="primary-navigation"]')
  await focusByTab(page, menuButton)
  await attachFocusedElementEvidence(
    page,
    testInfo,
    'guest-mobile-menu-trigger',
    44
  )
  await page.keyboard.press('Enter')
  await expect(menuButton).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Escape')
  await expect(menuButton).toBeFocused()
  await expect(menuButton).toHaveAttribute('aria-expanded', 'false')

  await verifyViewport(
    page,
    testInfo,
    '/practice',
    'guest-practice-320',
    {
      height: 568,
      width: 320
    },
    {
      minimumTarget: page.getByRole('button', { name: '학습 시작' })
    }
  )
  const practiceLogin = page
    .getByRole('link', { name: '로그인하기', exact: true })
    .last()
  await focusByTab(page, practiceLogin)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/login\?redirect=/u)
  await expect(page.locator('main')).toBeFocused()

  await page.setViewportSize({ height: 900, width: 1280 })
  await scanRoutes(page, testInfo, [
    { label: 'home', path: '/' },
    { label: 'login-sign-in', path: '/login' },
    ...(!isMockBrowser
      ? [
          { label: 'login-sign-up', path: '/login?mode=signup' },
          { label: 'login-reset-request', path: '/login?mode=reset' }
        ]
      : []),
    { label: 'reset-password-missing-token', path: '/reset-password' },
    { label: 'verify-email-missing-token', path: '/verify-email' },
    { label: 'practice-setup-guest', path: '/practice' },
    { label: 'forbidden', path: '/forbidden' },
    { label: 'not-found', path: '/phase-9-route-not-found' }
  ])

  expect(transport.unexpectedApiResponses).toEqual([])
})

test('learner routes pass KO/JA axe, state, viewport, motion, and forced-colors checks', async ({
  context,
  page
}, testInfo) => {
  test.setTimeout(300_000)
  const transport = trackApiTransport(context)
  await login(page, learner, '203.0.113.241')

  const session = await createSession(page)
  const sessionPath = `/practice/session/${session.session.id}`
  await page.setViewportSize({ height: 900, width: 1280 })
  await scanRouteLocales(page, testInfo, {
    label: 'practice-session',
    path: sessionPath
  })

  const readingSession = await createSession(page, {
    count: 1,
    subject: 'READING'
  })
  const readingSessionPath = `/practice/session/${readingSession.session.id}`
  await verifyViewport(
    page,
    testInfo,
    readingSessionPath,
    'practice-reading-1280',
    {
      height: 800,
      width: 1280
    }
  )
  await setLocale(page, 'ko')
  const readingPassage = page.getByRole('article', { name: '독해 지문' })
  const firstAnswer = page.getByRole('radio').first()
  await expect(readingPassage).toBeVisible()
  expect(
    await readingPassage.evaluate(
      (element) => getComputedStyle(element.parentElement ?? element).display
    )
  ).toBe('grid')
  expect(
    await readingPassage.evaluate((element) => {
      const answer = document.querySelector('main input[type="radio"]')
      return Boolean(
        answer &&
          element.compareDocumentPosition(answer) &
            Node.DOCUMENT_POSITION_FOLLOWING
      )
    })
  ).toBe(true)
  await focusByTab(page, readingPassage)
  await attachFocusedElementEvidence(page, testInfo, 'learner-reading-passage')
  await focusByTab(page, firstAnswer)
  await page.keyboard.press('Space')
  await expect(firstAnswer).toBeChecked()
  await expect(
    page.locator('.ui-question-jump[data-answered="true"]').first()
  ).toBeVisible()
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
  expect(
    await page.evaluate(
      () => window.matchMedia('(forced-colors: active)').matches
    )
  ).toBe(true)
  expect(
    await page.evaluate(
      () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
  ).toBe(true)
  await expect
    .poll(() =>
      page
        .locator('.ui-question-jump[data-answered="true"]')
        .first()
        .evaluate((element) => getComputedStyle(element).borderStyle)
    )
    .toBe('double')
  await expect
    .poll(() =>
      page
        .locator('a[href="/practice"]')
        .first()
        .evaluate((element) =>
          Number.parseFloat(getComputedStyle(element).transitionDuration)
        )
    )
    .toBeLessThanOrEqual(0.00001)
  await page.emulateMedia({
    forcedColors: 'none',
    reducedMotion: 'no-preference'
  })

  await verifyViewport(
    page,
    testInfo,
    sessionPath,
    'practice-session-landscape',
    {
      height: 390,
      width: 844
    }
  )
  await verifyViewport(page, testInfo, sessionPath, 'practice-session-375', {
    height: 812,
    width: 375
  })

  await submitAllWrong(page, session)
  const targetQuestion = session.questions[0]
  if (!targetQuestion) {
    throw new Error('Phase 9 learner question fixture is missing.')
  }

  const resultPath = `/practice/result/${session.session.id}`
  const wrongNotePath = `/wrong-notes/${targetQuestion.question.id}`
  await page.setViewportSize({ height: 900, width: 1280 })
  await scanRoutes(page, testInfo, [
    { label: 'dashboard', path: '/dashboard' },
    { label: 'wrong-note-center', path: '/wrong-notes' },
    { label: 'wrong-note-history', path: '/wrong-notes/history' },
    { label: 'wrong-note-detail', path: wrongNotePath },
    { label: 'bookmarks', path: '/bookmarks' },
    { label: 'practice-result', path: resultPath }
  ])

  await verifyViewport(page, testInfo, '/dashboard', 'dashboard-375', {
    height: 812,
    width: 375
  })
  await verifyViewport(page, testInfo, resultPath, 'practice-result-1440', {
    height: 900,
    width: 1440
  })
  await verifyViewport(page, testInfo, resultPath, 'practice-result-375', {
    height: 812,
    width: 375
  })
  await verifyViewport(
    page,
    testInfo,
    '/dashboard',
    'dashboard-200-percent-reflow',
    {
      height: 900,
      width: 640
    }
  )
  await verifyViewport(
    page,
    testInfo,
    '/dashboard',
    'dashboard-text-spacing-375',
    {
      height: 812,
      width: 375
    },
    { textSpacing: true }
  )

  await page.setViewportSize({ height: 900, width: 1280 })
  await page.goto(resultPath)
  await settlePage(page)
  await setLocale(page, 'ko')
  await page.setViewportSize({ height: 812, width: 375 })
  await expect(page.locator('main [lang="ja"]').first()).toBeVisible()
  await expect(page.locator('main [lang="ko"]').first()).toBeVisible()
  const reportTrigger = page
    .getByRole('button', { name: '문제 신고', exact: true })
    .first()
  await focusByTab(page, reportTrigger)
  await page.keyboard.press('Enter')
  const reportDialog = page.getByRole('dialog', { name: '문제 신고' })
  await expect(reportDialog).toBeVisible()
  await expect(
    reportDialog.locator('[name="report-description"]')
  ).toBeFocused()
  const reportSubmit = reportDialog.getByRole('button', { name: '신고 접수' })
  await reportSubmit.focus()
  await page.keyboard.press('Enter')
  await expect(
    reportDialog.getByText('신고 설명을 입력해 주세요.', { exact: true })
  ).toHaveAttribute('role', 'alert')
  await expect(
    reportDialog.locator('[name="report-description"]')
  ).toBeFocused()
  await attachViewportEvidence(
    page,
    testInfo,
    'practice-result-report-dialog-375',
    {
      height: 812,
      width: 375
    }
  )
  await page.keyboard.press('Escape')
  await expect(reportDialog).toBeHidden()
  await expect(reportTrigger).toBeFocused()

  await page.setViewportSize({ height: 900, width: 1280 })
  await page.goto('/dashboard')
  await settlePage(page)
  const wrongNoteCenterLink = page.locator('a[href="/wrong-notes"]').first()
  await focusByTab(page, wrongNoteCenterLink)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/wrong-notes$/u)
  await expect(page.locator('main')).toBeFocused()
  await expect(
    page
      .locator('p[aria-live="polite"][aria-atomic="true"]')
      .filter({ hasText: '오답 복습 센터 화면으로 이동했습니다.' })
  ).toBeAttached()

  expect(transport.unexpectedApiResponses).toEqual([])
})

test('admin routes pass KO/JA axe and responsive content checks', async ({
  context,
  page
}, testInfo) => {
  test.setTimeout(300_000)
  const transport = trackApiTransport(context)
  await login(page, admin, '203.0.113.242')
  const fixture = await createReportFixture(page)

  const questionDetailPath = `/admin/questions/${fixture.questionId}`
  const reportDetailPath = `/admin/reports/${fixture.report.id}`
  await page.setViewportSize({ height: 900, width: 1280 })
  await scanRoutes(page, testInfo, [
    { label: 'admin-question-list', path: '/admin/questions' },
    { label: 'admin-question-create', path: '/admin/questions/new' },
    { label: 'admin-question-import', path: '/admin/questions/import' },
    { label: 'admin-question-detail', path: questionDetailPath },
    { label: 'admin-question-edit', path: `${questionDetailPath}/edit` },
    { label: 'admin-audit-log', path: '/admin/audit-log' },
    { label: 'admin-report-list', path: '/admin/reports' },
    { label: 'admin-report-detail', path: reportDetailPath }
  ])

  await verifyViewport(
    page,
    testInfo,
    '/admin/questions',
    'admin-question-list-768',
    {
      height: 1024,
      width: 768
    }
  )
  await verifyViewport(
    page,
    testInfo,
    '/admin/questions/import',
    'admin-import-320',
    {
      height: 800,
      width: 320
    }
  )
  await verifyViewport(
    page,
    testInfo,
    `${questionDetailPath}/edit`,
    'admin-edit-375',
    {
      height: 812,
      width: 375
    }
  )
  await verifyViewport(
    page,
    testInfo,
    questionDetailPath,
    'admin-detail-1280',
    {
      height: 800,
      width: 1280
    }
  )
  await verifyViewport(
    page,
    testInfo,
    reportDetailPath,
    'admin-report-detail-1440',
    {
      height: 900,
      width: 1440
    }
  )

  await page.setViewportSize({ height: 900, width: 1280 })
  await page.goto('/admin/questions')
  await settlePage(page)
  await setLocale(page, 'ko')
  const tableRegion = page.getByRole('region', {
    name: '관리자 문제 목록 가로 스크롤 영역'
  })
  await focusByTab(page, tableRegion)
  await expect(tableRegion).toBeFocused()
  await attachFocusedElementEvidence(page, testInfo, 'admin-question-table')
  const levelSort = page.getByRole('button', {
    name: '분류, 급수 오름차순으로 정렬'
  })
  await focusByTab(page, levelSort)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/(?:\?|&)sort=LEVEL_ASC(?:&|$)/u)
  await expect(
    tableRegion.getByRole('columnheader', {
      name: /^분류, 급수 오름차순 정렬됨/u
    })
  ).toHaveAttribute('aria-sort', 'ascending')

  const detailLink = tableRegion.locator('a[href^="/admin/questions/"]').first()
  await focusByTab(page, detailLink)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/admin\/questions\/[0-9a-f-]+$/u)
  await expect(page.locator('main')).toBeFocused()
  await expect(
    page
      .locator('p[aria-live="polite"][aria-atomic="true"]')
      .filter({ hasText: '문제 상세 화면으로 이동했습니다.' })
  ).toBeAttached()

  await page.goto(questionDetailPath)
  await settlePage(page)
  await setLocale(page, 'ko')
  const retireTrigger = page.getByRole('button', {
    name: '공개 중단',
    exact: true
  })
  await focusByTab(page, retireTrigger)
  await page.keyboard.press('Enter')
  const commandDialog = page.getByRole('dialog', { name: '공개 중단 확인' })
  await expect(commandDialog).toBeVisible()
  await expect(
    commandDialog.getByRole('button', { name: '명시적으로 실행' })
  ).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(commandDialog).toBeHidden()
  await expect(retireTrigger).toBeFocused()

  expect(transport.unexpectedApiResponses).toEqual([])
})
