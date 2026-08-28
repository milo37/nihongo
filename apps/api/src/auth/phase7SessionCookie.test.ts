import { describe, expect, it } from 'vitest'
import {
  createExpiredPhase7SessionCookies,
  createPhase7SessionCookie,
  readPhase7SessionToken
} from './phase7SessionCookie.js'

const secret = 'phase7-cookie-secret-that-is-at-least-32-characters'

describe('Phase 7 session cookie', () => {
  it('Better Call HMAC-SHA256 형식으로 서명하고 검증한다', () => {
    const cookie = createPhase7SessionCookie({
      expiresAt: new Date('2026-08-28T01:00:00.000Z'),
      isProduction: false,
      now: new Date('2026-08-28T00:00:00.000Z'),
      secret,
      token: 'raw-session-token'
    })

    expect(cookie).toContain('nihongo.session_token=raw-session-token.')
    expect(cookie).toContain('Max-Age=3600')
    expect(
      readPhase7SessionToken({
        cookieHeader: cookie,
        isProduction: false,
        secret
      })
    ).toEqual({ present: true, token: 'raw-session-token' })
  })

  it('변조·중복·잘못된 encoding을 credential 없이 거부한다', () => {
    const cookie = createPhase7SessionCookie({
      expiresAt: new Date(Date.now() + 60_000),
      isProduction: false,
      secret,
      token: 'token'
    })
    const value = cookie.split(';')[0]!
    const unpaddedValue = value.endsWith('%3D')
      ? value.slice(0, -3)
      : value.slice(0, -1)

    for (const cookieHeader of [
      value.replace('token.', 'other.'),
      `${value}; ${value}`,
      unpaddedValue,
      'nihongo.session_token=%invalid'
    ]) {
      expect(
        readPhase7SessionToken({ cookieHeader, isProduction: false, secret })
      ).toEqual({ present: true, token: null })
    }
  })

  it('production 이름과 양쪽 만료 cookie를 고정한다', () => {
    const cookie = createPhase7SessionCookie({
      expiresAt: new Date(Date.now() + 60_000),
      isProduction: true,
      secret,
      token: 'token'
    })
    expect(cookie).toContain('__Secure-nihongo.session_token=')
    expect(cookie).toContain('; Secure')
    expect(createExpiredPhase7SessionCookies(true)).toHaveLength(2)
  })
})
