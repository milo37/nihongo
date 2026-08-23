import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type {
  Browser,
  BrowserContext,
  Locator,
  Page,
  Route
} from '@playwright/test'

interface Credentials {
  email: string
  name: string
  password: string
  userId: string
}

interface QuestionFixture {
  correctOptionId: string
  correctOptionOrdinal: number
  incorrectOptionId: string
  incorrectOptionOrdinal: number
  level: 'N4' | 'N5'
  questionId: string
  questionText: string
  questionVersionId: string
  tags: string[]
}

interface QueueCounts {
  due: number
  repeated: number
  solved: number
  total: number
  unreviewed: number
}

interface Phase5Fixture {
  archivedMemo: string
  archivedQuestion: QuestionFixture
  expectedAfterDailyCounts: QueueCounts
  expectedAfterTargetedCounts: QueueCounts
  expectedCounts: QueueCounts
  filter: {
    level: 'N5'
    questionType: 'GRAMMAR_SELECT'
    subject: 'GRAMMAR'
    tag: string
  }
  foreign: Credentials
  owner: Credentials
  reviewQuestions: [QuestionFixture, QuestionFixture]
  solvedQuestion: QuestionFixture
}

interface CreatedSession {
  questions: Array<{
    question: { id: string }
    sessionQuestionId: string
  }>
  session: {
    actualCount: number
    id: string
    requestedCount: number
  }
}

interface QueueResponse {
  counts: Omit<QueueCounts, 'total'>
  items: Array<{
    nextReviewAt: string | null
    questionId: string
    status: string
  }>
  total: number
}

interface MemoResponse {
  text: string
  updatedAt: string
}

const readFixture = (): Phase5Fixture => {
  const serialized = process.env.PHASE5_E2E_FIXTURE
  if (!serialized) throw new Error('Phase 5 browser fixture is missing.')
  const fixture = JSON.parse(serialized) as Phase5Fixture
  if (
    !fixture.owner?.email ||
    !fixture.foreign?.email ||
    fixture.reviewQuestions?.length !== 2
  ) {
    throw new Error('Phase 5 browser fixture is invalid.')
  }
  return fixture
}

const fixture = readFixture()
const schemaName = process.env.PHASE5_E2E_SCHEMA
if (!/^phase5_slice6_e2e_[0-9]+_[a-f0-9]{8}_test$/u.test(schemaName ?? '')) {
  throw new Error('The isolated Phase 5 E2E schema marker is missing.')
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

const createLoggedInContext = async (
  browser: Browser,
  credentials: Credentials,
  clientIp: string
): Promise<{ context: BrowserContext; page: Page }> => {
  const context = await browser.newContext({
    extraHTTPHeaders: { 'X-Forwarded-For': clientIp }
  })
  const page = await context.newPage()
  await login(page, credentials)
  return { context, page }
}

const expectCounts = async (page: Page, counts: QueueCounts): Promise<void> => {
  await expect(
    page.getByRole('button', {
      name: new RegExp(`^복습 예정\\s*${counts.due}$`, 'u')
    })
  ).toBeVisible()
  await expect(
    page.getByRole('button', {
      name: new RegExp(`^아직 복습 전\\s*${counts.unreviewed}$`, 'u')
    })
  ).toBeVisible()
  await expect(
    page.getByRole('button', {
      name: new RegExp(`^반복 오답\\s*${counts.repeated}$`, 'u')
    })
  ).toBeVisible()
  await expect(
    page.getByRole('button', {
      name: new RegExp(`^해결\\s*${counts.solved}$`, 'u')
    })
  ).toBeVisible()
  await expect(
    page.getByRole('heading', {
      name: `조건에 맞는 오답 ${counts.total}개`
    })
  ).toBeVisible()
}

const waitForSavedDraft = async (page: Page): Promise<void> => {
  await expect(page.locator('[data-save-state]')).toHaveAttribute(
    'data-save-state',
    'saved',
    { timeout: 15_000 }
  )
}

const selectOptionByKeyboard = async (
  page: Page,
  optionOrdinal: number
): Promise<void> => {
  const options = page.getByRole('radio')
  const option = options.nth(optionOrdinal - 1)
  const checkedOption = page.getByRole('radio', { checked: true })
  const keyboardEntryOption =
    (await checkedOption.count()) > 0 ? checkedOption.first() : options.first()
  await expect(option).toBeVisible()
  await focusByKeyboard(page, keyboardEntryOption)
  await page.keyboard.press(String(optionOrdinal))
  await expect(option).toBeChecked()
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

const submitCurrentSession = async (page: Page): Promise<void> => {
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

const serviceUnavailable = async (route: Route): Promise<void> => {
  const requestId = randomUUID()
  await route.fulfill({
    body: JSON.stringify({
      code: 'SERVICE_UNAVAILABLE',
      message: '브라우저 수용 테스트용 일시 오류입니다.',
      requestId,
      retryable: true
    }),
    contentType: 'application/json; charset=utf-8',
    headers: {
      'Cache-Control': 'private, no-store',
      'X-Request-Id': requestId
    },
    status: 503
  })
}

test.describe.serial('Phase 5 real review center acceptance', () => {
  test('current DUE batch follows server counts and updates queue after keyboard submission', async ({
    browser
  }) => {
    const { context, page } = await createLoggedInContext(
      browser,
      fixture.owner,
      '198.51.100.40'
    )
    try {
      const queueResponsePromise = page.waitForResponse((response) => {
        const url = new URL(response.url())
        return (
          response.request().method() === 'GET' &&
          url.pathname === '/api/v1/review-queue'
        )
      })
      await page.goto('/wrong-notes')
      await expect(
        page.getByRole('heading', {
          name: '지금 복습할 오답을 확인하세요'
        })
      ).toBeVisible()
      const queueResponse = (await queueResponsePromise).json()
      const initialQueue = (await queueResponse) as QueueResponse
      expect(initialQueue).toMatchObject({
        counts: {
          due: fixture.expectedCounts.due,
          repeated: fixture.expectedCounts.repeated,
          solved: fixture.expectedCounts.solved,
          unreviewed: fixture.expectedCounts.unreviewed
        },
        total: fixture.expectedCounts.total
      })
      expect(initialQueue.items).toHaveLength(fixture.expectedCounts.total)
      const initialSecondReview = initialQueue.items.find(
        ({ questionId }) => questionId === fixture.reviewQuestions[1].questionId
      )
      expect(initialSecondReview?.nextReviewAt).toBeTruthy()
      await expectCounts(page, fixture.expectedCounts)

      await page.goto(
        `/wrong-notes?tag=${encodeURIComponent(fixture.filter.tag)}`
      )
      await expect(page.getByLabel('태그')).toHaveValue(fixture.filter.tag)
      await selectNativeOptionByKeyboard(page, '급수', fixture.filter.level)
      await selectNativeOptionByKeyboard(page, '과목', fixture.filter.subject)
      await selectNativeOptionByKeyboard(
        page,
        '문제 유형',
        fixture.filter.questionType
      )
      await expect(page.getByLabel('태그')).toHaveValue(fixture.filter.tag)
      await expect(page.getByLabel('문제 유형')).toBeFocused()
      expect(
        await page
          .getByLabel('문제 유형')
          .evaluate((element) => element.matches(':focus-visible'))
      ).toBe(true)
      await expect(
        page.getByRole('heading', { name: '조건에 맞는 오답 2개' })
      ).toBeVisible()
      await expect(
        page.locator('[aria-live="polite"][aria-atomic="true"]').filter({
          has: page.getByRole('heading', {
            name: '조건에 맞는 오답 2개'
          })
        })
      ).toHaveCount(1)
      const filteredReviewCenterUrl = page.url()
      await page.reload()
      await expect(page.getByLabel('급수')).toHaveValue('N5')
      await expect(page.getByLabel('과목')).toHaveValue('GRAMMAR')
      await expect(page.getByLabel('문제 유형')).toHaveValue('GRAMMAR_SELECT')
      await expect(page.getByLabel('태그')).toHaveValue(fixture.filter.tag)
      await activateByKeyboard(
        page,
        page.getByRole('link', { name: '전체 오답 기록' })
      )
      await expect(
        page.getByRole('heading', { name: '전체 오답 기록' })
      ).toBeVisible()
      await page.goBack()
      await expect(page).toHaveURL(filteredReviewCenterUrl)
      await expect(
        page.getByRole('heading', { name: '조건에 맞는 오답 2개' })
      ).toBeVisible()
      await page.goForward()
      await expect(
        page.getByRole('heading', { name: '전체 오답 기록' })
      ).toBeVisible()
      await page.goBack()
      await expect(page).toHaveURL(filteredReviewCenterUrl)
      await selectNativeOptionByKeyboard(page, '묶음 문제 수', '10')

      const createResponsePromise = page.waitForResponse((response) => {
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
      const createResponse = await createResponsePromise
      expect(createResponse.status()).toBe(201)
      const requestBody = createResponse.request().postDataJSON() as Record<
        string,
        unknown
      >
      expect(requestBody).toEqual({
        count: 10,
        level: 'N5',
        mode: 'DAILY_REVIEW',
        reviewFilter: {
          questionType: 'GRAMMAR_SELECT',
          tag: fixture.filter.tag
        },
        subject: 'GRAMMAR'
      })
      expect(JSON.stringify(requestBody)).not.toContain('questionId')
      const created = (await createResponse.json()) as CreatedSession
      expect(created.session).toMatchObject({
        actualCount: 2,
        requestedCount: 10
      })
      expect(created.questions.map(({ question }) => question.id)).toEqual(
        fixture.reviewQuestions.map(({ questionId }) => questionId)
      )
      await expect(page).toHaveURL(
        new RegExp(`/practice/session/${created.session.id}$`, 'u')
      )
      await expect(
        page.getByText(
          '요청한 10문제 중 일일 복습 모드로 출제 가능한 2문제만 제공합니다. 다른 모드로 대체하지 않았습니다.'
        )
      ).toBeVisible()

      await page.keyboard.press(
        String(fixture.reviewQuestions[0].correctOptionOrdinal)
      )
      await waitForSavedDraft(page)
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press(
        String(fixture.reviewQuestions[1].incorrectOptionOrdinal)
      )
      await waitForSavedDraft(page)
      await submitCurrentSession(page)
      await expect(page.getByText('50%')).toBeVisible()

      await activateByKeyboard(
        page,
        page.getByRole('button', { name: '오답노트 보기' })
      )
      await expect(page).toHaveURL(/\/wrong-notes$/u)
      await expectCounts(page, fixture.expectedAfterDailyCounts)
      await activateByKeyboard(
        page,
        page.getByRole('button', { name: /^반복 오답/u })
      )
      await expect(page).toHaveURL((url) => {
        return url.searchParams.get('view') === 'REPEATED'
      })
      await expect(
        page.getByRole('button', { name: /^반복 오답/u })
      ).toHaveAttribute('aria-pressed', 'true')
      const repeatedQueueResponsePromise = page.waitForResponse((response) => {
        const url = new URL(response.url())
        return (
          response.request().method() === 'GET' &&
          url.pathname === '/api/v1/review-queue' &&
          url.searchParams.get('view') === 'REPEATED' &&
          url.searchParams.get('level') === 'N5'
        )
      })
      await selectNativeOptionByKeyboard(page, '급수', 'N5')
      const repeatedQueue = (await (
        await repeatedQueueResponsePromise
      ).json()) as QueueResponse
      expect(repeatedQueue.items).toEqual([
        expect.objectContaining({
          questionId: fixture.reviewQuestions[1].questionId,
          status: 'AGAIN'
        })
      ])
      expect(repeatedQueue.items[0]?.nextReviewAt).not.toBe(
        initialSecondReview?.nextReviewAt
      )
      await expect(page.getByLabel('급수')).toBeFocused()
      expect(
        await page
          .getByLabel('급수')
          .evaluate((element) => element.matches(':focus-visible'))
      ).toBe(true)
      await expect(
        page.getByRole('heading', { name: '조건에 맞는 오답 1개' })
      ).toBeVisible()
      await expect(page.getByText('다시 학습', { exact: true })).toBeVisible()
      await expect(page.getByText('다음 복습', { exact: true })).toBeVisible()
      await page.goto(`/wrong-notes/${fixture.reviewQuestions[1].questionId}`)
      const dailyEvents = page.locator('li[id^="review-event-"]')
      await expect(dailyEvents).toHaveCount(2)
      await expect(
        dailyEvents.first().getByText('오답 복습 제출')
      ).toBeVisible()
      await expect(
        dailyEvents.first().getByText('오답', { exact: true })
      ).toBeVisible()
    } finally {
      await context.close()
    }
  })

  test('memo, offline retention, timeline pagination, and archived history remain visible', async ({
    browser
  }) => {
    const { context, page } = await createLoggedInContext(
      browser,
      fixture.owner,
      '198.51.100.41'
    )
    try {
      const questionId = fixture.reviewQuestions[0].questionId
      await page.goto(`/wrong-notes/${questionId}`)
      const memo = page.getByRole('textbox', { name: '나의 메모' })
      await expect(memo).toBeVisible()
      await focusByKeyboard(page, memo)
      await page.keyboard.type('Slice 6 memo')
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
      await expect(memo).toHaveValue('Slice 6 memo')

      await focusByKeyboard(page, memo)
      await page.keyboard.press('ControlOrMeta+A')
      await page.keyboard.type('  Slice 6 memo  ')
      const noOpSavePromise = page.waitForResponse((response) =>
        response.url().endsWith(`/wrong-notes/${questionId}/memo`)
      )
      await activateByKeyboard(
        page,
        page.getByRole('button', { name: '메모 저장' })
      )
      const noOpMemo = (await (await noOpSavePromise).json()) as MemoResponse
      expect(noOpMemo.updatedAt).toBe(firstMemo.updatedAt)
      await expect(memo).toHaveValue('Slice 6 memo')

      await context.setOffline(true)
      await focusByKeyboard(page, memo)
      await page.keyboard.press('ControlOrMeta+A')
      await page.keyboard.type('offline memo remains')
      await activateByKeyboard(
        page,
        page.getByRole('button', { name: '메모 저장' })
      )
      await expect(
        page.getByText(
          '오프라인에서는 메모를 저장할 수 없습니다. 입력은 유지됩니다. 연결 후 다시 시도해 주세요.'
        )
      ).toBeVisible()
      await expect(memo).toHaveValue('offline memo remains')
      await expect(page.getByText('메모를 저장했습니다.')).toHaveCount(0)
      await context.setOffline(false)
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

      const solvedQuestionId = fixture.solvedQuestion.questionId
      let cursorFailures = 0
      await page.route(
        new RegExp(
          `/api/v1/wrong-notes/${solvedQuestionId}/review-events\\?.*cursor=`,
          'u'
        ),
        async (route) => {
          if (cursorFailures < 2) {
            cursorFailures += 1
            await serviceUnavailable(route)
            return
          }
          await route.continue()
        }
      )
      await page.goto(`/wrong-notes/${solvedQuestionId}`)
      const events = page.locator('li[id^="review-event-"]')
      await expect(events).toHaveCount(20)
      const loadMore = page.getByRole('button', {
        name: '이전 기록 더 보기'
      })
      await activateByKeyboard(page, loadMore)
      await expect(
        page.getByText(
          '이전 기록을 더 불러오지 못했습니다. 현재까지 불러온 기록은 유지됩니다.'
        )
      ).toBeVisible({ timeout: 15_000 })
      expect(cursorFailures).toBe(2)
      await expect(events).toHaveCount(20)
      await expect(loadMore).toBeFocused()
      await activateByKeyboard(page, loadMore)
      await expect(events).toHaveCount(21)
      await expect(events.nth(20)).toBeFocused()

      await page.goto(`/wrong-notes/${fixture.archivedQuestion.questionId}`)
      await expect(page.getByText('보관된 문제', { exact: true })).toBeVisible()
      await expect(
        page.getByRole('heading', {
          name: fixture.archivedQuestion.questionText
        })
      ).toBeVisible()
      await expect(
        page.getByRole('textbox', { name: '나의 메모' })
      ).toHaveValue(fixture.archivedMemo)
      await expect(
        page.getByText('보관된 문제는 기록과 메모만 확인할 수 있습니다.')
      ).toBeVisible()
      await expect(
        page.getByRole('button', { name: '이 문제만 다시 풀기' })
      ).toHaveCount(0)
      await expect(page.getByText('표준 학습 제출')).toBeVisible()
      await expect(
        page.getByText(fixture.archivedQuestion.questionVersionId)
      ).toBeVisible()
    } finally {
      await context.close()
    }
  })

  test('targeted response loss replays one key and one session before standard submission', async ({
    browser
  }) => {
    const { context, page } = await createLoggedInContext(
      browser,
      fixture.owner,
      '198.51.100.42'
    )
    const question = fixture.reviewQuestions[0]
    const endpoint = `/api/v1/wrong-notes/${question.questionId}/review-session`
    const queueBeforeResponse = await page.request.get('/api/v1/review-queue')
    expect(queueBeforeResponse.status()).toBe(200)
    const queueBefore = (await queueBeforeResponse.json()) as QueueResponse
    const questionBefore = queueBefore.items.find(
      ({ questionId }) => questionId === question.questionId
    )
    let firstKey: string | undefined
    let firstBody: string | null = null
    let firstSessionId: string | undefined
    let requestCount = 0
    const loseFirstResponse = async (route: Route): Promise<void> => {
      requestCount += 1
      if (requestCount !== 1) {
        await route.continue()
        return
      }
      firstKey = route.request().headers()['idempotency-key']
      firstBody = route.request().postData()
      const response = await route.fetch()
      const body = (await response.json()) as CreatedSession
      firstSessionId = body.session.id
      await route.abort('failed')
    }
    try {
      await page.route(`**${endpoint}`, loseFirstResponse)
      await page.goto(`/wrong-notes/${question.questionId}`)
      await activateByKeyboard(
        page,
        page.getByRole('button', { name: '이 문제만 다시 풀기' })
      )
      await expect(
        page.getByText(
          '단일 복습 세션을 만들지 못했습니다. 다시 시도해 주세요.'
        )
      ).toBeVisible()
      expect(firstKey).toMatch(/^[0-9a-f-]{36}$/u)
      expect(firstBody).toBe('{}')
      expect(firstSessionId).toMatch(/^[0-9a-f-]{36}$/u)

      await page.reload({ waitUntil: 'domcontentloaded' })
      const replayPromise = page.waitForResponse((response) =>
        response.url().endsWith(endpoint)
      )
      await activateByKeyboard(
        page,
        page.getByRole('button', { name: '이 문제만 다시 풀기' })
      )
      const replay = await replayPromise
      expect(replay.status()).toBe(201)
      expect(replay.request().headers()['idempotency-key']).toBe(firstKey)
      expect(replay.request().postData()).toBe(firstBody)
      expect(replay.headers()['idempotency-replayed']).toBe('true')
      const replayBody = (await replay.json()) as CreatedSession
      expect(replayBody.session.id).toBe(firstSessionId)
      await expect(page).toHaveURL(
        new RegExp(`/practice/session/${firstSessionId}$`, 'u')
      )
      await selectOptionByKeyboard(page, question.correctOptionOrdinal)
      await waitForSavedDraft(page)
      await submitCurrentSession(page)

      await page.goto(`/wrong-notes/${question.questionId}`)
      await expect(page.getByText('오답 복습 제출').first()).toBeVisible()
      await activateByKeyboard(
        page,
        page.getByRole('link', { name: '복습 센터로 돌아가기' })
      )
      const isAfterDailyFixtureState =
        queueBefore.total === fixture.expectedAfterDailyCounts.total &&
        Object.entries(queueBefore.counts).every(
          ([key, value]) =>
            value ===
            fixture.expectedAfterDailyCounts[
              key as keyof Omit<QueueCounts, 'total'>
            ]
        )
      const expectedAfterTargeted = isAfterDailyFixtureState
        ? fixture.expectedAfterTargetedCounts
        : {
            due: queueBefore.counts.due - (questionBefore ? 1 : 0),
            repeated: queueBefore.counts.repeated,
            solved: queueBefore.counts.solved,
            total: queueBefore.counts.due - (questionBefore ? 1 : 0),
            unreviewed:
              queueBefore.counts.unreviewed -
              (questionBefore?.status === 'NEW' ? 1 : 0)
          }
      await expectCounts(page, expectedAfterTargeted)
      expect(requestCount).toBe(2)
    } finally {
      await page.unroute(`**${endpoint}`, loseFirstResponse)
      await context.close()
    }
  })

  test('two contexts share server facts, isolate another account, and keep responsive accessible states', async ({
    browser
  }) => {
    const first = await createLoggedInContext(
      browser,
      fixture.owner,
      '198.51.100.43'
    )
    const second = await createLoggedInContext(
      browser,
      fixture.owner,
      '198.51.100.44'
    )
    const questionId = fixture.reviewQuestions[1].questionId
    try {
      await second.page.goto(`/wrong-notes/${questionId}`)
      await expect(
        second.page.getByRole('textbox', { name: '나의 메모' })
      ).toHaveValue('')
      const sharedEvents = second.page.locator('li[id^="review-event-"]')
      const sharedEventCount = await sharedEvents.count()
      await first.page.goto(`/wrong-notes/${questionId}`)
      const sharedMemo = first.page.getByRole('textbox', { name: '나의 메모' })
      await sharedMemo.fill('두 브라우저가 함께 확인하는 메모')
      await first.page.getByRole('button', { name: '메모 저장' }).click()
      await expect(first.page.getByText('메모를 저장했습니다.')).toBeVisible()
      await second.page.reload()
      await expect(
        second.page.getByRole('textbox', { name: '나의 메모' })
      ).toHaveValue('두 브라우저가 함께 확인하는 메모')

      await first.page
        .getByRole('button', { name: '이 문제만 다시 풀기' })
        .click()
      await expect(first.page).toHaveURL(/\/practice\/session\/[0-9a-f-]{36}$/u)
      await selectOptionByKeyboard(
        first.page,
        fixture.reviewQuestions[1].correctOptionOrdinal
      )
      await waitForSavedDraft(first.page)
      await submitCurrentSession(first.page)
      await second.page.reload()
      await expect(sharedEvents).toHaveCount(sharedEventCount + 1)
      await expect(
        sharedEvents.first().getByText('오답 복습 제출')
      ).toBeVisible()

      const firstCookies = await first.context.cookies()
      const secondCookies = await second.context.cookies()
      expect(firstCookies.map(({ value }) => value)).not.toEqual(
        secondCookies.map(({ value }) => value)
      )
      await first.page.evaluate(() => {
        sessionStorage.setItem('phase5-context-probe', 'owner-a')
      })
      expect(
        await second.page.evaluate(() =>
          sessionStorage.getItem('phase5-context-probe')
        )
      ).toBeNull()

      await second.page.goto('/login')
      await second.page.getByRole('button', { name: '로그아웃' }).click()
      await login(second.page, fixture.foreign)
      await second.page.goto('/wrong-notes')
      await expect(
        second.page.getByRole('heading', { name: '조건에 맞는 오답 0개' })
      ).toBeVisible()
      await second.page.goto(`/wrong-notes/${questionId}`)
      await expect(
        second.page.getByRole('heading', { name: '오답을 찾을 수 없습니다' })
      ).toBeVisible()
      await expect(
        second.page.getByText('두 브라우저가 함께 확인하는 메모')
      ).toHaveCount(0)
      await first.page.goto(`/wrong-notes/${questionId}`)
      await expect(sharedMemo).toHaveValue('두 브라우저가 함께 확인하는 메모')

      await first.page.emulateMedia({ reducedMotion: 'reduce' })
      await first.page.goto('/wrong-notes')
      await expect(
        first.page.getByRole('heading', {
          name: '지금 복습할 오답을 확인하세요'
        })
      ).toBeVisible()
      await expect(
        first.page.getByRole('heading', { name: /조건에 맞는 오답 \d+개/u })
      ).toBeVisible()
      for (const [width, height] of [
        [320, 800],
        [375, 812],
        [768, 1_024],
        [1_280, 900]
      ] as const) {
        await first.page.setViewportSize({ height, width })
        expect(
          await first.page.evaluate(
            () =>
              document.documentElement.scrollWidth <=
              document.documentElement.clientWidth
          )
        ).toBe(true)
        const controls = first.page.locator(
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
        first.page.getByRole('button', { name: /^복습 예정/u })
      ).toHaveAttribute('aria-pressed', 'true')
      await expect(
        first.page.getByText('해결', { exact: true }).first()
      ).toBeVisible()
      const transitionDuration = await first.page
        .getByRole('button', { name: /^복습 예정/u })
        .evaluate((element) => getComputedStyle(element).transitionDuration)
      const durationSeconds = transitionDuration.endsWith('ms')
        ? Number.parseFloat(transitionDuration) / 1_000
        : Number.parseFloat(transitionDuration)
      expect(durationSeconds).toBeLessThanOrEqual(0.001)
    } finally {
      await first.context.close()
      await second.context.close()
    }
  })
})
