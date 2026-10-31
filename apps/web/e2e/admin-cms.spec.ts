import process from 'node:process'
import { expect, test } from '@playwright/test'
import type { BrowserContext, Page, Response, Route } from '@playwright/test'
import { z } from 'zod'
import { getCurrentPrincipalResponseSchema } from '@nihongo/contracts/auth/get-current-principal'
import { adminFreshSsoRequestSchema } from '@nihongo/contracts/auth/admin-fresh-sso'
import {
  isSsoAuthorizationURLForProvider,
  signInSocialResponseSchema
} from '@nihongo/contracts/auth/sign-in-social'
import {
  archiveAdminQuestionErrorSchema,
  archiveAdminQuestionRequestSchema,
  archiveAdminQuestionResponseSchema,
  createAdminQuestionRequestSchema,
  createAdminQuestionResponseSchema,
  getAdminQuestionResponseSchema,
  listAdminQuestionsErrorSchema,
  listAdminQuestionsResponseSchema,
  previewQuestionVersionResponseSchema,
  updateQuestionVersionErrorSchema,
  updateQuestionVersionRequestSchema,
  updateQuestionVersionResponseSchema
} from '@nihongo/contracts/admin/phase7'
import {
  assertAndAttachLedger,
  ledgerEntriesFor,
  selectRequestLedger,
  trackRequestLedger,
  waitForLedgerToQuiesce
} from './request-ledger'
import type { RequestLedger } from './request-ledger'

if (process.env.PHASE7_BROWSER_MODE !== 'real') {
  throw new Error('Phase 7 administrator UI requires real mode.')
}
const requireOrigin = (value: string | undefined): string => {
  if (!value) throw new Error('The public administrator origin is required.')
  const url = new URL(value)
  if (
    value !== url.origin ||
    !['http:', 'https:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  ) {
    throw new Error(
      'Administrator acceptance requires an isolated loopback origin.'
    )
  }
  return url.origin
}
const publicOrigin = requireOrigin(process.env.PHASE7_BROWSER_ADMIN_ORIGIN)
if (publicOrigin !== requireOrigin(process.env.PLAYWRIGHT_BASE_URL)) {
  throw new Error(
    'Administrator documents must use the public web origin, not the private Vite port.'
  )
}
const actorSchema = z
  .object({
    userId: z.string().uuid(),
    role: z.enum(['ADMIN', 'USER']),
    targetLevel: z.literal('N3'),
    callbackCode: z.string()
  })
  .strict()
const readFixture = () => {
  const fixture = z
    .object({
      author: actorSchema.extend({
        role: z.literal('ADMIN'),
        callbackCode: z.literal('phase7-test-google-author')
      }),
      reviewer: actorSchema.extend({
        role: z.literal('ADMIN'),
        callbackCode: z.literal('phase7-test-google-reviewer')
      }),
      learner: actorSchema.extend({
        role: z.literal('USER'),
        callbackCode: z.literal('phase7-test-google-learner')
      })
    })
    .parse(JSON.parse(process.env.PHASE7_BROWSER_FIXTURE ?? 'null') as unknown)
  expect(
    new Set([
      fixture.author.userId,
      fixture.reviewer.userId,
      fixture.learner.userId
    ]).size
  ).toBe(3)
  return fixture
}
type Actor = z.infer<typeof actorSchema>

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

const confirmActor = async (page: Page, actor: Actor): Promise<void> => {
  const result = await browserJson(page, '/api/v1/me')
  expect(result.status).toBe(200)
  const principal = getCurrentPrincipalResponseSchema.parse(result.body)
  if (principal.kind !== 'USER')
    throw new Error('Canonical actor confirmation is required.')
  expect(principal.user).toMatchObject({
    id: actor.userId,
    role: actor.role,
    targetLevel: actor.targetLevel
  })
}
const callbackPathFromProviderURL = (
  authorizationURL: string,
  actor: Actor
): string => {
  expect(isSsoAuthorizationURLForProvider('google', authorizationURL)).toBe(
    true
  )
  const state = new URL(authorizationURL).searchParams.get('state')
  if (!state) throw new Error('Google TEST authorization omitted state.')
  return `/api/auth/callback/google?${new URLSearchParams({ state, code: actor.callbackCode })}`
}
const callbackPath = (authorizationBody: unknown, actor: Actor): string =>
  callbackPathFromProviderURL(
    signInSocialResponseSchema.parse(authorizationBody).url,
    actor
  )
const login = async (
  page: Page,
  actor: Actor,
  ledger: RequestLedger
): Promise<void> => {
  await page.goto('/login')
  await expect(
    page.getByRole('button', { name: 'Google로 계속하기', exact: true })
  ).toBeVisible()
  await expect(page.locator('input[name="password"]')).toHaveCount(0)
  const started = await browserJson(page, '/api/auth/sign-in/social', {
    provider: 'google',
    callbackURL: '/practice'
  })
  expect(started.status).toBe(200)
  // Keep bootstrap requests in their document until all ledger events complete.
  await waitForLedgerToQuiesce(ledger)
  // Enter the installed TEST provider callback; no credentials, cookies or session state are injected.
  await page.goto(callbackPath(started.body, actor))
  await expect(page).toHaveURL(
    (url) => url.origin === publicOrigin && url.pathname === '/practice'
  )
  await confirmActor(page, actor)
  await waitForLedgerToQuiesce(ledger)
}
const waitForResponse = (
  page: Page,
  method: string,
  path: string
): Promise<Response> =>
  page.waitForResponse(
    (response) =>
      response.request().method() === method &&
      new URL(response.url()).pathname === path
  )
const canonicalJson = async (
  response: Response,
  status: number
): Promise<unknown> => {
  expect(response.status()).toBe(status)
  expect(response.fromServiceWorker()).toBe(false)
  expect(response.headers()['cache-control']).toBe('private, no-store')
  return JSON.parse(await response.text()) as unknown
}
const detail = async (page: Page, questionId: string) => {
  const response = await browserJson(
    page,
    `/api/v1/admin/questions/${questionId}`
  )
  expect(response.status).toBe(200)
  return getAdminQuestionResponseSchema.parse(response.body)
}

// Timing only: both genuine PATCH requests reach the server; neither response is fulfilled or rewritten.
const raceUpdates = async (
  context: BrowserContext,
  pages: readonly [Page, Page],
  versionId: string
) => {
  const path = `/api/v1/admin/question-versions/${versionId}`
  const url = new URL(path, publicOrigin).href
  let arrivals = 0
  let release = (): void => undefined
  const barrier = new Promise<void>((resolve) => {
    release = resolve
  })
  const timeout = setTimeout(release, 10_000)
  const handler = async (route: Route): Promise<void> => {
    if (route.request().method() !== 'PATCH') {
      await route.continue()
      return
    }
    arrivals += 1
    if (arrivals === 2) {
      clearTimeout(timeout)
      release()
    }
    await barrier
    if (arrivals !== 2) {
      await route.abort()
      throw new Error('Both PATCH requests must arrive before release.')
    }
    await route.continue()
  }
  await context.route(url, handler)
  try {
    const responses = await Promise.all(
      pages.map(async (page) => {
        const response = waitForResponse(page, 'PATCH', path)
        await page
          .getByRole('button', { name: '변경사항 저장', exact: true })
          .click()
        return response
      })
    )
    expect(arrivals).toBe(2)
    expect(responses.map((response) => response.status()).toSorted()).toEqual([
      200, 409
    ])
    return responses
  } finally {
    clearTimeout(timeout)
    release()
    await context.unroute(url, handler)
  }
}

test('guest and USER contexts cannot read or mutate administrator content', async ({
  browser
}, testInfo) => {
  const { learner } = readFixture()
  for (const actor of [null, learner]) {
    const context = await browser.newContext({
      baseURL: publicOrigin,
      locale: 'ko-KR'
    })
    const ledger = trackRequestLedger(context)
    try {
      const page = await context.newPage()
      if (actor) await login(page, actor, ledger)
      else {
        await page.goto('/login')
        const response = await browserJson(page, '/api/v1/me')
        expect(response.status).toBe(200)
        expect(
          getCurrentPrincipalResponseSchema.parse(response.body).kind
        ).toBe('GUEST')
      }
      const denied = await browserJson(
        page,
        '/api/v1/admin/questions?lifecycleStatus=ACTIVE'
      )
      expect(denied.status).toBe(actor ? 403 : 401)
      expect(listAdminQuestionsErrorSchema.parse(denied.body).code).toBe(
        actor ? 'ADMIN_REQUIRED' : 'AUTHENTICATION_REQUIRED'
      )
      await waitForLedgerToQuiesce(ledger)
      const deniedDocument = await page.goto('/admin/questions')
      if (!deniedDocument)
        throw new Error('A direct administrator document response is required.')
      expect(deniedDocument.request().isNavigationRequest()).toBe(true)
      expect(
        listAdminQuestionsErrorSchema.parse(
          await canonicalJson(deniedDocument, actor ? 403 : 401)
        ).code
      ).toBe(actor ? 'ADMIN_REQUIRED' : 'AUTHENTICATION_REQUIRED')
      await expect(page).toHaveURL(
        (url) =>
          url.origin === publicOrigin && url.pathname === '/admin/questions'
      )
      await expect(page.locator('#root')).toHaveCount(0)
      await expect(
        page.getByRole('link', { name: '새 문제 등록', exact: true })
      ).toHaveCount(0)
      await waitForLedgerToQuiesce(ledger)
      const cms = selectRequestLedger(ledger, ({ path }) =>
        path.startsWith('/api/v1/admin/')
      )
      expect(cms.entries.length).toBeGreaterThan(0)
      expect(
        cms.entries.every(
          ({ method, status }) =>
            method === 'GET' && status === (actor ? 403 : 401)
        )
      ).toBe(true)
      await assertAndAttachLedger(
        cms,
        testInfo,
        `phase7-${actor ? 'user' : 'guest'}-denial`
      )
    } finally {
      await context.close()
    }
  }
})

test('A1-A8: one owned draft, one PATCH winner, same-author fresh return, explicit archive', async ({
  context,
  page
}, testInfo) => {
  test.setTimeout(120_000)
  const { author } = readFixture()
  const ledger = trackRequestLedger(context)
  const socialStarts: unknown[] = []
  context.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === '/api/auth/sign-in/social'
    ) {
      socialStarts.push(request.postDataJSON() as unknown)
    }
  })
  await login(page, author, ledger)
  const query = '?level=N3&subject=GRAMMAR&sort=LEVEL_ASC'
  for (const [legacySort, expectedSort] of [
    ['STATUS', 'UPDATED_DESC'],
    ['RECENT', 'UPDATED_DESC'],
    ['LEVEL', 'LEVEL_ASC']
  ] as const) {
    const response = waitForResponse(page, 'GET', '/api/v1/admin/questions')
    await page.goto(
      `/admin/questions?level=N3&subject=GRAMMAR&sort=${legacySort}`
    )
    const loaded = await response
    listAdminQuestionsResponseSchema.parse(await canonicalJson(loaded, 200))
    expect(new URL(loaded.url()).searchParams.get('sort')).toBe(expectedSort)
    if (legacySort === 'STATUS')
      await expect(
        page.getByText(
          '상태순 정렬은 지원하지 않아 최근 수정순으로 표시합니다.',
          { exact: true }
        )
      ).toBeVisible()
    await waitForLedgerToQuiesce(ledger)
  }
  const catalogResponse = waitForResponse(
    page,
    'GET',
    '/api/v1/admin/questions'
  )
  await page.goto('/admin/questions' + query)
  const loaded = await catalogResponse
  expect(new URL(loaded.url()).searchParams.get('lifecycleStatus')).toBe(
    'ACTIVE'
  )
  const catalog = listAdminQuestionsResponseSchema.parse(
    await canonicalJson(loaded, 200)
  )
  const seed = catalog.items.find(
    (item) =>
      item.level === 'N3' &&
      item.subject === 'GRAMMAR' &&
      item.questionType === 'GRAMMAR_SELECT'
  )
  if (!seed)
    throw new Error(
      'The canonical N3 grammar-select catalog must supply an existing applicable tag.'
    )
  const tag = seed.tags[0]
  if (!tag)
    throw new Error(
      'The existing catalog tag is required; do not create a test-only tag.'
    )
  await expect(
    page.getByRole('heading', { name: '문제 관리', exact: true })
  ).toBeVisible()
  await page.getByRole('link', { name: '새 문제 등록', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: '새 문제 등록', exact: true })
  ).toBeVisible()
  await page.getByLabel('JLPT 급수', { exact: true }).selectOption('N3')
  await page.getByLabel('과목', { exact: true }).selectOption('GRAMMAR')
  await page
    .getByLabel('문제 유형', { exact: true })
    .selectOption('GRAMMAR_SELECT')
  await page
    .getByRole('textbox', { name: '질문', exact: true })
    .fill('週末は図書館（　）勉強します。')
  for (const [label, text] of [
    ['1', 'で'],
    ['2', 'を'],
    ['3', 'へ'],
    ['4', 'が']
  ]) {
    await page
      .getByRole('textbox', { name: `보기 ${label}`, exact: true })
      .fill(text)
  }
  await page.getByRole('radio', { name: '보기 1', exact: true }).check()
  await page
    .getByLabel('한국어 해설', { exact: true })
    .fill('행동이 이루어지는 장소에는 조사 で를 씁니다.')
  await page.getByLabel('태그', { exact: true }).fill(tag.label)
  const createResponse = waitForResponse(
    page,
    'POST',
    '/api/v1/admin/questions'
  )
  await page.getByRole('button', { name: '초안 등록', exact: true }).click()
  const createdResponse = await createResponse
  const createInput = createAdminQuestionRequestSchema.parse(
    createdResponse.request().postDataJSON() as unknown
  )
  expect(createInput).toMatchObject({
    level: seed.level,
    subject: seed.subject,
    questionType: seed.questionType
  })
  expect(createInput.tagNames).toEqual([tag.label])
  expect(createInput.options).toHaveLength(4)
  const created = createAdminQuestionResponseSchema.parse(
    await canonicalJson(createdResponse, 201)
  )
  const questionId = created.questionId
  const versionId = created.questionVersionId
  if (!versionId)
    throw new Error('Creation must return its owned draft version.')
  await expect(page).toHaveURL(
    (url) =>
      url.origin === publicOrigin &&
      url.pathname === `/admin/questions/${questionId}/edit`
  )
  await expect(
    page.getByRole('heading', { name: '문제 수정', exact: true })
  ).toBeVisible()
  const before = await detail(page, questionId)
  expect(before.question).toMatchObject({
    lifecycleStatus: 'ACTIVE',
    rowVersion: 1,
    openCandidateVersionId: versionId,
    currentPublishedVersionId: null
  })
  expect(before.versions.items).toHaveLength(1)
  expect(before.versions.items[0]).toMatchObject({
    questionVersionId: versionId,
    rowVersion: 1,
    versionStatus: 'DRAFT',
    author: { actorId: author.userId },
    tags: [tag]
  })
  const previewResponse = await browserJson(
    page,
    `/api/v1/admin/question-versions/${versionId}/preview`
  )
  expect(previewResponse.status).toBe(200)
  const preview = previewQuestionVersionResponseSchema.parse(
    previewResponse.body
  )
  const optionIds = preview.question.options.map(({ id }) => id).toSorted()
  expect(optionIds).toHaveLength(4)
  const peer = await context.newPage()
  try {
    await peer.goto(page.url())
    await expect(
      peer.getByRole('heading', { name: '문제 수정', exact: true })
    ).toBeVisible()
    const texts = [
      '週末は近くの図書館（　）勉強します。',
      '日曜日は図書館（　）勉強します。'
    ]
    await page
      .getByRole('textbox', { name: '질문', exact: true })
      .fill(texts[0])
    await peer
      .getByRole('textbox', { name: '질문', exact: true })
      .fill(texts[1])
    const responses = await raceUpdates(context, [page, peer], versionId)
    for (const response of responses) {
      const input = updateQuestionVersionRequestSchema.parse(
        response.request().postDataJSON() as unknown
      )
      expect(input.expectedRowVersion).toBe(1)
      expect(input.options.map(({ id }) => id).toSorted()).toEqual(optionIds)
      expect(input.options.map(({ ordinal }) => ordinal).toSorted()).toEqual([
        1, 2, 3, 4
      ])
      expect(input.tagNames).toEqual([tag.label])
    }
    const winnerIndex = responses.findIndex(
      (response) => response.status() === 200
    )
    const loserIndex = 1 - winnerIndex
    const pages = [page, peer]
    const winner = pages[winnerIndex]!
    const loser = pages[loserIndex]!
    const saved = updateQuestionVersionResponseSchema.parse(
      await canonicalJson(responses[winnerIndex]!, 200)
    )
    expect(saved).toMatchObject({
      questionId,
      questionVersionId: versionId,
      questionRowVersion: 1,
      versionRowVersion: 2,
      versionStatus: 'DRAFT'
    })
    expect(
      updateQuestionVersionErrorSchema.parse(
        await canonicalJson(responses[loserIndex]!, 409)
      ).code
    ).toBe('VERSION_CONFLICT')
    await expect(
      loser.getByRole('alert').filter({ hasText: '현재 입력은 유지됩니다' })
    ).toBeVisible()
    await expect(
      loser.getByRole('textbox', { name: '질문', exact: true })
    ).toHaveValue(texts[loserIndex])
    await expect(winner).toHaveURL(
      (url) =>
        url.origin === publicOrigin &&
        url.pathname === '/admin/questions' &&
        url.search === query
    )
    const updated = await detail(winner, questionId)
    expect(updated.versions.items[0]).toMatchObject({
      questionVersionId: versionId,
      rowVersion: 2,
      versionStatus: 'DRAFT',
      tags: [tag]
    })
    const archivePath = `/api/v1/admin/questions/${questionId}/archive`
    const openArchive = async (): Promise<void> => {
      await winner
        .getByRole('button', { name: `${questionId} 문제 보관`, exact: true })
        .click()
      await expect(
        winner.getByRole('dialog', {
          name: '문제를 보관하시겠습니까?',
          exact: true
        })
      ).toBeVisible()
    }
    await openArchive()
    const stale = waitForResponse(winner, 'POST', archivePath)
    await winner
      .getByRole('dialog')
      .getByRole('button', { name: '문제 보관', exact: true })
      .click()
    const staleResponse = await stale
    expect(
      archiveAdminQuestionErrorSchema.parse(
        await canonicalJson(staleResponse, 401)
      ).code
    ).toBe('FRESH_ASSURANCE_REQUIRED')
    const expectedArchive = {
      expectedQuestionRowVersion: 1,
      expectedOpenCandidateVersionId: versionId,
      expectedOpenCandidateRowVersion: 2
    }
    expect(
      archiveAdminQuestionRequestSchema.parse(
        staleResponse.request().postDataJSON() as unknown
      )
    ).toEqual(expectedArchive)
    await winner
      .getByRole('link', { name: '관리자 재인증', exact: true })
      .click()
    await expect(winner).toHaveURL(
      (url) =>
        url.origin === publicOrigin &&
        url.pathname === '/login' &&
        url.searchParams.get('redirect') === '/admin/questions' + query
    )
    await confirmActor(winner, author)
    await waitForLedgerToQuiesce(ledger)
    const returnedDocuments: Array<{
      origin: string
      path: string
      status: number
    }> = []
    const observeReturn = (response: Response): void => {
      const url = new URL(response.url())
      if (
        response.request().isNavigationRequest() &&
        url.pathname === '/admin/questions' &&
        url.searchParams.get('ssoFresh') === 'REAUTHENTICATED'
      ) {
        returnedDocuments.push({
          origin: url.origin,
          path: url.pathname,
          status: response.status()
        })
      }
    }
    context.on('response', observeReturn)
    const providerPattern = /^https:\/\/accounts\.google\.com\//u
    await context.route(providerPattern, (route) => route.abort())
    try {
      const startResponse = waitForResponse(
        winner,
        'POST',
        '/api/auth/sign-in/social'
      )
      const providerRequest = winner.waitForRequest(
        (request) =>
          request.isNavigationRequest() &&
          request.frame() === winner.mainFrame() &&
          providerPattern.test(request.url())
      )
      const [started, authorizationRequest] = await Promise.all([
        startResponse,
        providerRequest,
        winner
          .getByRole('button', { name: 'Google로 계속하기', exact: true })
          .click()
      ])
      expect(
        adminFreshSsoRequestSchema.parse(
          started.request().postDataJSON() as unknown
        )
      ).toEqual({
        purpose: 'ADMIN_FRESH',
        provider: 'google',
        callbackURL: '/admin/questions' + query
      })
      expect(started.status()).toBe(200)
      await waitForLedgerToQuiesce(ledger)
      const completeResponse = waitForResponse(
        winner,
        'GET',
        '/api/auth/sso/admin-fresh/complete'
      )
      // Only enter the TEST provider callback. The actual server 303 must load the returned admin document.
      await winner.goto(
        callbackPathFromProviderURL(authorizationRequest.url(), author)
      )
      const completed = await completeResponse
      expect(completed.status()).toBe(303)
      const destination = new URL(completed.headers()['location']!)
      expect(destination.origin).toBe(publicOrigin)
      expect(destination.pathname).toBe('/admin/questions')
      expect(destination.searchParams.get('ssoFresh')).toBe('REAUTHENTICATED')
      expect(destination.searchParams.get('level')).toBe('N3')
      expect(destination.searchParams.get('subject')).toBe('GRAMMAR')
      expect(destination.searchParams.get('sort')).toBe('LEVEL_ASC')
      await expect(
        winner.getByRole('heading', { name: '문제 관리', exact: true })
      ).toBeVisible()
      await expect(winner).toHaveURL(
        (url) =>
          url.origin === publicOrigin && url.pathname === '/admin/questions'
      )
      expect(returnedDocuments).toEqual([
        { origin: publicOrigin, path: '/admin/questions', status: 200 }
      ])
      await confirmActor(winner, author)
      await waitForLedgerToQuiesce(ledger)
      expect(
        ledgerEntriesFor(
          ledger,
          'POST',
          '/api/v1/admin/questions/:id/archive'
        ).map(({ status }) => status)
      ).toEqual([401])
      expect(
        socialStarts.filter(
          (input) => adminFreshSsoRequestSchema.safeParse(input).success
        )
      ).toHaveLength(1)
      await openArchive()
      const archiveResponse = waitForResponse(winner, 'POST', archivePath)
      await winner
        .getByRole('dialog')
        .getByRole('button', { name: '문제 보관', exact: true })
        .click()
      const archivedResponse = await archiveResponse
      expect(
        archiveAdminQuestionRequestSchema.parse(
          archivedResponse.request().postDataJSON() as unknown
        )
      ).toEqual(expectedArchive)
      const archived = archiveAdminQuestionResponseSchema.parse(
        await canonicalJson(archivedResponse, 200)
      )
      expect(archived).toMatchObject({
        questionId,
        lifecycleStatus: 'ARCHIVED',
        questionRowVersion: 2
      })
      await expect(
        winner.getByRole('button', {
          name: `${questionId} 문제 보관`,
          exact: true
        })
      ).toHaveCount(0)
      const final = await detail(winner, questionId)
      expect(final.question).toMatchObject({
        lifecycleStatus: 'ARCHIVED',
        rowVersion: 2,
        openCandidateVersionId: null,
        currentPublishedVersionId: null
      })
      expect(final.versions.items).toHaveLength(1)
      expect(final.versions.items[0]).toMatchObject({
        questionVersionId: versionId,
        versionStatus: 'RETIRED',
        retirementKind: 'QUESTION_ARCHIVE_ABANDONED',
        rowVersion: 3
      })
      await waitForLedgerToQuiesce(ledger)
      const commands = selectRequestLedger(
        ledger,
        ({ method, path }) =>
          method !== 'GET' && path.startsWith('/api/v1/admin/')
      )
      expect(commands.entries).toHaveLength(5)
      expect(
        ledgerEntriesFor(commands, 'POST', '/api/v1/admin/questions').map(
          ({ status }) => status
        )
      ).toEqual([201])
      expect(
        ledgerEntriesFor(
          commands,
          'PATCH',
          '/api/v1/admin/question-versions/:id'
        )
          .map(({ status }) => status)
          .toSorted()
      ).toEqual([200, 409])
      expect(
        ledgerEntriesFor(
          commands,
          'POST',
          '/api/v1/admin/questions/:id/archive'
        ).map(({ status }) => status)
      ).toEqual([401, 200])
      expect(
        commands.entries.every(
          ({ provenance }) => provenance === 'canonical-real-network'
        )
      ).toBe(true)
      expect(socialStarts).toHaveLength(2)
      await assertAndAttachLedger(
        ledger,
        testInfo,
        'phase7-a1-a8-real-request-ledger'
      )
    } finally {
      context.off('response', observeReturn)
      await context.unroute(providerPattern)
    }
  } finally {
    await peer.close()
  }
})
