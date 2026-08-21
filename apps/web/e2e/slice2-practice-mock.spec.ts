import { expect, test } from '@playwright/test'

interface MockCreatedSession {
  questions: Array<{ sessionQuestionId: string }>
  session: { id: string; mode: string }
}

test('mock mode keeps the Slice 2 autosave and reload flow available', async ({
  page
}) => {
  await page.goto('/login')
  const form = page.locator('form').filter({ has: page.getByLabel('이메일') })
  await form.getByLabel('이메일').fill('user@example.com')
  await form.getByLabel('비밀번호').fill('Demo-user-2026!')
  await Promise.all([
    page.waitForURL((url) => url.pathname === '/'),
    form.getByRole('button', { exact: true, name: '로그인' }).click()
  ])

  await page.goto('/practice')
  await page.getByRole('button', { name: 'N5' }).click()
  await page.getByRole('button', { name: '문자·어휘' }).click()
  await page.getByRole('button', { name: '5문제' }).click()
  await Promise.all([
    page.waitForURL(/\/practice\/session\/[0-9a-f-]+$/),
    page.getByRole('button', { name: '학습 시작하기' }).click()
  ])

  await expect(page.locator('[data-save-state]')).toBeVisible()
  await page.keyboard.press('1')
  await expect(page.getByRole('radio').nth(0)).toBeChecked()
  await expect(page.locator('[data-save-state]')).toHaveAttribute(
    'data-save-state',
    'saved',
    { timeout: 15_000 }
  )

  await page.reload()
  await expect(page.getByRole('radio').nth(0)).toBeChecked()
  await expect(page.locator('[data-save-state]')).toContainText(
    /서버 작업본과 동기화|서버에 저장됨/
  )

  const bookmarkButton = page.getByRole('button', {
    name: '1번 문제 즐겨찾기 추가'
  })
  await expect(bookmarkButton).toBeEnabled()
  await bookmarkButton.click()
  await expect(
    page.getByRole('button', { name: '1번 문제 즐겨찾기 해제' })
  ).toHaveAttribute('aria-pressed', 'true')

  const sessionId = new URL(page.url()).pathname.split('/').at(-1)
  if (!sessionId) throw new Error('Mock Bookmark session ID가 필요합니다.')
  const cancellationStatus = await page.evaluate(async (id) => {
    const response = await fetch(`/api/v1/study-sessions/${id}/cancellation`, {
      body: '{}',
      headers: {
        'Content-Type': 'application/json',
        'X-Nihongo-Practice-Contract': '2'
      },
      method: 'POST'
    })
    return response.status
  }, sessionId)
  expect(cancellationStatus).toBe(204)

  await page.goto('/bookmarks')
  await expect(
    page.getByRole('heading', { name: '즐겨찾기 문제' })
  ).toBeVisible()
  await expect(page.getByRole('button', { name: '즐겨찾기 해제' })).toHaveCount(
    1
  )
  const createResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      response.request().method() === 'POST' &&
      url.pathname === '/api/v1/study-sessions'
    )
  })
  await page
    .getByRole('button', {
      name: /N5 · 문자·어휘 · 최대 20문제 풀기/u
    })
    .click()
  const createResponse = await createResponsePromise
  expect(createResponse.status()).toBe(201)
  await expect(createResponse.json()).resolves.toMatchObject({
    questions: expect.arrayContaining([expect.any(Object)]),
    session: {
      actualCount: 1,
      fallbackReason: null,
      mode: 'BOOKMARK',
      requestedCount: 20,
      usedFallback: false
    }
  })
  await expect(page).toHaveURL(/\/practice\/session\/[0-9a-f-]+$/u)
  const removeButton = page.getByRole('button', {
    name: '1번 문제 즐겨찾기 해제'
  })
  await expect(removeButton).toBeEnabled()
  await removeButton.click()
  await expect(
    page.getByRole('button', { name: '1번 문제 즐겨찾기 추가' })
  ).toHaveAttribute('aria-pressed', 'false')

  const retrySource = await page.evaluate(async () => {
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
    if (response.status !== 201) {
      throw new Error(`Mock retry source failed with ${response.status}.`)
    }
    return (await response.json()) as MockCreatedSession
  })
  const submitStatus = await page.evaluate(async (source) => {
    const response = await fetch(
      `/api/v1/study-sessions/${source.session.id}/submission`,
      {
        body: JSON.stringify({
          answers: source.questions.map(({ sessionQuestionId }) => ({
            studySessionQuestionId: sessionQuestionId,
            selectedOptionId: null,
            elapsedSec: 0
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
    return response.status
  }, retrySource)
  expect(submitStatus).toBe(201)

  await page.goto(`/practice/result/${retrySource.session.id}`)
  await expect(page.getByRole('heading', { name: '학습 결과' })).toBeVisible()
  await page.evaluate((sourceSessionId) => {
    interface RetryRequestMetadata {
      headers: Record<string, string>
      method: string
      url: string
    }

    const metadata = new WeakMap<XMLHttpRequest, RetryRequestMetadata>()
    const prototype = XMLHttpRequest.prototype
    const originalOpen = prototype.open
    const originalSend = prototype.send
    const originalSetRequestHeader = prototype.setRequestHeader
    const restore = (): void => {
      Object.defineProperties(prototype, {
        open: { configurable: true, writable: true, value: originalOpen },
        send: { configurable: true, writable: true, value: originalSend },
        setRequestHeader: {
          configurable: true,
          writable: true,
          value: originalSetRequestHeader
        }
      })
    }

    Object.defineProperties(prototype, {
      open: {
        configurable: true,
        writable: true,
        value: function (
          this: XMLHttpRequest,
          method: string,
          url: string | URL,
          async = true,
          username?: string | null,
          password?: string | null
        ): void {
          metadata.set(this, {
            headers: {},
            method: method.toUpperCase(),
            url: String(url)
          })
          if (username === undefined) {
            Reflect.apply(originalOpen, this, [method, url, async])
            return
          }
          Reflect.apply(originalOpen, this, [
            method,
            url,
            async,
            username,
            password ?? null
          ])
        }
      },
      setRequestHeader: {
        configurable: true,
        writable: true,
        value: function (
          this: XMLHttpRequest,
          name: string,
          value: string
        ): void {
          const request = metadata.get(this)
          if (request) request.headers[name.toLowerCase()] = value
          Reflect.apply(originalSetRequestHeader, this, [name, value])
        }
      },
      send: {
        configurable: true,
        writable: true,
        value: function (
          this: XMLHttpRequest,
          body?: Document | XMLHttpRequestBodyInit | null
        ): void {
          const request = metadata.get(this)
          const pathname = request
            ? new URL(request.url, window.location.href).pathname
            : ''
          if (
            request?.method === 'POST' &&
            pathname === `/api/v1/study-sessions/${sourceSessionId}/retry`
          ) {
            const handleHeaders = (): void => {
              if (this.readyState !== XMLHttpRequest.HEADERS_RECEIVED) return
              this.removeEventListener('readystatechange', handleHeaders)
              const location = this.getResponseHeader('Location')
              const targetSessionId = location?.split('/').at(-1) ?? null
              sessionStorage.setItem(
                'slice5-mock-retry-probe',
                JSON.stringify({
                  idempotencyKey: request.headers['idempotency-key'] ?? null,
                  targetSessionId
                })
              )
              restore()
              this.abort()
            }
            this.addEventListener('readystatechange', handleHeaders)
          }
          Reflect.apply(originalSend, this, [body ?? null])
        }
      }
    })
  }, retrySource.session.id)

  await page.getByRole('button', { name: '오답만 다시 풀기' }).click()
  await expect(
    page.getByRole('alert').filter({ hasText: '오답 재출제 세션' })
  ).toBeVisible()
  const responseLossProbe = await page.evaluate(() => {
    const serialized = sessionStorage.getItem('slice5-mock-retry-probe')
    return serialized
      ? (JSON.parse(serialized) as {
          idempotencyKey: string | null
          targetSessionId: string | null
        })
      : null
  })
  expect(responseLossProbe?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/u)
  expect(responseLossProbe?.targetSessionId).toMatch(/^[0-9a-f-]{36}$/u)

  let sawBeforeUnload = false
  page.once('dialog', (dialog) => {
    expect(dialog.type()).toBe('beforeunload')
    sawBeforeUnload = true
    void dialog.accept()
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  expect(sawBeforeUnload).toBe(true)
  await expect(page.getByRole('heading', { name: '학습 결과' })).toBeVisible()
  const retryResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      response.request().method() === 'POST' &&
      url.pathname === `/api/v1/study-sessions/${retrySource.session.id}/retry`
    )
  })
  await page.getByRole('button', { name: '오답만 다시 풀기' }).click()
  const retryResponse = await retryResponsePromise
  expect(retryResponse.status()).toBe(201)
  expect(retryResponse.request().headers()['idempotency-key']).toBe(
    responseLossProbe?.idempotencyKey
  )
  expect(retryResponse.headers()['idempotency-replayed']).toBe('true')
  const retryTarget = (await retryResponse.json()) as MockCreatedSession
  expect(retryTarget.session.id).toBe(responseLossProbe?.targetSessionId)
  expect(retryTarget.session.mode).toBe('WRONG_NOTE')
  expect(retryTarget.questions).toHaveLength(5)
  await expect(page).toHaveURL(
    new RegExp(`/practice/session/${retryTarget.session.id}$`)
  )
  await expect(page.locator('[data-save-state]')).toBeVisible()
})
