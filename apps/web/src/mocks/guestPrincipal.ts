import { z } from 'zod'

export const MOCK_GUEST_PRINCIPAL_COOKIE_NAME = 'nihongo.mock_guest_principal'

export type MockGuestProof =
  | { kind: 'ABSENT' }
  | { kind: 'INVALID' }
  | { kind: 'VERIFIED'; id: string }

export const inspectMockGuestProof = (request: Request): MockGuestProof => {
  const value = request.headers
    .get('Cookie')
    ?.split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${MOCK_GUEST_PRINCIPAL_COOKIE_NAME}=`))
    ?.slice(MOCK_GUEST_PRINCIPAL_COOKIE_NAME.length + 1)

  if (!value) {
    return { kind: 'ABSENT' }
  }
  const parsed = z.uuid().safeParse(value)
  return parsed.success
    ? { kind: 'VERIFIED', id: parsed.data }
    : { kind: 'INVALID' }
}

// MSW는 synthetic Set-Cookie를 document.cookie로 전달한다. 이 UUID는 local mock의
// ownership conformance용 ID일 뿐 real session credential이 아니므로 HttpOnly를 쓰지 않는다.
export const createMockGuestPrincipalCookie = (id: string): string =>
  `${MOCK_GUEST_PRINCIPAL_COOKIE_NAME}=${id}; Path=/; SameSite=Lax; Max-Age=604800`

export const expireMockGuestPrincipalCookie = (): string =>
  `${MOCK_GUEST_PRINCIPAL_COOKIE_NAME}=; Path=/; SameSite=Lax; Max-Age=0`
