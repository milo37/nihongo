import { http, HttpResponse } from 'msw'
import { signInSocial } from '@api/auth/signInSocial'
import { mockServer } from '@/test/server'

const authorizationURL = (base: string): string => {
  const url = new URL(base)
  url.search = new URLSearchParams({
    state: 's'.repeat(43),
    nonce: 'n'.repeat(43),
    code_challenge: 'c'.repeat(43),
    code_challenge_method: 'S256',
    response_type: 'code',
    ...(url.hostname === 'appleid.apple.com'
      ? { response_mode: 'form_post' }
      : {})
  }).toString()
  return url.href
}

describe('SSO start boundary', () => {
  it.each([
    ['apple', 'https://accounts.google.com/o/oauth2/v2/auth?state=mock-only'],
    ['google', 'https://appleid.apple.com/auth/authorize?state=mock-only'],
    ['google', 'https://outside.example/authorize?state=mock-only']
  ] as const)(
    'rejects %s responses from a different authorization endpoint',
    async (provider, url) => {
      mockServer.use(
        http.post('*/api/auth/sign-in/social', () =>
          HttpResponse.json({ url: authorizationURL(url), redirect: true })
        )
      )
      await expect(signInSocial({ provider })).rejects.toBeDefined()
    }
  )
  it('does not expose removed password transports in MSW', async () => {
    for (const path of [
      'sign-in/email',
      'sign-up/email',
      'reset-password',
      'request-password-reset',
      'verify-email',
      'change-password'
    ]) {
      const response = await fetch('/api/auth/' + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })
      expect(response.status).toBe(404)
    }
  })
})
