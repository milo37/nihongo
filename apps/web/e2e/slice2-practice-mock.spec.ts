import { expect, test } from '@playwright/test'

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
})
