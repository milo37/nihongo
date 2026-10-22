import process from 'node:process'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { getCurrentPrincipalResponseSchema } from '@nihongo/contracts/auth/get-current-principal'
import {
  isSsoAuthorizationURLForProvider,
  signInSocialResponseSchema
} from '@nihongo/contracts/auth/sign-in-social'
import { listQuestionsResponseSchema } from '@nihongo/contracts/question/list-questions'
import {
  assertAndAttachLedger,
  assertExactRequestMultiset,
  ledgerEntriesFor,
  selectRequestLedger,
  trackRequestLedger,
  waitForLedgerToQuiesce
} from './phase10-request-ledger'

const mode = process.env.PHASE10_BROWSER_MODE
if (mode !== 'real' && mode !== 'mock') {
  throw new Error('PHASE10_BROWSER_MODE must be real or mock.')
}

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

for (const locale of ['ko', 'ja'] as const) {
  test(`${locale}: Google TEST handoff confirms the same public USER contract`, async ({
    context,
    page
  }, testInfo) => {
    await context.route(
      /^https:\/\/(?:accounts\.google\.com|appleid\.apple\.com)\//u,
      (route) => route.abort()
    )
    await page.addInitScript((locale) => {
      localStorage.setItem(
        'jlpt-drill-note:ui-locale:v1',
        JSON.stringify({ version: 1, locale })
      )
    }, locale)
    const ledger = trackRequestLedger(context)
    await page.goto('/login')
    await expect(page.getByRole('button', { name: /Google/u })).toBeVisible()
    await expect(page.locator('input[name="password"]')).toHaveCount(0)
    await expect(page.locator('html')).toHaveAttribute('lang', locale)
    if (mode === 'mock') {
      await page.evaluate(async () => {
        const path = '/src/test/phase10BrowserMockControl.ts'
        const control = (await import(/* @vite-ignore */ path)) as {
          resetPhase10MockState: () => Promise<void>
        }
        await control.resetPhase10MockState()
      })
    }
    try {
      const initial = await browserJson(page, '/api/v1/me')
      expect(initial.status).toBe(200)
      expect(getCurrentPrincipalResponseSchema.parse(initial.body).kind).toBe(
        'GUEST'
      )
      const started = await browserJson(page, '/api/auth/sign-in/social', {
        provider: 'google',
        callbackURL: '/practice'
      })
      expect(started.status).toBe(200)
      const authorization = signInSocialResponseSchema.parse(started.body)
      expect(
        isSsoAuthorizationURLForProvider('google', authorization.url)
      ).toBe(true)
      if (mode === 'mock') {
        await page.evaluate(async () => {
          const path = '/src/test/phase10BrowserMockControl.ts'
          const control = (await import(/* @vite-ignore */ path)) as {
            completePhase10MockGoogleCallback: () => Promise<void>
          }
          await control.completePhase10MockGoogleCallback()
        })
      } else {
        const state = new URL(authorization.url).searchParams.get('state')
        if (!state) throw new Error('Google TEST authorization omitted state.')
        const callback = `/api/auth/callback/google?${new URLSearchParams({
          state,
          code: 'phase7-sso-browser-test-code'
        })}`
        const accepted = await page.evaluate(async (path) => {
          try {
            const response = await fetch(path, {
              credentials: 'include',
              redirect: 'follow'
            })
            return response.ok
          } catch {
            return false
          }
        }, callback)
        expect(accepted).toBe(true)
      }
      const confirmed = await browserJson(page, '/api/v1/me')
      expect(confirmed.status).toBe(200)
      const principal = getCurrentPrincipalResponseSchema.parse(confirmed.body)
      expect(principal.kind).toBe('USER')
      if (principal.kind !== 'USER')
        throw new Error('Public USER was not confirmed.')
      expect(principal.user.role).toBe('USER')
      // The schema accepts the real nullable level and Mock N2; neither implies N5.
      expect(
        principal.user.id.length > 0 && principal.user.name.length > 0
      ).toBe(true)
      const catalog = await browserJson(
        page,
        '/api/v1/questions?level=N5&subject=VOCABULARY&page=1&pageSize=5'
      )
      expect(catalog.status).toBe(200)
      const questions = listQuestionsResponseSchema.parse(catalog.body)
      expect(questions.items.length > 0).toBe(true)
      expect(
        questions.items.every(
          (question) =>
            question.level === 'N5' && question.subject === 'VOCABULARY'
        )
      ).toBe(true)
      await waitForLedgerToQuiesce(ledger)
      const authLedger = selectRequestLedger(
        ledger,
        ({ path }) =>
          path.startsWith('/api/auth/') || path.startsWith('/api/_mock/auth/')
      )
      assertExactRequestMultiset(authLedger, [
        { method: 'POST', path: '/api/auth/sign-in/social', statuses: [200] },
        mode === 'mock'
          ? {
              method: 'POST',
              path: '/api/_mock/auth/social/callback',
              statuses: [200]
            }
          : {
              method: 'GET',
              path: '/api/auth/callback/google',
              statuses: [303]
            }
      ])
      for (const entry of ledger.entries) {
        expect(entry.provenance).toBe(
          mode === 'mock'
            ? 'canonical-mock-service-worker'
            : 'canonical-real-network'
        )
      }
      expect(
        ledgerEntriesFor(ledger, 'GET', '/api/v1/me').length
      ).toBeGreaterThanOrEqual(2)
      await assertAndAttachLedger(
        ledger,
        testInfo,
        `phase10-${mode}-${locale}-handoff`
      )
    } finally {
      if (mode === 'mock') {
        await page.evaluate(async () => {
          const path = '/src/test/phase10BrowserMockControl.ts'
          const control = (await import(/* @vite-ignore */ path)) as {
            resetPhase10MockState: () => Promise<void>
          }
          await control.resetPhase10MockState()
        })
      }
    }
  })
}
