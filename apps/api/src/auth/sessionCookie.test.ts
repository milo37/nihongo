import { describe, expect, it } from 'vitest'
import {
  createSessionCookie,
  createPhase7SessionCookie,
  createDontRememberCookie,
  createPhase7DontRememberCookie,
  createExpiredSessionCookies,
  createExpiredPhase7SessionCookies,
  readSessionToken,
  readPhase7SessionToken
} from './sessionCookie.js'

describe('session cookie compatibility', () => {
  it('preserves exported objects, names, cookie bytes, and rejection behavior', () => {
    expect(createSessionCookie).toBe(createPhase7SessionCookie)
    expect(createDontRememberCookie).toBe(createPhase7DontRememberCookie)
    expect(createExpiredSessionCookies).toBe(createExpiredPhase7SessionCookies)
    expect(readSessionToken).toBe(readPhase7SessionToken)
    expect([
      createSessionCookie.name,
      createDontRememberCookie.name,
      createExpiredSessionCookies.name,
      readSessionToken.name
    ]).toEqual([
      'createPhase7SessionCookie',
      'createPhase7DontRememberCookie',
      'createExpiredPhase7SessionCookies',
      'readPhase7SessionToken'
    ])

    const secret = 'fixture-secret'
    const cookie = createSessionCookie({
      token: 'token-123',
      secret,
      isProduction: true,
      rememberMe: true,
      now: new Date('2026-01-01T00:00:00Z'),
      expiresAt: new Date('2026-01-01T00:01:00Z')
    })
    const pair =
      '__Secure-nihongo.session_token=token-123.dxKDM6jH3mGfIPV0uioZ45qlvK0jJPoURnshZYjjb7E%3D'
    expect(cookie).toBe(
      `${pair}; Max-Age=60; Path=/; HttpOnly; SameSite=Lax; Secure`
    )
    expect(createDontRememberCookie({ isProduction: true, secret })).toBe(
      '__Secure-nihongo.dont_remember=true.0AKyvg6gwI5PGtzA%2FsnDl9Fl3Lx5UsHpXAgIf4L6n%2BQ%3D; Path=/; HttpOnly; SameSite=Lax; Secure'
    )
    expect(createExpiredSessionCookies(true)).toEqual([
      'nihongo.session_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure',
      '__Secure-nihongo.session_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure'
    ])
    const read = (cookieHeader: string) =>
      readSessionToken({ cookieHeader, isProduction: true, secret })
    expect(read(pair)).toEqual({ present: true, token: 'token-123' })
    expect(read(pair.replace('token-123', 'token-124'))).toEqual({
      present: true,
      token: null
    })
    expect(read(`${pair}; ${pair}`)).toEqual({ present: true, token: null })
  })

  it('keeps development and session-only cookie attributes', () => {
    const cookie = createSessionCookie({
      token: 'token-123',
      secret: 'fixture-secret',
      isProduction: false,
      rememberMe: false,
      now: new Date('2026-01-01T00:00:00Z'),
      expiresAt: new Date('2026-01-01T00:01:00Z')
    })
    expect(cookie).toBe(
      'nihongo.session_token=token-123.dxKDM6jH3mGfIPV0uioZ45qlvK0jJPoURnshZYjjb7E%3D; Path=/; HttpOnly; SameSite=Lax'
    )
    expect(createExpiredSessionCookies(false)).toEqual([
      'nihongo.session_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
      '__Secure-nihongo.session_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'
    ])
  })

  it('rejects malformed or oversized cookies and distinguishes missing cookies', () => {
    const read = (cookieHeader: string | null) =>
      readSessionToken({
        cookieHeader,
        isProduction: true,
        secret: 'fixture-secret'
      })
    expect(read(null)).toEqual({ present: false, token: null })
    expect(read('another=value')).toEqual({ present: false, token: null })
    expect(read('__Secure-nihongo.session_token=%zz')).toEqual({
      present: true,
      token: null
    })
    expect(read(`__Secure-nihongo.session_token=${'a'.repeat(4097)}`)).toEqual({
      present: true,
      token: null
    })
  })
})
