import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { expireMockGuestPrincipalCookie } from '@mocks/guestPrincipal'
import { handlers } from '@mocks/handlers'

export const mockServer = setupServer(...handlers)

const MOCK_GUEST_COOKIE_RESET_URL =
  'http://localhost/__test__/mock-guest-principal-cookie'
export const clearMockGuestPrincipalCookie = async (): Promise<void> => {
  const expiredMockGuestCookie = expireMockGuestPrincipalCookie()
  document.cookie = expiredMockGuestCookie
  mockServer.use(
    http.delete(
      MOCK_GUEST_COOKIE_RESET_URL,
      () =>
        new HttpResponse(null, {
          headers: { 'Set-Cookie': expiredMockGuestCookie }
        }),
      { once: true }
    )
  )

  const response = await fetch(MOCK_GUEST_COOKIE_RESET_URL, {
    method: 'DELETE'
  })
  if (!response.ok) {
    throw new Error('MSW mock guest cookie를 초기화하지 못했습니다.')
  }
}
