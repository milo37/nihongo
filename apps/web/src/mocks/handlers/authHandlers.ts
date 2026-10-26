import type {
  SsoAccountCapabilities,
  SsoAccountDeletion,
  UnlinkSsoAccountResponse
} from '@nihongo/contracts/auth/sso-account-management'
import {
  accountSsoRequestSchema,
  unlinkSsoAccountRequestSchema,
  deleteSsoAccountRequestSchema
} from '@nihongo/contracts/auth/sso-account-management'
import { MockSsoAccountError } from '@mocks/repository/ssoAccountRepository'
import { http, HttpResponse } from 'msw'
import { adminFreshSsoRequestSchema } from '@nihongo/contracts/auth/admin-fresh-sso'
import { z } from 'zod'
import { getCurrentPrincipalResponseSchema } from '@nihongo/contracts/auth/get-current-principal'
import {
  signInSocialRequestSchema,
  ssoProviderIdSchema,
  type SsoProviderId
} from '@nihongo/contracts/auth/sign-in-social'
import type { User } from '@nihongo/browser/common/types/domain'
import {
  expireMockGuestPrincipalCookie,
  inspectMockGuestProof
} from '@mocks/guestPrincipal'
import { DEMO_USER_ID, demoUsers } from '@mocks/data/users'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import {
  MockHttpError,
  parseJsonBody,
  toErrorResponse
} from '@mocks/handlers/shared'

// Fixture identity comes from this private Mock mapping, never request roles/email.
const fixtureIds: Record<SsoProviderId, string> = {
  apple: DEMO_USER_ID,
  google: DEMO_USER_ID
}
let pendingProvider: SsoProviderId | null = null
export const resetMockSocialSignInForTesting = (): void => {
  pendingProvider = null
  fixtureIds.apple = DEMO_USER_ID
  fixtureIds.google = DEMO_USER_ID
}
export const setMockSsoAccountForTesting = (
  provider: SsoProviderId,
  userId: string
): void => {
  if (!demoUsers.some((user) => user.id === userId))
    throw new Error('Unknown Mock identity fixture.')
  fixtureIds[provider] = userId
}
const mockCallbackSchema = z.object({ provider: ssoProviderIdSchema }).strict()
const removedAuthPaths = [
  '/api/auth/sign-in/email',
  '/api/auth/sign-up/email',
  '/api/auth/request-password-reset',
  '/api/auth/reset-password',
  '/api/auth/verify-email',
  '/api/auth/change-password'
] as const
const toAuthenticatedUser = (user: User) => ({
  id: user.id,
  name: user.name,
  role: user.role === 'ADMIN' ? ('ADMIN' as const) : ('USER' as const),
  targetLevel: user.targetLevel
})

const createCurrentPrincipalResponse = () => {
  const user = mockDatabase.getCurrentUser()
  return getCurrentPrincipalResponseSchema.parse(
    user ? { kind: 'USER', user: toAuthenticatedUser(user) } : { kind: 'GUEST' }
  )
}

const accountErrorResponse = (error: unknown) =>
  error instanceof MockSsoAccountError
    ? HttpResponse.json(
        { code: error.code, message: '계정 요청을 완료하지 못했습니다.' },
        { status: error.status }
      )
    : toErrorResponse(error)
const accountRead = (
  operation: () =>
    | SsoAccountCapabilities
    | SsoAccountDeletion
    | UnlinkSsoAccountResponse,
  status = 200
) => {
  try {
    return HttpResponse.json(operation(), {
      status,
      headers: { 'Cache-Control': 'private, no-store' }
    })
  } catch (error: unknown) {
    return accountErrorResponse(error)
  }
}
export const authHandlers = [
  http.get('*/api/auth/sso/accounts', () =>
    accountRead(() => mockDatabase.ssoAccounts.capabilities())
  ),
  http.get('*/api/auth/sso/deletion', () =>
    accountRead(() => mockDatabase.ssoAccounts.deletion())
  ),
  http.post('*/api/auth/sso/unlink', async ({ request }) => {
    try {
      const input = await parseJsonBody(request, unlinkSsoAccountRequestSchema)
      return accountRead(() => mockDatabase.ssoAccounts.unlink(input.provider))
    } catch (error: unknown) {
      return accountErrorResponse(error)
    }
  }),
  http.post('*/api/auth/sso/delete-account', async ({ request }) => {
    try {
      await parseJsonBody(request, deleteSsoAccountRequestSchema)
      return accountRead(() => mockDatabase.ssoAccounts.deleteAccount(), 202)
    } catch (error: unknown) {
      return accountErrorResponse(error)
    }
  }),
  http.post('*/api/_mock/auth/account/callback', async ({ request }) => {
    try {
      const input = await parseJsonBody(request, accountSsoRequestSchema)
      return accountRead(() =>
        mockDatabase.ssoAccounts.complete(input, fixtureIds[input.provider])
      )
    } catch (error: unknown) {
      return accountErrorResponse(error)
    }
  }),
  http.get('*/api/v1/me', () => {
    try {
      return HttpResponse.json(createCurrentPrincipalResponse(), {
        headers: { 'Cache-Control': 'private, no-store' }
      })
    } catch (error: unknown) {
      const response = toErrorResponse(error)
      response.headers.set('Cache-Control', 'private, no-store')
      return response
    }
  }),
  http.delete('*/api/v1/guest-principal', ({ request, cookies }) => {
    try {
      if (mockDatabase.getCurrentUser()) {
        return new HttpResponse(null, {
          status: 204,
          headers: { 'Cache-Control': 'private, no-store' }
        })
      }

      const proof = inspectMockGuestProof(request, cookies)
      if (proof.kind === 'VERIFIED') {
        mockDatabase.deleteCanonicalGuestPrincipal(proof.id)
      }

      return new HttpResponse(null, {
        status: 204,
        headers: {
          'Cache-Control': 'private, no-store',
          'Set-Cookie': expireMockGuestPrincipalCookie()
        }
      })
    } catch (error: unknown) {
      return accountErrorResponse(error)
    }
  }),
  http.post('*/api/auth/sign-in/social', async ({ request }) => {
    try {
      const input = await parseJsonBody(
        request,
        z.union([
          signInSocialRequestSchema,
          adminFreshSsoRequestSchema,
          accountSsoRequestSchema
        ])
      )
      if ('purpose' in input && input.purpose !== 'ADMIN_FRESH') {
        mockDatabase.ssoAccounts.prepare(input)
      } else if ('purpose' in input) {
        pendingProvider = null
        const actor = mockDatabase.getCurrentUser()
        if (!actor)
          throw new MockHttpError(
            401,
            'AUTHENTICATION_REQUIRED',
            '로그인이 필요합니다.'
          )
        if (actor.role !== 'ADMIN')
          throw new MockHttpError(
            403,
            'ADMIN_REQUIRED',
            '관리자 권한이 필요합니다.'
          )
        if (fixtureIds[input.provider] !== actor.id)
          throw new MockHttpError(
            401,
            'REAUTHENTICATION_FAILED',
            '같은 관리자 계정으로 다시 시도해 주세요.'
          )
      } else pendingProvider = input.provider
      const url = new URL(
        input.provider === 'apple'
          ? 'https://appleid.apple.com/auth/authorize'
          : 'https://accounts.google.com/o/oauth2/v2/auth'
      )
      // Synthetic protocol-shape fixture only; never sent to a provider.
      url.search = new URLSearchParams({
        client_id: 'mock-client',
        response_type: 'code',
        state: 's'.repeat(43),
        nonce: 'n'.repeat(43),
        code_challenge: 'c'.repeat(43),
        code_challenge_method: 'S256',
        ...(input.provider === 'apple' ? { response_mode: 'form_post' } : {})
      }).toString()
      return HttpResponse.json(
        { url: url.href, redirect: true },
        { headers: { 'Cache-Control': 'private, no-store' } }
      )
    } catch (error: unknown) {
      return accountErrorResponse(error)
    }
  }),
  // This endpoint exists only in the dev/test MSW worker; no real OAuth tokens.
  http.post('*/api/_mock/auth/social/callback', async ({ request }) => {
    try {
      const { provider } = await parseJsonBody(request, mockCallbackSchema)
      if (pendingProvider !== provider)
        throw new MockHttpError(
          400,
          'INVALID_CALLBACK',
          'Mock 로그인 요청이 일치하지 않습니다.'
        )
      pendingProvider = null
      const fixture = demoUsers.find((user) => user.id === fixtureIds[provider])
      if (!fixture) throw new Error('Missing Mock identity fixture.')
      mockDatabase.ssoAccounts.noteLogin(provider, fixture.id)
      mockDatabase.loginAs(
        fixture.role === 'ADMIN' ? 'ADMIN' : 'USER',
        fixture.id
      )
      return HttpResponse.json(createCurrentPrincipalResponse(), {
        headers: { 'Cache-Control': 'private, no-store' }
      })
    } catch (error: unknown) {
      return accountErrorResponse(error)
    }
  }),
  ...removedAuthPaths.map((path) =>
    http.all('*' + path, () =>
      HttpResponse.json(
        { code: 'NOT_FOUND', message: '요청한 경로를 찾을 수 없습니다.' },
        { status: 404 }
      )
    )
  ),
  http.post('*/api/auth/sign-out', () => {
    try {
      pendingProvider = null
      mockDatabase.logout()
      return HttpResponse.json({ success: true as const })
    } catch (error: unknown) {
      return accountErrorResponse(error)
    }
  })
]
