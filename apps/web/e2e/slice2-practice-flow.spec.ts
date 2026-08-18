import { expect, test } from '@playwright/test'
import type {
  Browser,
  BrowserContext,
  Page,
  Request,
  Route
} from '@playwright/test'

interface Credentials {
  email: string
  name: string
  password: string
}

interface CreatedQuestion {
  sessionQuestionId: string
  question: {
    options: Array<{ id: string }>
  }
}

interface CreatedSession {
  questions: CreatedQuestion[]
  session: { id: string }
}

interface DraftSnapshot {
  answers: Array<{
    elapsedSec: number
    selectedOptionId: string | null
    studySessionQuestionId: string
  }>
  currentOrdinal: number
  revision: number
  savedAt: string | null
  studySessionId: string
}

type BrowserStorageState = Awaited<ReturnType<BrowserContext['storageState']>>

const readCredentials = (prefix: 'A' | 'B' | 'C' | 'D'): Credentials => {
  const email = process.env[`E2E_USER_${prefix}_EMAIL`]
  const name = process.env[`E2E_USER_${prefix}_NAME`]
  const password = process.env[`E2E_USER_${prefix}_PASSWORD`]
  if (!email || !name || !password) {
    throw new Error(`E2E user ${prefix} credentials are missing.`)
  }
  return { email, name, password }
}

const userA = readCredentials('A')
const userB = readCredentials('B')
const userD = readCredentials('D')
const schemaName = process.env.SLICE2_E2E_SCHEMA
const authenticatedStorage = new Map<string, BrowserStorageState>()

if (!/^phase4_slice2_e2e_[0-9]+_[a-f0-9]{8}_test$/.test(schemaName ?? '')) {
  throw new Error('The isolated Slice 2 E2E schema marker is missing.')
}

const login = async (page: Page, credentials: Credentials): Promise<void> => {
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

const createSession = async (page: Page): Promise<CreatedSession> => {
  const result = await page.evaluate(async () => {
    const response = await fetch('/api/v1/study-sessions', {
      body: JSON.stringify({
        count: 5,
        level: 'N5',
        mode: 'RANDOM',
        subject: 'VOCABULARY'
      }),
      headers: {
        'Content-Type': 'application/json',
        'X-Nihongo-Practice-Contract': '2'
      },
      method: 'POST'
    })
    return {
      body: (await response.json()) as CreatedSession,
      status: response.status
    }
  })
  expect(result.status).toBe(201)
  expect(result.body.questions).toHaveLength(5)
  return result.body
}

const getDraft = async (
  page: Page,
  sessionId: string
): Promise<DraftSnapshot> =>
  await page.evaluate(async (id) => {
    const response = await fetch(`/api/v1/study-sessions/${id}/draft-answers`, {
      headers: { 'X-Nihongo-Practice-Contract': '2' }
    })
    if (!response.ok) {
      throw new Error(`Draft GET failed with ${response.status}.`)
    }
    return (await response.json()) as DraftSnapshot
  }, sessionId)

const saveDraft = async (
  page: Page,
  snapshot: DraftSnapshot,
  answerIndex: number,
  selectedOptionId: string
): Promise<DraftSnapshot> => {
  const result = await page.evaluate(
    async ({ answerIndex, selectedOptionId, snapshot }) => {
      const response = await fetch(
        `/api/v1/study-sessions/${snapshot.studySessionId}/draft-answers`,
        {
          body: JSON.stringify({
            answers: snapshot.answers.map((answer, index) =>
              index === answerIndex ? { ...answer, selectedOptionId } : answer
            ),
            currentOrdinal: snapshot.currentOrdinal,
            expectedRevision: snapshot.revision
          }),
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': crypto.randomUUID(),
            'X-Nihongo-Practice-Contract': '2'
          },
          method: 'PUT'
        }
      )
      return {
        body: (await response.json()) as DraftSnapshot,
        status: response.status
      }
    },
    { answerIndex, selectedOptionId, snapshot }
  )
  expect(result.status).toBe(200)
  return result.body
}

const openSession = async (page: Page, sessionId: string): Promise<void> => {
  await page.goto(`/practice/session/${sessionId}`)
  await expect(page.locator('[data-save-state]')).toBeVisible()
  await expect(page.getByRole('radio')).toHaveCount(4)
  await expect(page.locator('h1')).toBeFocused()
}

const waitForSaved = async (page: Page): Promise<void> => {
  await expect(page.locator('[data-save-state]')).toHaveAttribute(
    'data-save-state',
    'saved',
    { timeout: 15_000 }
  )
}

const goToQuestion = async (page: Page, ordinal: number): Promise<void> => {
  await page
    .getByRole('button', { name: new RegExp(`^${ordinal}번 문제`) })
    .click()
}

const getDraftPattern = (sessionId: string): RegExp =>
  new RegExp(`/api/v1/study-sessions/${sessionId}/draft-answers(?:\\?.*)?$`)

const assertIndependentContexts = async (
  contextA: BrowserContext,
  pageA: Page,
  contextB: BrowserContext,
  pageB: Page
): Promise<void> => {
  await pageA.evaluate(() => {
    sessionStorage.setItem('slice2-context-probe', 'context-a')
  })
  expect(
    await pageB.evaluate(() => sessionStorage.getItem('slice2-context-probe'))
  ).toBeNull()

  const cookieValuesA = (await contextA.cookies()).map(({ value }) => value)
  const cookieValuesB = (await contextB.cookies()).map(({ value }) => value)
  expect(cookieValuesA.length).toBeGreaterThan(0)
  expect(cookieValuesB.length).toBeGreaterThan(0)
  expect(cookieValuesA).not.toEqual(cookieValuesB)
}

const createLoggedInContext = async (
  browser: Browser,
  credentials: Credentials,
  options: { forceFreshLogin?: boolean } = {}
): Promise<{ context: BrowserContext; page: Page }> => {
  const storageState = options.forceFreshLogin
    ? undefined
    : authenticatedStorage.get(credentials.email)
  const context = await browser.newContext(
    storageState ? { storageState } : undefined
  )
  const page = await context.newPage()
  if (storageState) {
    await page.goto('/')
    await expect(
      page.getByRole('link', { exact: true, name: credentials.name })
    ).toBeVisible()
  } else {
    await login(page, credentials)
    authenticatedStorage.set(credentials.email, await context.storageState())
  }
  return { context, page }
}

test.describe.serial('Slice 2 real practice flow', () => {
  test('two independent BrowserContexts reconcile a stale USER draft without losing the local choice', async ({
    browser
  }) => {
    const first = await createLoggedInContext(browser, userA, {
      forceFreshLogin: true
    })
    const second = await createLoggedInContext(browser, userA, {
      forceFreshLogin: true
    })
    const freezeMonotonicClock = (): void => {
      const fixedNow = performance.now()
      Object.defineProperty(performance, 'now', {
        configurable: true,
        value: () => fixedNow
      })
    }
    await Promise.all([
      first.context.addInitScript(freezeMonotonicClock),
      second.context.addInitScript(freezeMonotonicClock)
    ])

    try {
      await assertIndependentContexts(
        first.context,
        first.page,
        second.context,
        second.page
      )
      const created = await createSession(first.page)
      await openSession(first.page, created.session.id)
      await second.page.goto('/practice')
      const resumeLink = second.page.locator(
        `a[href="/practice/session/${created.session.id}"]`
      )
      await expect(resumeLink).toBeVisible()
      await resumeLink.click()
      await expect(second.page).toHaveURL(
        new RegExp(`/practice/session/${created.session.id}$`)
      )
      await expect(second.page.locator('[data-save-state]')).toContainText(
        /서버 작업본과 동기화|서버에 저장됨/
      )
      await expect(second.page.locator('h1')).toBeFocused()

      await first.page.getByRole('radio').nth(0).click()
      await waitForSaved(first.page)

      await second.page.getByRole('radio').nth(1).click()
      const conflictDialog = second.page.getByRole('dialog', {
        name: '다른 기기의 작업과 충돌했습니다'
      })
      await expect(conflictDialog).toBeVisible({ timeout: 15_000 })
      await expect(second.page.getByRole('radio').nth(1)).toBeChecked()
      await conflictDialog
        .getByRole('button', { name: '서버 기록 사용' })
        .click()
      await expect(conflictDialog).toBeHidden()
      await expect(second.page.getByRole('radio').nth(0)).toBeChecked()

      await second.page.getByRole('radio').nth(2).click()
      await waitForSaved(second.page)
      await second.page.reload()
      await expect(second.page.getByRole('radio').nth(2)).toBeChecked()

      const canonical = await getDraft(second.page, created.session.id)
      expect(canonical.revision).toBe(2)
      expect(canonical.answers[0]?.selectedOptionId).toBe(
        created.questions[0]?.question.options[2]?.id
      )
    } finally {
      await first.context.close()
      await second.context.close()
    }
  })

  test('one BrowserContext clears the previous account state and ignores a delayed PUT response', async ({
    browser
  }) => {
    const context = await browser.newContext()
    await context.addInitScript(() => {
      const NativeBroadcastChannel = window.BroadcastChannel
      const events: Array<{
        name: string
        payload?: unknown
        type: 'close' | 'open' | 'post'
      }> = []

      class ObservedBroadcastChannel extends NativeBroadcastChannel {
        readonly observedName: string

        constructor(name: string) {
          super(name)
          this.observedName = name
          events.push({ name, type: 'open' })
        }

        postMessage(message: unknown): void {
          events.push({
            name: this.observedName,
            payload: message,
            type: 'post'
          })
          super.postMessage(message)
        }

        close(): void {
          events.push({ name: this.observedName, type: 'close' })
          super.close()
        }
      }

      Object.defineProperty(window, 'BroadcastChannel', {
        configurable: true,
        value: ObservedBroadcastChannel
      })
      Object.defineProperty(window, '__slice2BroadcastEvents', {
        configurable: true,
        value: events
      })
    })
    const page = await context.newPage()
    const authPage = await context.newPage()
    let releaseDelayedResponse = (): void => undefined
    let resolveDeliveredResponse = (): void => undefined
    const deliveredResponse = new Promise<void>((resolve) => {
      resolveDeliveredResponse = resolve
    })

    try {
      await login(page, userA)
      const created = await createSession(page)
      const draftPattern = getDraftPattern(created.session.id)
      await openSession(page, created.session.id)

      await page.evaluate(async () => {
        const importModule = async (specifier: string): Promise<unknown> =>
          await import(/* @vite-ignore */ specifier)
        const { queryClient } = (await importModule(
          '/src/libs/queryClient.ts'
        )) as {
          queryClient: {
            setQueryData: (key: readonly unknown[], data: unknown) => void
          }
        }
        queryClient.setQueryData(['study', 'sessions', 'owner-a-sentinel'], {
          owner: 'A'
        })
      })

      let resolveCommitted = (): void => undefined
      const committed = new Promise<void>((resolve) => {
        resolveCommitted = resolve
      })
      const delayedResponseGate = new Promise<void>((resolve) => {
        releaseDelayedResponse = resolve
      })
      const delayFirstPut = async (route: Route): Promise<void> => {
        if (route.request().method() !== 'PUT') {
          await route.continue()
          return
        }
        const response = await route.fetch()
        expect(response.status()).toBe(200)
        resolveCommitted()
        await delayedResponseGate
        await route.fulfill({ response })
        resolveDeliveredResponse()
      }
      await page.route(draftPattern, delayFirstPut)

      await page.getByRole('radio').nth(0).click()
      await committed
      const beforeSwitch = await page.evaluate(async (sessionId) => {
        const importModule = async (specifier: string): Promise<unknown> =>
          await import(/* @vite-ignore */ specifier)
        const { queryClient } = (await importModule(
          '/src/libs/queryClient.ts'
        )) as {
          queryClient: {
            getQueryData: (key: readonly unknown[]) => unknown
          }
        }
        const draftKeys = Object.keys(sessionStorage).filter(
          (key) =>
            key.startsWith('jlpt-drill-note:study-draft-working-copy:v1:') &&
            key.includes(sessionId)
        )
        const serialized = draftKeys[0]
          ? sessionStorage.getItem(draftKeys[0])
          : null
        const record = serialized
          ? (JSON.parse(serialized) as { frozenAttempt?: unknown })
          : null
        const events = (
          window as unknown as {
            __slice2BroadcastEvents: Array<{
              name: string
              type: string
            }>
          }
        ).__slice2BroadcastEvents

        return {
          channelName:
            events.find(
              (event) => event.type === 'open' && event.name.includes(sessionId)
            )?.name ?? null,
          draftKeys,
          frozen: Boolean(record?.frozenAttempt),
          ownerSentinel:
            queryClient.getQueryData([
              'study',
              'sessions',
              'owner-a-sentinel'
            ]) ?? null
        }
      }, created.session.id)
      expect(beforeSwitch.ownerSentinel).toEqual({ owner: 'A' })
      expect(beforeSwitch.draftKeys).toHaveLength(1)
      expect(beforeSwitch.frozen).toBe(true)
      expect(beforeSwitch.channelName).not.toBeNull()

      await authPage.goto('/login')
      await expect(
        authPage.getByRole('link', { exact: true, name: userA.name })
      ).toBeVisible()
      await authPage.getByRole('button', { name: '로그아웃' }).click()
      await expect(authPage.getByLabel('이메일')).toBeVisible()
      await login(authPage, userB)
      authenticatedStorage.set(userB.email, await context.storageState())
      await expect(
        page.getByRole('link', { exact: true, name: userB.name })
      ).toBeVisible({ timeout: 15_000 })

      const afterSwitch = await page.evaluate(async (sessionId) => {
        const importModule = async (specifier: string): Promise<unknown> =>
          await import(/* @vite-ignore */ specifier)
        const [{ queryClient }, { useAppStore }] = (await Promise.all([
          importModule('/src/libs/queryClient.ts'),
          importModule('/src/store/index.ts')
        ])) as [
          {
            queryClient: {
              getMutationCache: () => {
                getAll: () => Array<{
                  options: { mutationKey?: readonly unknown[] }
                  state: { status: string }
                }>
              }
              getQueryData: (key: readonly unknown[]) => unknown
              setQueryData: (key: readonly unknown[], data: unknown) => void
            }
          },
          {
            useAppStore: {
              getState: () => {
                currentUser: { id: string } | null
                draftConflict: unknown
                draftWorkingCopy: unknown
                selectedAnswers: Record<string, string>
                sessionId: string | null
              }
            }
          }
        ]
        queryClient.setQueryData(['study', 'sessions', 'next-owner-probe'], {
          owner: 'B'
        })
        const state = useAppStore.getState()
        const events = (
          window as unknown as {
            __slice2BroadcastEvents: Array<{
              name: string
              type: string
            }>
          }
        ).__slice2BroadcastEvents

        return {
          closedChannelCount: events.filter(
            (event) => event.type === 'close' && event.name.includes(sessionId)
          ).length,
          currentUserId: state.currentUser?.id ?? null,
          draftConflict: state.draftConflict,
          draftKeys: Object.keys(sessionStorage).filter((key) =>
            key.startsWith('jlpt-drill-note:study-draft-working-copy:v1:')
          ),
          draftWorkingCopy: state.draftWorkingCopy,
          ownerSentinel:
            queryClient.getQueryData([
              'study',
              'sessions',
              'owner-a-sentinel'
            ]) ?? null,
          pendingDraftSaveMutations: queryClient
            .getMutationCache()
            .getAll()
            .filter(
              (mutation) =>
                mutation.state.status === 'pending' &&
                mutation.options.mutationKey?.[2] === sessionId &&
                mutation.options.mutationKey?.[4] === 'save'
            ).length,
          selectedAnswers: state.selectedAnswers,
          sessionId: state.sessionId
        }
      }, created.session.id)
      expect(afterSwitch.currentUserId).toEqual(expect.any(String))
      expect(afterSwitch.ownerSentinel).toBeNull()
      expect(afterSwitch.pendingDraftSaveMutations).toBe(1)
      expect(afterSwitch.sessionId).toBeNull()
      expect(afterSwitch.selectedAnswers).toEqual({})
      expect(afterSwitch.draftWorkingCopy).toBeNull()
      expect(afterSwitch.draftConflict).toBeNull()
      expect(afterSwitch.draftKeys).toHaveLength(0)
      expect(afterSwitch.closedChannelCount).toBeGreaterThan(0)

      const eventsBeforeRelease = await page.evaluate(
        (sessionId) =>
          (
            window as unknown as {
              __slice2BroadcastEvents: Array<{
                name: string
                type: string
              }>
            }
          ).__slice2BroadcastEvents.filter((event) =>
            event.name.includes(sessionId)
          ).length,
        created.session.id
      )
      releaseDelayedResponse()
      await deliveredResponse

      await expect
        .poll(
          async () =>
            await page.evaluate(async (sessionId) => {
              const importModule = async (
                specifier: string
              ): Promise<unknown> => await import(/* @vite-ignore */ specifier)
              const [{ queryClient }, { useAppStore }] = (await Promise.all([
                importModule('/src/libs/queryClient.ts'),
                importModule('/src/store/index.ts')
              ])) as [
                {
                  queryClient: {
                    getMutationCache: () => {
                      getAll: () => Array<{
                        options: { mutationKey?: readonly unknown[] }
                        state: { status: string }
                      }>
                    }
                    getQueryCache: () => {
                      find: (input: {
                        exact: boolean
                        queryKey: readonly unknown[]
                      }) => { state: { isInvalidated: boolean } } | undefined
                    }
                    getQueryData: (key: readonly unknown[]) => unknown
                  }
                },
                {
                  useAppStore: {
                    getState: () => {
                      currentUser: { id: string } | null
                      draftWorkingCopy: unknown
                      sessionId: string | null
                    }
                  }
                }
              ]
              const key = ['study', 'sessions', 'next-owner-probe'] as const
              const state = useAppStore.getState()
              const query = queryClient
                .getQueryCache()
                .find({ exact: true, queryKey: key })
              const events = (
                window as unknown as {
                  __slice2BroadcastEvents: Array<{
                    name: string
                    type: string
                  }>
                }
              ).__slice2BroadcastEvents.filter((event) =>
                event.name.includes(sessionId)
              )

              return {
                currentUserId: state.currentUser?.id ?? null,
                draftKeys: Object.keys(sessionStorage).filter((storageKey) =>
                  storageKey.startsWith(
                    'jlpt-drill-note:study-draft-working-copy:v1:'
                  )
                ),
                draftWorkingCopy: state.draftWorkingCopy,
                events: events.length,
                invalidated: query?.state.isInvalidated ?? null,
                nextOwnerSentinel: queryClient.getQueryData(key) ?? null,
                pendingDraftSaveMutations: queryClient
                  .getMutationCache()
                  .getAll()
                  .filter(
                    (mutation) =>
                      mutation.state.status === 'pending' &&
                      mutation.options.mutationKey?.[2] === sessionId &&
                      mutation.options.mutationKey?.[4] === 'save'
                  ).length,
                sessionId: state.sessionId
              }
            }, created.session.id)
        )
        .toMatchObject({
          currentUserId: afterSwitch.currentUserId,
          draftKeys: [],
          draftWorkingCopy: null,
          events: eventsBeforeRelease,
          invalidated: false,
          nextOwnerSentinel: { owner: 'B' },
          pendingDraftSaveMutations: 0,
          sessionId: null
        })
      await expect(
        page.getByRole('link', { exact: true, name: userB.name })
      ).toBeVisible()
      await expect(page.getByRole('radio')).toHaveCount(0)
      await page.unroute(draftPattern, delayFirstPut)
    } finally {
      releaseDelayedResponse()
      await context.close()
    }
  })

  test('response loss hard reload replays the exact frozen PUT before GET and rebases post-flight work', async ({
    browser
  }) => {
    const first = await createLoggedInContext(browser, userD)
    const second = await createLoggedInContext(browser, userD)

    try {
      const created = await createSession(first.page)
      const draftPattern = getDraftPattern(created.session.id)
      await openSession(first.page, created.session.id)
      await openSession(second.page, created.session.id)

      let resolveCommitted = (): void => undefined
      let releaseLostResponse = (): void => undefined
      const committed = new Promise<void>((resolve) => {
        resolveCommitted = resolve
      })
      const lostResponseGate = new Promise<void>((resolve) => {
        releaseLostResponse = resolve
      })
      let originalKey: string | null = null
      let originalBody: string | null = null
      let responseWasLost = false

      const loseFirstPut = async (route: Route): Promise<void> => {
        if (route.request().method() !== 'PUT' || responseWasLost) {
          await route.continue()
          return
        }
        responseWasLost = true
        originalKey = route.request().headers()['idempotency-key'] ?? null
        originalBody = route.request().postData()
        await route.fetch()
        resolveCommitted()
        await lostResponseGate
        await route.abort('failed')
      }
      await first.page.route(draftPattern, loseFirstPut)

      await first.page.getByRole('radio').nth(0).click()
      await committed
      await goToQuestion(first.page, 3)
      await first.page.getByRole('radio').nth(2).click()
      releaseLostResponse()
      await expect(first.page.locator('[data-save-state]')).toHaveAttribute(
        'data-save-state',
        /^(?:error|offline)$/
      )
      await first.page.unroute(draftPattern, loseFirstPut)

      const afterFirstCommit = await getDraft(second.page, created.session.id)
      expect(afterFirstCommit.revision).toBe(1)
      const secondAcknowledgement = await saveDraft(
        second.page,
        afterFirstCommit,
        1,
        created.questions[1]?.question.options[1]?.id ?? ''
      )
      expect(secondAcknowledgement.revision).toBe(2)

      const wireOrder: string[] = []
      let replayKey: string | null = null
      let replayBody: string | null = null
      const observeRecovery = async (route: Route): Promise<void> => {
        const method = route.request().method()
        wireOrder.push(method)
        if (method === 'PUT' && replayKey === null) {
          replayKey = route.request().headers()['idempotency-key'] ?? null
          replayBody = route.request().postData()
        }
        const response = await route.fetch()
        await route.fulfill({ response })
      }
      await first.page.route(draftPattern, observeRecovery)
      first.page.on('dialog', (dialog) => {
        void dialog.accept()
      })
      await first.page.reload({ waitUntil: 'domcontentloaded' })

      await expect
        .poll(() => wireOrder.slice(0, 4))
        .toEqual(['PUT', 'GET', 'PUT', 'GET'])
      await waitForSaved(first.page)
      expect(replayKey).toBe(originalKey)
      expect(replayBody).toBe(originalBody)

      const canonical = await getDraft(first.page, created.session.id)
      expect(canonical.revision).toBe(3)
      expect(canonical.answers[0]?.selectedOptionId).toBe(
        created.questions[0]?.question.options[0]?.id
      )
      expect(canonical.answers[1]?.selectedOptionId).toBe(
        created.questions[1]?.question.options[1]?.id
      )
      expect(canonical.answers[2]?.selectedOptionId).toBe(
        created.questions[2]?.question.options[2]?.id
      )
      await first.page.unroute(draftPattern, observeRecovery)
    } finally {
      await first.context.close()
      await second.context.close()
    }
  })

  test('offline edits remain local and reconnect checks canonical revision before saving', async ({
    browser
  }) => {
    const first = await createLoggedInContext(browser, userA)
    const second = await createLoggedInContext(browser, userA)

    try {
      const created = await createSession(first.page)
      const draftPattern = getDraftPattern(created.session.id)
      await openSession(first.page, created.session.id)
      await openSession(second.page, created.session.id)

      let offlinePutAttempts = 0
      const countOfflinePut = (request: Request): void => {
        if (request.method() === 'PUT' && draftPattern.test(request.url())) {
          offlinePutAttempts += 1
        }
      }
      first.page.on('request', countOfflinePut)
      await first.context.setOffline(true)
      await first.page.getByRole('radio').nth(0).click()
      await expect(first.page.locator('[data-save-state]')).toHaveAttribute(
        'data-save-state',
        'offline'
      )
      await first.page.waitForTimeout(1_100)
      expect(offlinePutAttempts).toBe(0)

      const remoteBase = await getDraft(second.page, created.session.id)
      const remoteAcknowledgement = await saveDraft(
        second.page,
        remoteBase,
        1,
        created.questions[1]?.question.options[1]?.id ?? ''
      )
      expect(remoteAcknowledgement.revision).toBe(1)

      const reconnectOrder: string[] = []
      const observeReconnect = async (route: Route): Promise<void> => {
        reconnectOrder.push(route.request().method())
        const response = await route.fetch()
        await route.fulfill({ response })
      }
      await first.page.route(draftPattern, observeReconnect)
      await first.context.setOffline(false)
      await expect.poll(() => reconnectOrder.includes('PUT')).toBe(true)
      expect(reconnectOrder[0]).toBe('GET')
      await waitForSaved(first.page)

      const canonical = await getDraft(first.page, created.session.id)
      expect(canonical.revision).toBe(2)
      expect(canonical.answers[0]?.selectedOptionId).toBe(
        created.questions[0]?.question.options[0]?.id
      )
      expect(canonical.answers[1]?.selectedOptionId).toBe(
        created.questions[1]?.question.options[1]?.id
      )
      first.page.off('request', countOfflinePut)
      await first.page.unroute(draftPattern, observeReconnect)
    } finally {
      await first.context.close()
      await second.context.close()
    }
  })

  test('keyboard, responsive, reduced-motion, live status, and v2 submission use the saved revision', async ({
    browser
  }) => {
    const authenticated = await createLoggedInContext(browser, userB)
    const { context, page } = authenticated

    try {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      const created = await createSession(page)
      await openSession(page, created.session.id)

      for (const width of [320, 375, 768, 1280]) {
        await page.setViewportSize({ height: 800, width })
        expect(
          await page.evaluate(
            () =>
              document.documentElement.scrollWidth <=
              document.documentElement.clientWidth
          )
        ).toBe(true)
        const optionTarget = page.locator('label').first()
        const box = await optionTarget.boundingBox()
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
        expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
      }

      const transitionDuration = await page
        .locator('label')
        .first()
        .evaluate((element) => getComputedStyle(element).transitionDuration)
      const transitionDurationSeconds = transitionDuration.endsWith('ms')
        ? Number.parseFloat(transitionDuration) / 1_000
        : Number.parseFloat(transitionDuration)
      expect(transitionDurationSeconds).toBeLessThanOrEqual(0.001)

      await page.keyboard.press('1')
      await expect(page.getByRole('radio').nth(0)).toBeChecked()
      await waitForSaved(page)
      await page.keyboard.press('ArrowRight')
      await expect(
        page.getByRole('button', { name: /^2번 문제/ })
      ).toHaveAttribute('aria-current', 'step')
      await expect(page.locator('h1')).toBeFocused()
      await expect(page.locator('[data-save-state]')).toHaveAttribute(
        'aria-live',
        'polite'
      )

      await goToQuestion(page, 5)
      let releaseSaveResponse = (): void => undefined
      const saveResponseGate = new Promise<void>((resolve) => {
        releaseSaveResponse = resolve
      })
      const draftPattern = getDraftPattern(created.session.id)
      const delaySaveResponse = async (route: Route): Promise<void> => {
        if (route.request().method() !== 'PUT') {
          await route.continue()
          return
        }
        const response = await route.fetch()
        await saveResponseGate
        await route.fulfill({ response })
      }
      await page.route(draftPattern, delaySaveResponse)
      await page.keyboard.press('1')
      await expect(page.locator('[data-save-state]')).toHaveAttribute(
        'data-save-state',
        'saving'
      )
      await page.keyboard.press('Control+Enter')
      await expect(
        page.getByRole('dialog', { name: '답안을 제출하시겠습니까?' })
      ).toHaveCount(0)
      releaseSaveResponse()
      await waitForSaved(page)
      await page.unroute(draftPattern, delaySaveResponse)
      let submissionBody: Record<string, unknown> | undefined
      page.on('request', (request) => {
        if (
          request.method() === 'POST' &&
          request
            .url()
            .endsWith(`/study-sessions/${created.session.id}/submission`)
        ) {
          submissionBody = request.postDataJSON() as Record<string, unknown>
        }
      })
      await expect(
        page.getByRole('button', { name: '답안 제출' })
      ).toHaveAttribute('aria-keyshortcuts', 'Control+Enter Meta+Enter')
      await page.keyboard.press('Control+Enter')
      const submitDialog = page.getByRole('dialog', {
        name: '답안을 제출하시겠습니까?'
      })
      await expect(submitDialog).toBeVisible()
      await submitDialog
        .getByRole('button', { name: '제출하고 결과 보기' })
        .click()
      await expect(page).toHaveURL(
        new RegExp(`/practice/result/${created.session.id}$`),
        { timeout: 20_000 }
      )
      expect(submissionBody?.expectedDraftRevision).toEqual(expect.any(Number))
      expect(submissionBody?.expectedDraftRevision).toBeGreaterThan(0)
    } finally {
      await context.close()
    }
  })
})
