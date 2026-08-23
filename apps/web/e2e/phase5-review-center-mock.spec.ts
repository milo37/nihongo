import { expect, test } from '@playwright/test'
import type { Browser, BrowserContext, Locator, Page } from '@playwright/test'

interface Credentials {
  email: string
  password: string
}

interface CreatedSession {
  questions: Array<{
    question: { id: string; questionText: string }
    sessionQuestionId: string
  }>
  session: { actualCount: number; id: string; mode: string }
}

interface MemoResponse {
  text: string
  updatedAt: string
}

const DEMO_USER_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c1001'
const MOCK_DATABASE_STORAGE_KEY = 'jlpt-drill-note:mock-database:v2'

const demoUser = {
  email: 'user@example.com',
  password: 'Demo-user-2026!'
} as const satisfies Credentials

const demoAdmin = {
  email: 'admin@example.com',
  password: 'Demo-admin-2026!'
} as const satisfies Credentials

const login = async (
  page: Page,
  credentials: Credentials = demoUser
): Promise<void> => {
  await page.goto('/login')
  const form = page.locator('form').filter({ has: page.getByLabel('이메일') })
  await form.getByLabel('이메일').fill(credentials.email)
  await form.getByLabel('비밀번호').fill(credentials.password)
  await Promise.all([
    page.waitForURL((url) => url.pathname === '/'),
    form.getByRole('button', { exact: true, name: '로그인' }).click()
  ])
}

const createLoggedInContext = async (
  browser: Browser,
  credentials: Credentials
): Promise<{ context: BrowserContext; page: Page }> => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await login(page, credentials)
  return { context, page }
}

const focusByKeyboard = async (page: Page, control: Locator): Promise<void> => {
  await expect(control).toBeVisible()
  for (let step = 0; step < 160; step += 1) {
    const isKeyboardFocused = await control.evaluate(
      (element) =>
        element === element.ownerDocument.activeElement &&
        element.matches(':focus-visible')
    )
    if (isKeyboardFocused) {
      return
    }
    await page.keyboard.press('Tab')
  }
  throw new Error('Control is not reachable through the keyboard tab order.')
}

const selectNativeOptionByKeyboard = async (
  page: Page,
  label: string,
  value: string
): Promise<void> => {
  const select = page.getByLabel(label)
  const optionValues = await select
    .locator('option')
    .evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value)
    )
  const targetIndex = optionValues.indexOf(value)
  const currentIndex = optionValues.indexOf(await select.inputValue())
  if (targetIndex < 0 || currentIndex < 0) {
    throw new Error(`Keyboard select option is missing: ${label}=${value}`)
  }
  const searchParameter =
    label === '급수'
      ? 'level'
      : label === '과목'
        ? 'subject'
        : label === '문제 유형'
          ? 'questionType'
          : label === '태그'
            ? 'tag'
            : undefined
  const expectSelection = async (expectedValue: string): Promise<void> => {
    if (searchParameter) {
      await expect
        .poll(() => new URL(page.url()).searchParams.get(searchParameter))
        .toBe(expectedValue || null)
    }
    await expect(page.getByLabel(label)).toHaveValue(expectedValue)
  }
  const waitForSelectionResponse = (expectedValue: string) =>
    searchParameter
      ? page.waitForResponse((response) => {
          const url = new URL(response.url())
          return (
            response.request().method() === 'GET' &&
            url.pathname === '/api/v1/review-queue' &&
            url.searchParams.get(searchParameter) === (expectedValue || null)
          )
        })
      : Promise.resolve()
  if (targetIndex === 0) {
    await focusByKeyboard(page, select)
    const responsePromise = waitForSelectionResponse(value)
    await page.keyboard.press('Home')
    await expectSelection(value)
    await responsePromise
    return
  }
  if (targetIndex === optionValues.length - 1) {
    await focusByKeyboard(page, select)
    const responsePromise = waitForSelectionResponse(value)
    await page.keyboard.press('End')
    await expectSelection(value)
    await responsePromise
    return
  }
  const direction = targetIndex >= currentIndex ? 'ArrowDown' : 'ArrowUp'
  const step = targetIndex >= currentIndex ? 1 : -1
  for (
    let index = currentIndex + step;
    direction === 'ArrowDown' ? index <= targetIndex : index >= targetIndex;
    index += step
  ) {
    await focusByKeyboard(page, select)
    const responsePromise = waitForSelectionResponse(optionValues[index] ?? '')
    await page.keyboard.press(direction)
    await expectSelection(optionValues[index] ?? '')
    await responsePromise
  }
  await expectSelection(value)
}

const activateByKeyboard = async (
  page: Page,
  control: Locator
): Promise<void> => {
  await focusByKeyboard(page, control)
  await page.keyboard.press('Enter')
}

const submitReviewDialog = async (page: Page): Promise<void> => {
  await page.keyboard.press('Control+Enter')
  const dialog = page.getByRole('dialog', {
    name: '답안을 제출하시겠습니까?'
  })
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(dialog.locator(':focus')).toHaveCount(1)
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.locator(':focus')).toHaveCount(1)
  await activateByKeyboard(
    page,
    dialog.getByRole('button', { name: '제출하고 결과 보기' })
  )
  await expect(page.getByRole('heading', { name: '학습 결과' })).toBeVisible({
    timeout: 20_000
  })
}

const answerReviewQuestions = async (
  page: Page,
  questionCount: number
): Promise<void> => {
  for (let index = 0; index < questionCount; index += 1) {
    const firstOption = page.getByRole('radio').first()
    await expect(firstOption).toBeVisible()
    await focusByKeyboard(page, firstOption)
    await page.keyboard.press('1')
    await expect(firstOption).toBeChecked()
    await expect(page.locator('[data-save-state]')).toHaveAttribute(
      'data-save-state',
      'saved',
      { timeout: 15_000 }
    )
    if (index < questionCount - 1) {
      await page.keyboard.press('ArrowRight')
    }
  }
}

const submitSingleReview = async (page: Page): Promise<void> => {
  await answerReviewQuestions(page, 1)
  await submitReviewDialog(page)
}

const createWrongNotes = async (page: Page): Promise<CreatedSession> => {
  return await page.evaluate(async () => {
    const createdResponse = await fetch('/api/v1/study-sessions', {
      body: JSON.stringify({
        count: 5,
        level: 'N5',
        mode: 'RANDOM',
        subject: 'GRAMMAR'
      }),
      headers: {
        'Content-Type': 'application/json',
        'X-Nihongo-Practice-Contract': '2'
      },
      method: 'POST'
    })
    if (createdResponse.status !== 201) {
      throw new Error(`Mock session creation failed: ${createdResponse.status}`)
    }
    const created = (await createdResponse.json()) as CreatedSession
    const submissionResponse = await fetch(
      `/api/v1/study-sessions/${created.session.id}/submission`,
      {
        body: JSON.stringify({
          answers: created.questions.map(({ sessionQuestionId }) => ({
            elapsedSec: 0,
            selectedOptionId: null,
            studySessionQuestionId: sessionQuestionId
          })),
          durationSec: 0,
          expectedDraftRevision: 0
        }),
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
          'X-Nihongo-Practice-Contract': '2'
        },
        method: 'POST'
      }
    )
    if (submissionResponse.status !== 201) {
      throw new Error(`Mock submission failed: ${submissionResponse.status}`)
    }
    return created
  })
}

test('canonical mock exposes the same review-center, memo, history, target, and responsive UI', async ({
  page
}) => {
  await login(page)
  const browserNow = Date.now()
  await page.clock.setFixedTime(new Date(browserNow - 3 * 86_400_000))
  const source = await createWrongNotes(page)
  await page.clock.setFixedTime(
    new Date(browserNow - 3 * 86_400_000 + 3_600_000)
  )
  await createWrongNotes(page)
  await page.clock.setFixedTime(new Date(browserNow))
  const targetQuestion = source.questions.find(({ question }) =>
    question.questionText.includes('図書館')
  )
  const questionId = targetQuestion?.question.id
  if (!questionId) throw new Error('Mock review question is missing.')

  await page.goto('/wrong-notes?view=REPEATED&sort=NEXT_REVIEW&page=1')
  await expect(
    page.getByRole('heading', { name: '지금 복습할 오답을 확인하세요' })
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: /^반복 오답\s*5$/u })
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.getByRole('heading', { name: '조건에 맞는 오답 5개' })
  ).toBeVisible()
  await expect(page.getByText('다시 학습', { exact: true })).toHaveCount(5)
  await selectNativeOptionByKeyboard(page, '급수', 'N5')
  await selectNativeOptionByKeyboard(page, '과목', 'GRAMMAR')
  await selectNativeOptionByKeyboard(page, '문제 유형', 'GRAMMAR_SELECT')
  await selectNativeOptionByKeyboard(page, '태그', '조사')
  await expect(
    page.getByRole('heading', { name: '조건에 맞는 오답 2개' })
  ).toBeVisible()
  const canonicalCenterUrl = page.url()
  await page.reload()
  await expect(page.getByLabel('급수')).toHaveValue('N5')
  await expect(page.getByLabel('과목')).toHaveValue('GRAMMAR')
  await expect(page.getByLabel('문제 유형')).toHaveValue('GRAMMAR_SELECT')
  await expect(page.getByLabel('태그')).toHaveValue('조사')
  await activateByKeyboard(
    page,
    page.getByRole('link', { name: '전체 오답 기록' })
  )
  await expect(
    page.getByRole('heading', { name: '전체 오답 기록' })
  ).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(canonicalCenterUrl)
  await page.goForward()
  await expect(
    page.getByRole('heading', { name: '전체 오답 기록' })
  ).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(canonicalCenterUrl)

  await activateByKeyboard(
    page,
    page.getByRole('button', { name: /^복습 예정/u })
  )
  await expect(
    page.getByRole('button', { name: /^복습 예정/u })
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.locator('[aria-live="polite"][aria-atomic="true"]').filter({
      has: page.getByRole('heading', { name: '조건에 맞는 오답 2개' })
    })
  ).toHaveCount(1)
  await selectNativeOptionByKeyboard(page, '묶음 문제 수', '5')
  const batchResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      response.request().method() === 'POST' &&
      url.pathname === '/api/v1/study-sessions'
    )
  })
  await activateByKeyboard(
    page,
    page.getByRole('button', { name: '조건에 맞는 오늘의 복습 시작' })
  )
  const batchResponse = await batchResponsePromise
  expect(batchResponse.status()).toBe(201)
  const batchRequest = batchResponse.request().postDataJSON() as Record<
    string,
    unknown
  >
  expect(batchRequest).toEqual({
    count: 5,
    level: 'N5',
    mode: 'DAILY_REVIEW',
    reviewFilter: {
      questionType: 'GRAMMAR_SELECT',
      tag: '조사'
    },
    subject: 'GRAMMAR'
  })
  expect(JSON.stringify(batchRequest)).not.toContain('questionId')
  const batch = (await batchResponse.json()) as CreatedSession
  expect(batch.session.actualCount).toBe(2)
  await answerReviewQuestions(page, batch.session.actualCount)
  await submitReviewDialog(page)
  await activateByKeyboard(
    page,
    page.getByRole('button', { name: '오답노트 보기' })
  )
  await expect(
    page.getByRole('heading', { name: '지금 복습할 오답을 확인하세요' })
  ).toBeVisible()

  await page.goto(`/wrong-notes/${questionId}`)
  await expect(
    page.getByRole('heading', { name: '마지막 오답 문제 상세' })
  ).toBeVisible()
  await expect(page.getByText('표준 학습 제출').first()).toBeVisible()
  const memo = page.getByRole('textbox', { name: '나의 메모' })
  await focusByKeyboard(page, memo)
  await page.keyboard.type('Slice 6 mock memo')
  const firstSavePromise = page.waitForResponse((response) =>
    response.url().endsWith(`/wrong-notes/${questionId}/memo`)
  )
  await activateByKeyboard(
    page,
    page.getByRole('button', { name: '메모 저장' })
  )
  const firstMemo = (await (await firstSavePromise).json()) as MemoResponse
  await expect(page.getByText('메모를 저장했습니다.')).toBeVisible()
  await expect(page.getByText('메모를 저장했습니다.')).toHaveAttribute(
    'aria-live',
    'polite'
  )
  await page.reload()
  await expect(memo).toHaveValue('Slice 6 mock memo')

  await focusByKeyboard(page, memo)
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('  Slice 6 mock memo  ')
  const noOpSavePromise = page.waitForResponse((response) =>
    response.url().endsWith(`/wrong-notes/${questionId}/memo`)
  )
  await activateByKeyboard(
    page,
    page.getByRole('button', { name: '메모 저장' })
  )
  const noOpMemo = (await (await noOpSavePromise).json()) as MemoResponse
  expect(noOpMemo.updatedAt).toBe(firstMemo.updatedAt)
  await expect(memo).toHaveValue('Slice 6 mock memo')

  await page.context().setOffline(true)
  await focusByKeyboard(page, memo)
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('Slice 6 mock offline memo')
  await activateByKeyboard(
    page,
    page.getByRole('button', { name: '메모 저장' })
  )
  await expect(
    page.getByText(
      '오프라인에서는 메모를 저장할 수 없습니다. 입력은 유지됩니다. 연결 후 다시 시도해 주세요.'
    )
  ).toBeVisible()
  await expect(memo).toHaveValue('Slice 6 mock offline memo')
  await page.context().setOffline(false)
  await activateByKeyboard(
    page,
    page.getByRole('button', { name: '메모 저장' })
  )
  await expect(page.getByText('메모를 저장했습니다.')).toBeVisible()
  await activateByKeyboard(
    page,
    page.getByRole('button', { name: '메모 삭제' })
  )
  await expect(page.getByText('메모를 삭제했습니다.')).toBeVisible()
  await expect(memo).toHaveValue('')

  const targetedEndpoint = `/api/v1/wrong-notes/${questionId}/review-session`
  const principalScope = `USER:${DEMO_USER_ID}`
  const targetedAttemptStorageKey =
    `jlpt-drill-note:targeted-review-attempt:v1:` +
    `${encodeURIComponent(principalScope)}:${encodeURIComponent(questionId)}`
  await page.evaluate(async () => {
    const modulePath = '/src/mocks/handlers/reviewCenterHandlers.ts'
    const handlersModule = (await import(/* @vite-ignore */ modulePath)) as {
      armNextTargetedReviewResponseLossForTesting: () => void
    }
    handlersModule.armNextTargetedReviewResponseLossForTesting()
  })
  const firstTargetedRequestPromise = page.waitForRequest((request) =>
    request.url().endsWith(targetedEndpoint)
  )
  await activateByKeyboard(
    page,
    page.getByRole('button', { name: '이 문제만 다시 풀기' })
  )
  const firstTargetedRequest = await firstTargetedRequestPromise
  const targetedIdempotencyKey =
    firstTargetedRequest.headers()['idempotency-key']
  if (!targetedIdempotencyKey) {
    throw new Error('Targeted mock request did not include an idempotency key.')
  }
  expect(targetedIdempotencyKey).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
  )
  expect(firstTargetedRequest.postData()).toBe('{}')
  await expect(
    page.getByText('단일 복습 세션을 만들지 못했습니다. 다시 시도해 주세요.')
  ).toBeVisible()
  const storedAttempt = await page.evaluate(
    (storageKey) => sessionStorage.getItem(storageKey),
    targetedAttemptStorageKey
  )
  expect(storedAttempt).toContain(targetedIdempotencyKey)
  const committedSessionId = await page.evaluate(async (idempotencyKey) => {
    const modulePath = '/src/mocks/repository/mockDatabase.ts'
    const repositoryModule = (await import(/* @vite-ignore */ modulePath)) as {
      mockDatabase: {
        getCanonicalIdempotencyRecords: () => Array<{
          idempotencyKey: string
          operation: string
          sessionId: string
        }>
      }
    }
    const record = repositoryModule.mockDatabase
      .getCanonicalIdempotencyRecords()
      .find(
        ({ idempotencyKey: candidate, operation }) =>
          candidate === idempotencyKey &&
          operation === 'wrongNote.createTargetedReviewSession'
      )
    if (!record) {
      throw new Error('Committed targeted mock record is missing.')
    }
    return record.sessionId
  }, targetedIdempotencyKey)
  await page.reload()
  const targetedResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith(targetedEndpoint)
  )
  await activateByKeyboard(
    page,
    page.getByRole('button', { name: '이 문제만 다시 풀기' })
  )
  const targetedResponse = await targetedResponsePromise
  expect(targetedResponse.status()).toBe(201)
  expect(targetedResponse.request().headers()['idempotency-key']).toBe(
    targetedIdempotencyKey
  )
  expect(targetedResponse.request().postData()).toBe('{}')
  expect(targetedResponse.headers()['idempotency-replayed']).toBe('true')
  const targeted = (await targetedResponse.json()) as CreatedSession
  expect(targeted.session.id).toBe(committedSessionId)
  expect(targeted.session).toMatchObject({ actualCount: 1, mode: 'WRONG_NOTE' })
  await expect(page).toHaveURL(
    new RegExp(`/practice/session/${targeted.session.id}$`, 'u')
  )
  await submitSingleReview(page)
  await page.goto(`/wrong-notes/${questionId}`)
  const events = page.locator('li[id^="review-event-"]')
  await expect(events).toHaveCount(4)
  await expect(events.first().getByText('오답 복습 제출')).toBeVisible()

  const archivedMemo = page.getByRole('textbox', { name: '나의 메모' })
  await focusByKeyboard(page, archivedMemo)
  await page.keyboard.type('Slice 6 archived mock memo')
  await activateByKeyboard(
    page,
    page.getByRole('button', { name: '메모 저장' })
  )
  await expect(page.getByText('메모를 저장했습니다.')).toBeVisible()
  const archivedQuestionText = targetQuestion.question.questionText
  if (!archivedQuestionText) {
    throw new Error('Mock archived question text is missing.')
  }
  await page.evaluate(
    async ({ questionText }) => {
      const modulePath = '/src/mocks/repository/mockDatabase.ts'
      const repositoryModule = (await import(
        /* @vite-ignore */ modulePath
      )) as {
        mockDatabase: {
          deleteQuestion: (questionId: string) => boolean
          listAdminQuestions: (filters: {
            pageSize: number
            search: string
          }) => {
            items: Array<{ id: string; questionText: string }>
          }
        }
      }
      const sourceQuestion = repositoryModule.mockDatabase
        .listAdminQuestions({ pageSize: 100, search: questionText })
        .items.find((item) => item.questionText === questionText)
      if (!sourceQuestion) {
        throw new Error('Mock source question is missing before archive.')
      }
      repositoryModule.mockDatabase.deleteQuestion(sourceQuestion.id)
    },
    { questionText: archivedQuestionText }
  )
  await page.reload()
  await expect(page.getByText('보관된 문제', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('heading', { name: archivedQuestionText })
  ).toBeVisible()
  await expect(page.getByRole('textbox', { name: '나의 메모' })).toHaveValue(
    'Slice 6 archived mock memo'
  )
  await expect(events).toHaveCount(4)
  await expect(
    page.getByText('보관된 문제는 기록과 메모만 확인할 수 있습니다.')
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: '이 문제만 다시 풀기' })
  ).toHaveCount(0)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/wrong-notes')
  await expect(
    page.getByRole('heading', { name: '지금 복습할 오답을 확인하세요' })
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: /조건에 맞는 오답 \d+개/u })
  ).toBeVisible()
  await expect(
    page.getByText(archivedQuestionText, { exact: true })
  ).toHaveCount(0)
  for (const [width, height] of [
    [320, 800],
    [375, 812],
    [768, 1_024],
    [1_280, 900]
  ] as const) {
    await page.setViewportSize({ height, width })
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth
      )
    ).toBe(true)
    const controls = page.locator(
      'button:visible, a[href]:visible:not(.sr-only), select:visible, textarea:visible'
    )
    const controlCount = await controls.count()
    expect(controlCount).toBeGreaterThanOrEqual(10)
    for (let index = 0; index < controlCount; index += 1) {
      const box = await controls.nth(index).boundingBox()
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
    }
  }
  await expect(
    page.getByRole('button', { name: /^복습 예정/u })
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.getByText(/^(?:다시 학습|복습 중|해결)$/u).first()
  ).toBeVisible()
  const transitionDuration = await page
    .getByRole('button', { name: /^아직 복습 전/u })
    .evaluate((element) => getComputedStyle(element).transitionDuration)
  const durationSeconds = transitionDuration.endsWith('ms')
    ? Number.parseFloat(transitionDuration) / 1_000
    : Number.parseFloat(transitionDuration)
  expect(durationSeconds).toBeLessThanOrEqual(0.001)
})

test('canonical mock hydrates a synchronized same-owner snapshot and isolates a foreign owner across browser contexts', async ({
  browser
}) => {
  const owner = await createLoggedInContext(browser, demoUser)
  const sameOwner = await createLoggedInContext(browser, demoUser)
  const foreign = await createLoggedInContext(browser, demoAdmin)
  try {
    const source = await createWrongNotes(owner.page)
    const questionId = source.questions[0]?.question.id
    if (!questionId) throw new Error('Mock isolation question is missing.')

    const initialOwnerSnapshot = await owner.page.evaluate(
      (storageKey) => localStorage.getItem(storageKey),
      MOCK_DATABASE_STORAGE_KEY
    )
    if (!initialOwnerSnapshot) {
      throw new Error('Initial owner mock snapshot is missing.')
    }
    await sameOwner.page.evaluate(
      ({ serialized, storageKey }) => {
        localStorage.setItem(storageKey, serialized)
      },
      {
        serialized: initialOwnerSnapshot,
        storageKey: MOCK_DATABASE_STORAGE_KEY
      }
    )
    await sameOwner.page.reload()
    await sameOwner.page.goto(`/wrong-notes/${questionId}`)
    await expect(sameOwner.page.locator('li[id^="review-event-"]')).toHaveCount(
      1
    )
    await expect(
      sameOwner.page.getByRole('textbox', { name: '나의 메모' })
    ).toHaveValue('')

    await owner.page.goto(`/wrong-notes/${questionId}`)
    await expect(
      owner.page.getByRole('heading', { name: '마지막 오답 문제 상세' })
    ).toBeVisible()
    const ownerMemo = owner.page.getByRole('textbox', { name: '나의 메모' })
    await focusByKeyboard(owner.page, ownerMemo)
    await owner.page.keyboard.type('same-owner refetch memo')
    await activateByKeyboard(
      owner.page,
      owner.page.getByRole('button', { name: '메모 저장' })
    )
    await expect(owner.page.getByText('메모를 저장했습니다.')).toBeVisible()
    await createWrongNotes(owner.page)

    const updatedOwnerSnapshot = await owner.page.evaluate(
      (storageKey) => localStorage.getItem(storageKey),
      MOCK_DATABASE_STORAGE_KEY
    )
    if (!updatedOwnerSnapshot) {
      throw new Error('Updated owner mock snapshot is missing.')
    }
    await sameOwner.page.evaluate(
      ({ serialized, storageKey }) => {
        localStorage.setItem(storageKey, serialized)
      },
      {
        serialized: updatedOwnerSnapshot,
        storageKey: MOCK_DATABASE_STORAGE_KEY
      }
    )
    await sameOwner.page.reload()
    await expect(
      sameOwner.page.getByRole('textbox', { name: '나의 메모' })
    ).toHaveValue('same-owner refetch memo')
    await expect(sameOwner.page.locator('li[id^="review-event-"]')).toHaveCount(
      2
    )

    await foreign.page.goto('/wrong-notes')
    await expect(
      foreign.page.getByRole('heading', { name: '조건에 맞는 오답 0개' })
    ).toBeVisible()
    await foreign.page.goto(`/wrong-notes/${questionId}`)
    await expect(
      foreign.page.getByRole('heading', { name: '오답을 찾을 수 없습니다' })
    ).toBeVisible()

    await owner.page.evaluate(() => {
      sessionStorage.setItem('phase5-mock-context-probe', 'owner-only')
    })
    expect(
      await foreign.page.evaluate(() =>
        sessionStorage.getItem('phase5-mock-context-probe')
      )
    ).toBeNull()
    await owner.page.reload()
    await expect(
      owner.page.getByRole('heading', { name: '마지막 오답 문제 상세' })
    ).toBeVisible()
  } finally {
    await owner.context.close()
    await sameOwner.context.close()
    await foreign.context.close()
  }
})
