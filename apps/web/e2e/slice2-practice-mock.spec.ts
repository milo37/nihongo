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
})
