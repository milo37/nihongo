import { http, HttpResponse } from 'msw'
import { startAdminFresh } from '@api/auth/startAdminFresh'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { DEMO_ADMIN_ID } from '@mocks/data/users'
import { setMockSsoAccountForTesting } from '@mocks/handlers/authHandlers'
import { mockServer } from '@/test/server'

it('uses the strict ADMIN_FRESH module with safe default callback and no ordinary LOGIN side effect', async () => {
  const actor = mockDatabase.loginAs('ADMIN')
  setMockSsoAccountForTesting('google', DEMO_ADMIN_ID)
  const response = await startAdminFresh({
    purpose: 'ADMIN_FRESH',
    provider: 'google'
  })
  expect(response.redirect).toBe(true)
  expect(mockDatabase.getCurrentUser()?.id).toBe(actor.id)
})
it('rejects an unlinked identity without switching to an ordinary fixture account', async () => {
  const actor = mockDatabase.loginAs('ADMIN')
  await expect(
    startAdminFresh({ purpose: 'ADMIN_FRESH', provider: 'google' })
  ).rejects.toMatchObject({ status: 401, code: 'REAUTHENTICATION_FAILED' })
  expect(mockDatabase.getCurrentUser()?.id).toBe(actor.id)
})
it('rejects a selected-provider mismatch even when the URL shape is otherwise valid', async () => {
  const url = new URL('https://appleid.apple.com/auth/authorize')
  url.search = new URLSearchParams({
    state: 's'.repeat(43),
    nonce: 'n'.repeat(43),
    code_challenge: 'c'.repeat(43),
    code_challenge_method: 'S256',
    response_type: 'code',
    response_mode: 'form_post'
  }).toString()
  mockServer.use(
    http.post('*/api/auth/sign-in/social', () =>
      HttpResponse.json({ url: url.href, redirect: true })
    )
  )
  await expect(
    startAdminFresh({ purpose: 'ADMIN_FRESH', provider: 'google' })
  ).rejects.toBeDefined()
})
