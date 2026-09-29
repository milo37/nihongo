import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { createQuestionReportResponseSchema } from '@nihongo/contracts/admin/phase7'
import { createBookmarkResponseSchema } from '@nihongo/contracts/bookmark/create-bookmark'
import { listBookmarksResponseSchema } from '@nihongo/contracts/bookmark/list-bookmarks'
import {
  createStudySessionV2BodySchema,
  createStudySessionV2ResponseSchema
} from '@nihongo/contracts/study/create-study-session'
import {
  submitStudySessionV2BodySchema,
  submitStudySessionV2ResponseSchema
} from '@nihongo/contracts/study/submit-study-session'
import type {
  BrowserContext,
  Locator,
  Page,
  Request,
  Response,
  Route,
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

interface ApiRequestEvidence {
  readonly exchangeId: number
  readonly idempotencyKeyDigest: string | null
  readonly idempotencyKeyIsUuid: boolean
  readonly method: string
  readonly pathname: string
  readonly payload: unknown
  readonly practiceContract: string | null
  readonly query: string
  readonly sequence: number
}

interface ApiResponseEvidence {
  readonly exchangeId: number
  readonly fromServiceWorker: boolean
  readonly headers: {
    readonly cacheControl: string | null
    readonly idempotencyReplayed: string | null
    readonly location: string | null
    readonly practiceContract: string | null
    readonly testFault: string | null
  }
  readonly method: string
  readonly pathname: string
  readonly payload: unknown
  readonly provenance: 'injected-test-fault' | 'network' | 'service-worker'
  readonly sequence: number
  readonly status: number
  readonly terminalState:
    | 'body-read-failed'
    | 'body-read-timeout'
    | 'finished'
    | 'invalid-json'
    | 'response-failed'
    | 'unexpected-content-type'
}

interface ApiRequestFailureEvidence {
  readonly errorText: string
  readonly exchangeId: number
  readonly method: string
  readonly pathname: string
  readonly sequence: number
}

interface TransportEvidence {
  readonly inFlightExchangeIds: Set<number>
  readonly failedApiRequests: ApiRequestFailureEvidence[]
  readonly pendingResponseReads: Set<Promise<void>>
  readonly requestExchangeIds: WeakMap<Request, number>
  readonly requests: ApiRequestEvidence[]
  readonly responses: ApiResponseEvidence[]
  activityRevision: number
  exchangeSequence: number
  sequence: number
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

const redactTransportPayload = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redactTransportPayload)
  if (value === null || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      /authorization|cookie|email|password|secret|token/iu.test(key)
        ? '[REDACTED]'
        : redactTransportPayload(entry)
    ])
  )
}

const redactTransportQuery = (url: URL): string => {
  const query = new URLSearchParams(url.search)
  for (const key of [...query.keys()]) {
    if (/authorization|cookie|email|password|secret|token/iu.test(key)) {
      query.set(key, '[REDACTED]')
    }
  }
  query.sort()
  const serialized = query.toString()
  return serialized ? `?${serialized}` : ''
}

const readRequestPayload = (request: Request): unknown => {
  if (!request.postData()) return null
  try {
    return redactTransportPayload(request.postDataJSON())
  } catch {
    return '[NON_JSON_BODY]'
  }
}

const readResponsePayload = async (
  response: Response
): Promise<Pick<ApiResponseEvidence, 'payload' | 'terminalState'>> => {
  const contentType = response.headers()['content-type'] ?? ''
  if (response.status() === 204) {
    return { payload: null, terminalState: 'finished' }
  }
  if (!/^application\/(?:[a-z0-9.-]+\+)?json(?:\s*;|$)/iu.test(contentType)) {
    return {
      payload: `[UNEXPECTED_CONTENT_TYPE: ${contentType || 'missing'}]`,
      terminalState: 'unexpected-content-type'
    }
  }

  let bodyText: string
  try {
    bodyText = await response.text()
  } catch {
    return {
      payload: '[BODY_READ_FAILED]',
      terminalState: 'body-read-failed'
    }
  }

  try {
    return {
      payload: redactTransportPayload(JSON.parse(bodyText) as unknown),
      terminalState: 'finished'
    }
  } catch {
    return {
      payload: '[INVALID_JSON_BODY]',
      terminalState: 'invalid-json'
    }
  }
}

const responseReadTimeoutMs = 15_000

const readFinishedResponse = async (
  response: Response
): Promise<Pick<ApiResponseEvidence, 'payload' | 'terminalState'>> => {
  const failure = await response.finished()
  if (failure) {
    return {
      payload: `[RESPONSE_FAILED: ${failure.message}]`,
      terminalState: 'response-failed'
    }
  }

  return await readResponsePayload(response)
}

const readResponseWithDeadline = async (
  response: Response
): Promise<Pick<ApiResponseEvidence, 'payload' | 'terminalState'>> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<
    Pick<ApiResponseEvidence, 'payload' | 'terminalState'>
  >((resolve) => {
    timeoutId = setTimeout(() => {
      resolve({
        payload: '[BODY_READ_TIMEOUT]',
        terminalState: 'body-read-timeout'
      })
    }, responseReadTimeoutMs)
  })

  try {
    return await Promise.race([readFinishedResponse(response), timeout])
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}

const trackApiTransport = (context: BrowserContext): TransportEvidence => {
  const evidence: TransportEvidence = {
    activityRevision: 0,
    exchangeSequence: 0,
    failedApiRequests: [],
    inFlightExchangeIds: new Set(),
    pendingResponseReads: new Set(),
    requestExchangeIds: new WeakMap(),
    requests: [],
    responses: [],
    sequence: 0
  }

  context.on('request', (request) => {
    const url = new URL(request.url())
    if (!url.pathname.startsWith('/api/')) return

    const exchangeId = ++evidence.exchangeSequence
    const idempotencyKey = request.headers()['idempotency-key']
    evidence.requestExchangeIds.set(request, exchangeId)
    evidence.inFlightExchangeIds.add(exchangeId)
    evidence.activityRevision += 1
    evidence.requests.push({
      exchangeId,
      idempotencyKeyDigest: idempotencyKey
        ? createHash('sha256').update(idempotencyKey).digest('hex')
        : null,
      idempotencyKeyIsUuid:
        typeof idempotencyKey === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
          idempotencyKey
        ),
      method: request.method(),
      pathname: url.pathname,
      payload: readRequestPayload(request),
      practiceContract:
        request.headers()['x-nihongo-practice-contract'] ?? null,
      query: redactTransportQuery(url),
      sequence: ++evidence.sequence
    })
  })

  const markApiRequestTerminal = (request: Request): void => {
    const exchangeId = evidence.requestExchangeIds.get(request)
    if (exchangeId === undefined) return
    if (evidence.inFlightExchangeIds.delete(exchangeId)) {
      evidence.activityRevision += 1
    }
  }

  context.on('response', (response) => {
    const url = new URL(response.url())
    if (!url.pathname.startsWith('/api/')) return

    const request = response.request()
    const exchangeId = evidence.requestExchangeIds.get(request) ?? 0
    const sequence = ++evidence.sequence
    const responseHeaders = response.headers()
    const testFault = responseHeaders['x-phase9-test-fault'] ?? null
    const pendingRead = (async (): Promise<void> => {
      const { payload, terminalState } =
        await readResponseWithDeadline(response)
      evidence.responses.push({
        exchangeId,
        fromServiceWorker: response.fromServiceWorker(),
        headers: {
          cacheControl: responseHeaders['cache-control'] ?? null,
          idempotencyReplayed: responseHeaders['idempotency-replayed'] ?? null,
          location: responseHeaders.location ?? null,
          practiceContract:
            responseHeaders['x-nihongo-practice-contract'] ?? null,
          testFault
        },
        method: request.method(),
        pathname: url.pathname,
        payload,
        provenance: testFault
          ? 'injected-test-fault'
          : response.fromServiceWorker()
            ? 'service-worker'
            : 'network',
        sequence,
        status: response.status(),
        terminalState
      })
    })().finally(() => {
      evidence.pendingResponseReads.delete(pendingRead)
    })
    evidence.pendingResponseReads.add(pendingRead)
  })

  context.on('requestfailed', (request) => {
    const url = new URL(request.url())
    if (!url.pathname.startsWith('/api/')) return

    markApiRequestTerminal(request)
    evidence.failedApiRequests.push({
      errorText: request.failure()?.errorText ?? 'unknown failure',
      exchangeId: evidence.requestExchangeIds.get(request) ?? 0,
      method: request.method(),
      pathname: url.pathname,
      sequence: ++evidence.sequence
    })
  })

  context.on('requestfinished', (request) => {
    const url = new URL(request.url())
    if (!url.pathname.startsWith('/api/')) return
    markApiRequestTerminal(request)
  })

  return evidence
}

const waitForApiTransportQuiet = async (
  evidence: TransportEvidence,
  options: {
    readonly quietMs?: number
    readonly timeoutMs?: number
  } = {}
): Promise<void> => {
  const quietMs = options.quietMs ?? 750
  const timeoutMs = options.timeoutMs ?? 20_000
  const deadline = Date.now() + timeoutMs
  let observedRevision = evidence.activityRevision
  let stableSince: number | undefined

  while (Date.now() < deadline) {
    const now = Date.now()
    const isIdle =
      evidence.inFlightExchangeIds.size === 0 &&
      evidence.pendingResponseReads.size === 0

    if (!isIdle || evidence.activityRevision !== observedRevision) {
      observedRevision = evidence.activityRevision
      stableSince = undefined
    } else if (stableSince === undefined) {
      stableSince = now
    } else if (now - stableSince >= quietMs) {
      return
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 50))
  }

  const activeRequests = evidence.requests
    .filter(({ exchangeId }) => evidence.inFlightExchangeIds.has(exchangeId))
    .map(({ exchangeId, method, pathname }) => ({
      exchangeId,
      method,
      pathname
    }))
  throw new Error(
    `API transport did not become quiet: ${JSON.stringify({
      activeRequests,
      pendingResponseReads: evidence.pendingResponseReads.size
    })}`
  )
}

const flushTransportEvidence = async (
  evidence: TransportEvidence
): Promise<void> => {
  while (evidence.pendingResponseReads.size > 0) {
    await Promise.all([...evidence.pendingResponseReads])
  }
}

const getApiExchanges = (
  evidence: TransportEvidence,
  method: string,
  pathname: string
) => ({
  requests: evidence.requests.filter(
    (request) => request.method === method && request.pathname === pathname
  ),
  responses: evidence.responses.filter(
    (response) => response.method === method && response.pathname === pathname
  )
})

const attachAndAssertTransportEvidence = async (
  evidence: TransportEvidence,
  testInfo: TestInfo,
  label: string,
  allowedErrorResponses: ReadonlyArray<{
    readonly method: string
    readonly pathname: string
    readonly provenance?: ApiResponseEvidence['provenance']
    readonly status: number
  }> = []
): Promise<void> => {
  await waitForApiTransportQuiet(evidence)
  await flushTransportEvidence(evidence)
  const remainingAllowedErrors = [...allowedErrorResponses]
  const canonicalProvenance = isMockBrowser ? 'service-worker' : 'network'
  const unexpectedProvenance = evidence.responses.filter(
    (response) =>
      response.provenance !== canonicalProvenance &&
      response.provenance !== 'injected-test-fault'
  )
  const unfinishedResponses = evidence.responses.filter(
    (response) => response.terminalState !== 'finished'
  )
  const unmatchedErrorResponses = [...evidence.responses]
    .filter((response) => response.status >= 400)
    .filter((response) => {
      const matchIndex = remainingAllowedErrors.findIndex(
        (allowed) =>
          allowed.method === response.method &&
          allowed.pathname === response.pathname &&
          (allowed.provenance === undefined ||
            allowed.provenance === response.provenance) &&
          allowed.status === response.status
      )
      if (matchIndex === -1) return true
      remainingAllowedErrors.splice(matchIndex, 1)
      return false
    })
  const normalized = {
    failedApiRequests: evidence.failedApiRequests,
    mode: browserMode,
    requests: [...evidence.requests].toSorted(
      (left, right) => left.sequence - right.sequence
    ),
    responses: [...evidence.responses].toSorted(
      (left, right) => left.sequence - right.sequence
    )
  }
  const requestExchangeIds = new Set(
    evidence.requests.map(({ exchangeId }) => exchangeId)
  )
  const terminalCountByExchange = new Map<number, number>()
  for (const terminal of [
    ...evidence.responses,
    ...evidence.failedApiRequests
  ]) {
    terminalCountByExchange.set(
      terminal.exchangeId,
      (terminalCountByExchange.get(terminal.exchangeId) ?? 0) + 1
    )
  }
  const invalidTerminalExchanges = evidence.requests
    .map(({ exchangeId }) => ({
      exchangeId,
      terminalCount: terminalCountByExchange.get(exchangeId) ?? 0
    }))
    .filter(({ terminalCount }) => terminalCount !== 1)
  const orphanTerminals = [...terminalCountByExchange.keys()].filter(
    (exchangeId) => !requestExchangeIds.has(exchangeId)
  )

  await testInfo.attach(
    `transport-${toArtifactSlug(label)}-${testInfo.project.name}`,
    {
      body: JSON.stringify(normalized, null, 2),
      contentType: 'application/json'
    }
  )

  expect(evidence.failedApiRequests, `${label} request failures`).toEqual([])
  expect(unexpectedProvenance, `${label} transport provenance`).toEqual([])
  expect(unfinishedResponses, `${label} unfinished responses`).toEqual([])
  expect(unmatchedErrorResponses, `${label} HTTP error responses`).toEqual([])
  expect(
    remainingAllowedErrors,
    `${label} expected HTTP error responses`
  ).toEqual([])
  expect(evidence.requests.length, `${label} API requests`).toBeGreaterThan(0)
  expect(invalidTerminalExchanges, `${label} terminal exchanges`).toEqual([])
  expect(orphanTerminals, `${label} orphan terminals`).toEqual([])
}

const settlePage = async (page: Page): Promise<void> => {
  await expect(page.locator('main')).toBeVisible()
  await expect(page.locator('main h1').first()).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts.ready)
  await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0)
}

const setLocale = async (page: Page, locale: UiLocale): Promise<void> => {
  const localeSelect = page.locator('select[name="ui-locale"]:visible').first()
  if (!(await localeSelect.isVisible())) {
    const menuButton = page.locator(
      'button[aria-controls="primary-navigation"]'
    )
    await menuButton.click()
    await expect(localeSelect).toBeVisible()
  }
  await localeSelect.selectOption(locale)
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

const freezePracticeMonotonicClock = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const fixedNow = performance.now()
    Object.defineProperty(performance, 'now', {
      configurable: true,
      value: () => fixedNow
    })
  })
}

const restorePracticeMonotonicClock = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    if (!Reflect.deleteProperty(performance, 'now')) {
      throw new Error('Failed to restore the practice monotonic clock.')
    }
  })
}

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

const submitSessionThroughUi = async (
  page: Page,
  session: Awaited<ReturnType<typeof createSession>>
) => {
  const sessionPath = `/practice/session/${session.session.id}`
  await page.goto(sessionPath)
  await settlePage(page)
  await setLocale(page, 'ko')
  await freezePracticeMonotonicClock(page)

  const lastQuestionJump = page.getByRole('button', {
    name: `${session.session.actualCount}번 문제, 미응답`
  })
  await focusByTab(page, lastQuestionJump)
  await page.keyboard.press('Enter')
  const submitButton = page.getByRole('button', { name: '답안 제출' })
  await focusByTab(page, submitButton)
  const responsePromise = page.waitForResponse((response) => {
    const request = response.request()
    return (
      request.method() === 'POST' &&
      new URL(response.url()).pathname ===
        `/api/v1/study-sessions/${session.session.id}/submission`
    )
  })
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', {
    name: '답안을 제출하시겠습니까?'
  })
  await expect(dialog).toBeVisible()
  const confirm = dialog.getByRole('button', {
    name: '제출하고 결과 보기'
  })
  await expect(
    dialog.getByRole('heading', { name: '답안을 제출하시겠습니까?' })
  ).toBeFocused()
  await focusByTab(page, confirm)
  await page.keyboard.press('Enter')

  const response = await responsePromise
  expect(response.status()).toBe(201)
  expect(response.fromServiceWorker()).toBe(isMockBrowser)
  const requestBody = submitStudySessionV2BodySchema.parse(
    response.request().postDataJSON()
  )
  expect(requestBody.answers).toHaveLength(session.session.actualCount)
  expect(
    requestBody.answers.every(
      ({ elapsedSec, selectedOptionId }) =>
        elapsedSec >= 0 && selectedOptionId === null
    )
  ).toBe(true)
  const result = submitStudySessionV2ResponseSchema.parse(
    JSON.parse(await response.text()) as unknown
  )
  await expect(page).toHaveURL(
    new RegExp(`/practice/result/${session.session.id}$`, 'u')
  )
  await settlePage(page)
  await restorePracticeMonotonicClock(page)
  return { requestBody, result }
}

const armDashboardInsightsFailure = async (
  page: Page
): Promise<() => Promise<void>> => {
  if (isMockBrowser) {
    await page.evaluate(async () => {
      const modulePath = '/src/test/phase9BrowserMockControl.ts'
      const control = (await import(/* @vite-ignore */ modulePath)) as {
        armPhase9DashboardInsightsFailure: () => void
      }
      control.armPhase9DashboardInsightsFailure()
    })
    return async () => undefined
  }

  const routePattern = '**/api/v1/dashboard/insights'
  let failuresRemaining = 2
  const failTwice = async (route: Route): Promise<void> => {
    if (failuresRemaining <= 0) {
      await route.continue()
      return
    }
    failuresRemaining -= 1
    const requestId = crypto.randomUUID()
    await route.fulfill({
      body: JSON.stringify({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Phase 9 browser fault injection',
        requestId,
        retryable: true
      }),
      contentType: 'application/json',
      headers: {
        'Cache-Control': 'private, no-store',
        'X-Phase9-Test-Fault': 'dashboard-insights-503',
        'X-Request-Id': requestId
      },
      status: 503
    })
  }
  await page.route(routePattern, failTwice)
  return async () => page.unroute(routePattern, failTwice)
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

const invalidateDashboardWhileOffline = async (page: Page): Promise<void> => {
  await page.evaluate(async () => {
    const modulePath = '/src/libs/queryClient.ts'
    const { queryClient } = (await import(/* @vite-ignore */ modulePath)) as {
      queryClient: {
        invalidateQueries: (options: {
          queryKey: readonly string[]
        }) => Promise<void>
      }
    }
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  })
}

const waitForDashboardQueriesToSettle = async (page: Page): Promise<void> => {
  await expect
    .poll(
      async () =>
        await page.evaluate(async () => {
          const modulePath = '/src/libs/queryClient.ts'
          const { queryClient } = (await import(
            /* @vite-ignore */ modulePath
          )) as {
            queryClient: {
              getQueryState: (queryKey: readonly string[]) =>
                | {
                    fetchStatus: string
                    status: string
                  }
                | undefined
            }
          }
          const project = (queryKey: readonly string[]) => {
            const state = queryClient.getQueryState(queryKey)
            return state
              ? { fetchStatus: state.fetchStatus, status: state.status }
              : null
          }
          return {
            insights: project(['dashboard', 'get-insights']),
            stats: project(['dashboard', 'get-stats'])
          }
        }),
      { timeout: 20_000 }
    )
    .toEqual({
      insights: { fetchStatus: 'idle', status: 'success' },
      stats: { fetchStatus: 'idle', status: 'success' }
    })
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

  await page.goto('/login?redirect=%2Fdashboard#credentials')
  await settlePage(page)
  const loginDraft = page.locator('input[name="email"]')
  await loginDraft.fill('locale-draft@example.test')
  const loginUrlBeforeLocaleSwitch = page.url()
  await flushTransportEvidence(transport)
  const requestsBeforeLocaleSwitch = transport.requests.length
  await setLocale(page, 'ja')
  await expect(loginDraft).toHaveValue('locale-draft@example.test')
  expect(page.url()).toBe(loginUrlBeforeLocaleSwitch)
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('jlpt-drill-note:ui-locale:v1') ?? 'null')
    )
  ).toEqual({ locale: 'ja', version: 1 })
  await flushTransportEvidence(transport)
  expect(transport.requests).toHaveLength(requestsBeforeLocaleSwitch)
  await page.reload()
  await settlePage(page)
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
  await expect(page.locator('select[name="ui-locale"]').first()).toHaveValue(
    'ja'
  )

  const secondPage = await context.newPage()
  await secondPage.goto('/')
  await settlePage(secondPage)
  await expect(secondPage.locator('html')).toHaveAttribute('lang', 'ja')
  await flushTransportEvidence(transport)
  const requestsBeforeCrossTabSwitch = transport.requests.length
  await setLocale(secondPage, 'ko')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko')
  await flushTransportEvidence(transport)
  expect(transport.requests).toHaveLength(requestsBeforeCrossTabSwitch)
  await secondPage.close()

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

  expect(transport.requests.filter(({ method }) => method !== 'GET')).toEqual(
    []
  )
  await attachAndAssertTransportEvidence(
    transport,
    testInfo,
    'guest-locale-auth-boundary'
  )
})

test('learner routes pass KO/JA axe, state, viewport, motion, and forced-colors checks', async ({
  context,
  page
}, testInfo) => {
  test.setTimeout(300_000)
  const transport = trackApiTransport(context)
  await login(page, learner, '203.0.113.241')

  const bookmarkListPath = '/api/v1/bookmarks'
  const emptyBookmarkRequestsBefore = getApiExchanges(
    transport,
    'GET',
    bookmarkListPath
  ).requests.length
  await page.goto('/bookmarks')
  await settlePage(page)
  await setLocale(page, 'ko')
  await expect(
    page.getByRole('heading', { name: '저장한 문제가 없습니다' })
  ).toBeVisible()
  await flushTransportEvidence(transport)
  const emptyBookmarkExchange = getApiExchanges(
    transport,
    'GET',
    bookmarkListPath
  )
  expect(
    emptyBookmarkExchange.requests.length - emptyBookmarkRequestsBefore
  ).toBe(1)
  const emptyBookmarkResponse = emptyBookmarkExchange.responses.at(-1)
  expect(emptyBookmarkResponse?.status).toBe(200)
  const emptyBookmarks = listBookmarksResponseSchema.parse(
    emptyBookmarkResponse?.payload
  )
  expect(emptyBookmarks).toMatchObject({ items: [], page: 1, total: 0 })
  const emptyLocaleRequestsBefore = transport.requests.length
  await setLocale(page, 'ja')
  await expect(
    page.getByRole('heading', { name: '保存した問題はありません' })
  ).toBeVisible()
  await flushTransportEvidence(transport)
  expect(transport.requests).toHaveLength(emptyLocaleRequestsBefore)

  const missingResultId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
  await page.goto(`/practice/result/${missingResultId}`)
  await settlePage(page)
  await setLocale(page, 'ko')
  await expect(
    page.getByRole('heading', { name: '학습 결과를 찾을 수 없습니다' })
  ).toBeVisible()
  await setLocale(page, 'ja')
  await expect(
    page.getByRole('heading', { name: '学習結果が見つかりません' })
  ).toBeVisible()

  const session = await createSession(page)
  const sessionPath = `/practice/session/${session.session.id}`
  await page.setViewportSize({ height: 900, width: 1280 })
  await scanRouteLocales(page, testInfo, {
    label: 'practice-session',
    path: sessionPath
  })

  const readingSession = await createSession(page, {
    count: 5,
    subject: 'READING'
  })
  expect(readingSession.session).toMatchObject({
    actualCount: 3,
    fallbackReason: null,
    requestedCount: 5,
    usedFallback: false
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
  await expect(
    page.getByText(
      '요청한 5문제 중 일반 연습 모드로 출제 가능한 3문제만 제공합니다. 다른 모드로 대체하지 않았습니다.',
      { exact: true }
    )
  ).toHaveAttribute('role', 'status')
  await setLocale(page, 'ja')
  await expect(
    page.getByText(
      '指定した5問のうち、通常練習モードで出題可能な3問だけを提供します。別のモードには変更していません。',
      { exact: true }
    )
  ).toHaveAttribute('role', 'status')
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
  await freezePracticeMonotonicClock(page)
  await focusByTab(page, firstAnswer)
  await page.keyboard.press('Space')
  await expect(firstAnswer).toBeChecked()
  await expect(
    page.locator('.ui-question-jump[data-answered="true"]').first()
  ).toBeVisible()
  await expect(page.locator('[data-save-state]')).toHaveAttribute(
    'data-save-state',
    'saved',
    { timeout: 15_000 }
  )
  await waitForApiTransportQuiet(transport, { quietMs: 1_000 })
  const requestsBeforeAnsweredLocaleSwitch = transport.requests.length
  await setLocale(page, 'ja')
  await expect(firstAnswer).toBeChecked()
  await setLocale(page, 'ko')
  await expect(firstAnswer).toBeChecked()
  await flushTransportEvidence(transport)
  expect(transport.requests).toHaveLength(requestsBeforeAnsweredLocaleSwitch)
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

  const submitted = await submitSessionThroughUi(page, session)
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
  const explanationAvailability = submitted.result.items.map((item) => ({
    available:
      typeof item.question.explanationJa === 'string' &&
      item.question.explanationJa.trim().length > 0,
    item
  }))
  const availableExplanations = explanationAvailability.filter(
    ({ available }) => available
  )
  const unavailableExplanations = explanationAvailability.filter(
    ({ available }) => !available
  )
  expect(availableExplanations).toHaveLength(1)
  expect(unavailableExplanations).toHaveLength(4)
  await expect(page.getByRole('tablist', { name: '해설 언어' })).toHaveCount(
    availableExplanations.length
  )
  await expect(
    page.getByText('일본어 해설이 없어 한국어 해설을 표시합니다.', {
      exact: true
    })
  ).toHaveCount(unavailableExplanations.length)

  const availableExplanation = availableExplanations[0]?.item
  if (!availableExplanation?.question.explanationJa) {
    throw new Error('Phase 9 Japanese explanation fixture is missing.')
  }
  const availableArticle = page.locator('article').filter({
    has: page.getByRole('heading', {
      exact: true,
      name: availableExplanation.question.questionText
    })
  })
  const explanationRequestsBefore = transport.requests.length
  await expect(
    availableArticle.getByRole('tab', { name: '한국어' })
  ).toHaveAttribute('aria-selected', 'true')
  await availableArticle.getByRole('tab', { name: '日本語' }).click()
  await expect(
    availableArticle.getByText(availableExplanation.question.explanationJa, {
      exact: true
    })
  ).toHaveAttribute('lang', 'ja')
  await flushTransportEvidence(transport)
  expect(transport.requests).toHaveLength(explanationRequestsBefore)

  const bookmarkPath = `/api/v1/bookmarks/${targetQuestion.question.id}`
  const createBookmarkResponsePromise = page.waitForResponse((response) => {
    const request = response.request()
    return (
      request.method() === 'PUT' &&
      new URL(response.url()).pathname === bookmarkPath
    )
  })
  const bookmarkTrigger = page.getByRole('button', {
    name: '1번 문제 즐겨찾기 추가'
  })
  await focusByTab(page, bookmarkTrigger)
  await page.keyboard.press('Enter')
  const createBookmarkResponse = await createBookmarkResponsePromise
  expect(createBookmarkResponse.status()).toBe(201)
  expect(createBookmarkResponse.fromServiceWorker()).toBe(isMockBrowser)
  expect(createBookmarkResponse.request().postDataJSON()).toEqual({})
  const createdBookmark = createBookmarkResponseSchema.parse(
    JSON.parse(await createBookmarkResponse.text()) as unknown
  )
  expect(createdBookmark.questionId).toBe(targetQuestion.question.id)
  expect(createBookmarkResponse.headers().location).toBe(bookmarkPath)
  await expect(
    page.getByRole('button', { name: '1번 문제 즐겨찾기 해제' })
  ).toHaveAttribute('aria-pressed', 'true')
  await waitForApiTransportQuiet(transport)

  await page.goto('/bookmarks')
  await settlePage(page)
  await expect(
    page.getByRole('heading', { name: targetQuestion.question.questionText })
  ).toBeVisible()
  const deleteBookmarkResponsePromise = page.waitForResponse((response) => {
    const request = response.request()
    return (
      request.method() === 'DELETE' &&
      new URL(response.url()).pathname === bookmarkPath
    )
  })
  await page.getByRole('button', { name: '즐겨찾기 해제' }).click()
  const removeDialog = page.getByRole('dialog', {
    name: '즐겨찾기를 해제할까요?'
  })
  await expect(removeDialog).toBeVisible()
  await removeDialog.getByRole('button', { name: '해제 확인' }).click()
  const deleteBookmarkResponse = await deleteBookmarkResponsePromise
  expect(deleteBookmarkResponse.status()).toBe(204)
  expect(deleteBookmarkResponse.fromServiceWorker()).toBe(isMockBrowser)
  await expect(
    page.getByRole('heading', { name: '저장한 문제가 없습니다' })
  ).toBeVisible()
  await waitForApiTransportQuiet(transport)

  await page.goto(resultPath)
  await settlePage(page)
  await setLocale(page, 'ko')
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
  await waitForApiTransportQuiet(transport)

  await page.goto('/dashboard')
  await settlePage(page)
  await setLocale(page, 'ko')
  await flushTransportEvidence(transport)
  const requestsBeforeOffline = transport.requests.length
  await context.setOffline(true)
  await invalidateDashboardWhileOffline(page)
  await expect(
    page.getByText(
      '오프라인이라 마지막으로 확인한 누적 통계를 표시합니다. 연결되면 자동으로 다시 확인합니다.',
      { exact: true }
    )
  ).toBeVisible()
  await expect(
    page.getByText(
      '오프라인이라 마지막으로 확인한 추천을 표시합니다. 연결될 때까지 추천 실행은 잠깁니다.',
      { exact: true }
    )
  ).toBeVisible()
  await flushTransportEvidence(transport)
  expect(transport.requests).toHaveLength(requestsBeforeOffline)
  await context.setOffline(false)
  await expect(
    page.getByText(
      '오프라인이라 마지막으로 확인한 누적 통계를 표시합니다. 연결되면 자동으로 다시 확인합니다.',
      { exact: true }
    )
  ).toBeHidden()
  await expect(
    page.getByText(
      '오프라인이라 마지막으로 확인한 추천을 표시합니다. 연결될 때까지 추천 실행은 잠깁니다.',
      { exact: true }
    )
  ).toBeHidden()
  await waitForDashboardQueriesToSettle(page)

  const removeDashboardFault = await armDashboardInsightsFailure(page)
  await invalidateDashboardInsights(page)
  await expect(
    page.getByRole('heading', { name: '최신 인사이트로 갱신하지 못했습니다' })
  ).toBeVisible()
  await expect(page.getByText('전체 풀이', { exact: true })).toBeVisible()
  await removeDashboardFault()
  const successfulRetryResponse = page.waitForResponse(
    (response) =>
      response.status() === 200 &&
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === '/api/v1/dashboard/insights'
  )
  await page.getByRole('button', { name: '최근 인사이트 다시 시도' }).click()
  await successfulRetryResponse
  await expect(
    page.getByRole('heading', { name: '최신 인사이트로 갱신하지 못했습니다' })
  ).toBeHidden()
  await expect(
    page.getByRole('heading', { name: '약점과 다음 학습 추천' })
  ).toBeFocused()

  await flushTransportEvidence(transport)
  const createSessionExchange = getApiExchanges(
    transport,
    'POST',
    '/api/v1/study-sessions'
  )
  expect(createSessionExchange.requests).toHaveLength(2)
  expect(createSessionExchange.responses.map(({ status }) => status)).toEqual([
    201, 201
  ])
  expect(
    createSessionExchange.requests.map(({ payload }) =>
      createStudySessionV2BodySchema.parse(payload)
    )
  ).toEqual([
    {
      count: 5,
      level: 'N5',
      mode: 'RANDOM',
      subject: 'VOCABULARY'
    },
    {
      count: 5,
      level: 'N5',
      mode: 'RANDOM',
      subject: 'READING'
    }
  ])
  for (const request of createSessionExchange.requests) {
    expect(request.practiceContract).toBe('2')
    expect(request.idempotencyKeyDigest).toBeNull()
  }
  for (const response of createSessionExchange.responses) {
    createStudySessionV2ResponseSchema.parse(response.payload)
    expect(response.headers.practiceContract).toBe('2')
  }

  const submissionPath = `/api/v1/study-sessions/${session.session.id}/submission`
  const submissionExchange = getApiExchanges(transport, 'POST', submissionPath)
  expect(submissionExchange.requests).toHaveLength(1)
  expect(submissionExchange.responses).toHaveLength(1)
  const learnerSubmissionRequest = submissionExchange.requests[0]
  const learnerSubmissionResponse = submissionExchange.responses[0]
  submitStudySessionV2BodySchema.parse(learnerSubmissionRequest?.payload)
  submitStudySessionV2ResponseSchema.parse(learnerSubmissionResponse?.payload)
  expect(learnerSubmissionRequest?.practiceContract).toBe('2')
  expect(learnerSubmissionRequest?.idempotencyKeyIsUuid).toBe(true)
  expect(learnerSubmissionRequest?.idempotencyKeyDigest).toMatch(
    /^[a-f0-9]{64}$/u
  )
  expect(learnerSubmissionResponse?.headers.practiceContract).toBe('2')

  expect(getApiExchanges(transport, 'PUT', bookmarkPath).requests).toHaveLength(
    1
  )
  expect(
    getApiExchanges(transport, 'DELETE', bookmarkPath).requests
  ).toHaveLength(1)
  await testInfo.attach(
    `state-matrix-learner-${browserMode}-${testInfo.project.name}`,
    {
      body: JSON.stringify(
        {
          bookmark: 'add/list/delete passed',
          empty: 'bookmark total 0 passed',
          error: 'missing result 404 passed',
          explanation: {
            availableInSession: availableExplanations.length,
            repositoryAvailable: 2,
            repositoryUnavailable: 63,
            unavailableInSession: unavailableExplanations.length
          },
          localeState: 'answered reading selection preserved',
          offline: 'cached dashboard requests remained paused',
          partial: 'requested 5 reading questions, received 3 without fallback',
          retry: 'dashboard insights 503x2 then explicit retry 200',
          submit: 'UI dialog and result navigation passed'
        },
        null,
        2
      ),
      contentType: 'application/json'
    }
  )
  const missingSessionPath = `/api/v1/study-sessions/${missingResultId}`
  const missingResultPath = `${missingSessionPath}/result`
  const missingSessionExchange = getApiExchanges(
    transport,
    'GET',
    missingSessionPath
  )
  const missingResultExchange = getApiExchanges(
    transport,
    'GET',
    missingResultPath
  )
  expect(missingSessionExchange.responses).toHaveLength(1)
  expect(missingSessionExchange.responses[0]?.status).toBe(404)
  expect(missingResultExchange.responses).toHaveLength(1)
  expect(missingResultExchange.responses[0]?.status).toBe(404)
  await attachAndAssertTransportEvidence(
    transport,
    testInfo,
    'learner-core-state-matrix',
    [
      { method: 'GET', pathname: missingSessionPath, status: 404 },
      { method: 'GET', pathname: missingResultPath, status: 404 },
      {
        method: 'GET',
        pathname: '/api/v1/dashboard/insights',
        provenance: 'injected-test-fault',
        status: 503
      },
      {
        method: 'GET',
        pathname: '/api/v1/dashboard/insights',
        provenance: 'injected-test-fault',
        status: 503
      }
    ]
  )
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
  await settlePage(page)
  await waitForApiTransportQuiet(transport)

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

  await flushTransportEvidence(transport)
  const adminCreateSessionExchange = getApiExchanges(
    transport,
    'POST',
    '/api/v1/study-sessions'
  )
  expect(adminCreateSessionExchange.requests).toHaveLength(1)
  expect(adminCreateSessionExchange.responses).toHaveLength(1)
  expect(
    createStudySessionV2BodySchema.parse(
      adminCreateSessionExchange.requests[0]?.payload
    )
  ).toEqual({
    count: 5,
    level: 'N5',
    mode: 'RANDOM',
    subject: 'VOCABULARY'
  })
  expect(adminCreateSessionExchange.requests[0]?.practiceContract).toBe('2')
  expect(
    adminCreateSessionExchange.requests[0]?.idempotencyKeyDigest
  ).toBeNull()
  const adminSession = createStudySessionV2ResponseSchema.parse(
    adminCreateSessionExchange.responses[0]?.payload
  )
  expect(
    adminCreateSessionExchange.responses[0]?.headers.practiceContract
  ).toBe('2')

  const adminSubmissionPath = `/api/v1/study-sessions/${adminSession.session.id}/submission`
  const adminSubmissionExchange = getApiExchanges(
    transport,
    'POST',
    adminSubmissionPath
  )
  expect(adminSubmissionExchange.requests).toHaveLength(1)
  expect(adminSubmissionExchange.responses).toHaveLength(1)
  const adminSubmissionRequest = adminSubmissionExchange.requests[0]
  const adminSubmissionResponse = adminSubmissionExchange.responses[0]
  const adminSubmissionBody = submitStudySessionV2BodySchema.parse(
    adminSubmissionRequest?.payload
  )
  expect(adminSubmissionBody.answers).toHaveLength(5)
  expect(
    adminSubmissionBody.answers.every(
      ({ selectedOptionId }) => selectedOptionId === null
    )
  ).toBe(true)
  submitStudySessionV2ResponseSchema.parse(adminSubmissionResponse?.payload)
  expect(adminSubmissionRequest?.practiceContract).toBe('2')
  expect(adminSubmissionRequest?.idempotencyKeyIsUuid).toBe(true)
  expect(adminSubmissionRequest?.idempotencyKeyDigest).toMatch(
    /^[a-f0-9]{64}$/u
  )
  expect(adminSubmissionResponse?.headers.practiceContract).toBe('2')

  const reportExchange = getApiExchanges(
    transport,
    'POST',
    '/api/v1/question-reports'
  )
  expect(reportExchange.requests).toHaveLength(1)
  expect(reportExchange.responses).toHaveLength(1)
  expect(reportExchange.requests[0]?.payload).toEqual({
    description: 'Phase 9 accessibility route audit fixture',
    questionVersionId: expect.any(String),
    reason: 'OTHER'
  })
  createQuestionReportResponseSchema.parse(reportExchange.responses[0]?.payload)
  await attachAndAssertTransportEvidence(
    transport,
    testInfo,
    'admin-cms-read-dialog-matrix'
  )
})
