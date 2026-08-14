import { http, HttpResponse } from 'msw'
import { getCurrentPrincipalResponseSchema } from '@nihongo/contracts/auth/get-current-principal'
import { signInUserRequestSchema } from '@api/auth/signInUser/schema'
import { signUpUserRequestSchema } from '@api/auth/signUpUser/schema'
import { requestPasswordResetRequestSchema } from '@api/auth/requestPasswordReset/schema'
import { resetPasswordRequestSchema } from '@api/auth/resetPassword/schema'
import { verifyEmailRequestSchema } from '@api/auth/verifyEmail/schema'
import type { User } from '@common/types/domain'
import {
  expireMockGuestPrincipalCookie,
  inspectMockGuestProof
} from '@mocks/guestPrincipal'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import {
  MockHttpError,
  parseJsonBody,
  toErrorResponse
} from '@mocks/handlers/shared'

const MOCK_USER_EMAIL = 'user@example.com'
const MOCK_USER_PASSWORD = 'Demo-user-2026!'
const MOCK_ADMIN_EMAIL = 'admin@example.com'
const MOCK_ADMIN_PASSWORD = 'Demo-admin-2026!'

const rejectUnsupportedMockAuth = (): never => {
  throw new MockHttpError(
    501,
    'MOCK_AUTH_UNSUPPORTED',
    '이 인증 기능은 real API 모드에서만 사용할 수 있습니다.'
  )
}

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

export const authHandlers = [
  http.get('*/api/v1/me', () => {
    try {
      return HttpResponse.json(createCurrentPrincipalResponse(), {
        headers: { 'Cache-Control': 'private, no-store' }
      })
    } catch (error: unknown) {
      return toErrorResponse(error)
    }
  }),
  http.delete('*/api/v1/guest-principal', ({ request }) => {
    try {
      if (mockDatabase.getCurrentUser()) {
        return new HttpResponse(null, {
          status: 204,
          headers: { 'Cache-Control': 'private, no-store' }
        })
      }

      const proof = inspectMockGuestProof(request)
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
      return toErrorResponse(error)
    }
  }),
  http.post('*/api/auth/sign-in/email', async ({ request }) => {
    try {
      const input = await parseJsonBody(request, signInUserRequestSchema)
      const isAdmin =
        input.email === MOCK_ADMIN_EMAIL &&
        input.password === MOCK_ADMIN_PASSWORD
      const isUser =
        input.email === MOCK_USER_EMAIL && input.password === MOCK_USER_PASSWORD

      if (!isAdmin && !isUser) {
        throw new MockHttpError(
          401,
          'INVALID_EMAIL_OR_PASSWORD',
          '이메일 또는 비밀번호가 올바르지 않습니다.'
        )
      }

      mockDatabase.loginAs(isAdmin ? 'ADMIN' : 'USER')
      return HttpResponse.json({ success: true as const })
    } catch (error: unknown) {
      return toErrorResponse(error)
    }
  }),
  http.post('*/api/auth/sign-up/email', async ({ request }) => {
    try {
      await parseJsonBody(request, signUpUserRequestSchema)
      return rejectUnsupportedMockAuth()
    } catch (error: unknown) {
      return toErrorResponse(error)
    }
  }),
  http.post('*/api/auth/request-password-reset', async ({ request }) => {
    try {
      await parseJsonBody(request, requestPasswordResetRequestSchema)
      return rejectUnsupportedMockAuth()
    } catch (error: unknown) {
      return toErrorResponse(error)
    }
  }),
  http.post('*/api/auth/reset-password', async ({ request }) => {
    try {
      await parseJsonBody(request, resetPasswordRequestSchema)
      return rejectUnsupportedMockAuth()
    } catch (error: unknown) {
      return toErrorResponse(error)
    }
  }),
  http.post('*/api/auth/verify-email', async ({ request }) => {
    try {
      await parseJsonBody(request, verifyEmailRequestSchema)
      return rejectUnsupportedMockAuth()
    } catch (error: unknown) {
      return toErrorResponse(error)
    }
  }),
  http.post('*/api/auth/sign-out', () => {
    try {
      mockDatabase.logout()
      return HttpResponse.json({ success: true as const })
    } catch (error: unknown) {
      return toErrorResponse(error)
    }
  })
]
