import { describe, expect, it } from 'vitest'
import {
  inspectMockGuestProof,
  MOCK_GUEST_PRINCIPAL_COOKIE_NAME
} from '@mocks/guestPrincipal'

const ownerId = 'e09f46b1-564d-467c-b1d7-90065e03bbfb'
const request = new Request('http://localhost', {
  headers: { Cookie: `${MOCK_GUEST_PRINCIPAL_COOKIE_NAME}=${ownerId}` }
})

describe('mock guest resolver cookie proof', () => {
  it('keeps Request-only callers compatible', () => {
    expect(inspectMockGuestProof(request)).toEqual({
      kind: 'VERIFIED',
      id: ownerId
    })
  })
  it('reads the resolver map without a Request Cookie header', () => {
    expect(
      inspectMockGuestProof(new Request('http://localhost'), {
        [MOCK_GUEST_PRINCIPAL_COOKIE_NAME]: ownerId
      })
    ).toEqual({ kind: 'VERIFIED', id: ownerId })
  })
  it('does not fall back to a valid header when the authoritative map is absent', () => {
    expect(inspectMockGuestProof(request, {})).toEqual({ kind: 'ABSENT' })
  })
  it.each([null, false, 0, {}, [], 'tampered', 'constructor'])(
    'rejects invalid resolver value %j',
    (value) => {
      expect(
        inspectMockGuestProof(request, {
          [MOCK_GUEST_PRINCIPAL_COOKIE_NAME]: value
        })
      ).toEqual({ kind: 'INVALID' })
    }
  )
})
