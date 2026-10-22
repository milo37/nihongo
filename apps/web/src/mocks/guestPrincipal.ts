import { z } from 'zod'

export const MOCK_GUEST_PRINCIPAL_COOKIE_NAME = 'nihongo.mock_guest_principal'

export type MockGuestProof =
  | { kind: 'ABSENT' }
  | { kind: 'INVALID' }
  | { kind: 'VERIFIED'; id: string }

export type MockGuestCookies = Readonly<Record<string, unknown>>

export const inspectMockGuestProof = (
  request: Request,
  cookies?: MockGuestCookies
): MockGuestProof => {
  // The resolver cookie map is authoritative because browsers restrict the Cookie
  // request header. Request-only callers retain header parsing.
  const value = cookies
    ? cookies[MOCK_GUEST_PRINCIPAL_COOKIE_NAME]
    : request.headers
        .get('Cookie')
        ?.split(';')
        .map((entry) => entry.trim())
        .find((entry) =>
          entry.startsWith(`${MOCK_GUEST_PRINCIPAL_COOKIE_NAME}=`)
        )
        ?.slice(MOCK_GUEST_PRINCIPAL_COOKIE_NAME.length + 1)

  if (value === undefined || value === '') {
    return { kind: 'ABSENT' }
  }
  const parsed = z.uuid().safeParse(value)
  return parsed.success
    ? { kind: 'VERIFIED', id: parsed.data }
    : { kind: 'INVALID' }
}

// MSW는 synthetic Set-Cookie를 저장하고 resolver cookies로 전달한다. 이 UUID는 local mock의
// ownership conformance용 ID일 뿐 real session credential이 아니므로 HttpOnly를 쓰지 않는다.
export const createMockGuestPrincipalCookie = (id: string): string =>
  `${MOCK_GUEST_PRINCIPAL_COOKIE_NAME}=${id}; Path=/; SameSite=Lax; Max-Age=604800`

export const expireMockGuestPrincipalCookie = (): string =>
  `${MOCK_GUEST_PRINCIPAL_COOKIE_NAME}=; Path=/; SameSite=Lax; Max-Age=0`
