import { describe, expect, it } from 'vitest'
import {
  adminFreshSsoRequestSchema,
  adminFreshSsoOutcomeSchema,
  safeAdminFreshReturnPath
} from './admin-fresh-sso.js'
import { safeSsoReturnPath } from './sign-in-social.js'
describe('ADMIN_FRESH distinct transport', () => {
  it('accepts only its explicit purpose and server-neutral provider', () => {
    expect(
      adminFreshSsoRequestSchema.parse({
        purpose: 'ADMIN_FRESH',
        provider: 'apple'
      }).callbackURL
    ).toBe('/login')
    for (const value of [
      { purpose: 'LOGIN', provider: 'google' },
      { purpose: 'ADMIN_FRESH', provider: 'google', role: 'ADMIN' },
      { purpose: 'ADMIN_FRESH', provider: 'naver' }
    ])
      expect(adminFreshSsoRequestSchema.safeParse(value).success).toBe(false)
  })
  it('keeps login return purpose-specific and preserves business policy', () => {
    expect(safeAdminFreshReturnPath('/login')).toBe('/login')
    expect(safeSsoReturnPath('/login')).toBe('/')
    expect(safeAdminFreshReturnPath('/admin/questions?page=2')).toBe(
      '/admin/questions?page=2'
    )
    for (const path of [
      'https://evil.example',
      '//evil.example',
      '/login?redirect=https://evil.example',
      '/login#token',
      '/login/../admin',
      '/account/data'
    ])
      expect(safeAdminFreshReturnPath(path)).toBe('/')
  })
  it('bounds fresh results separately from login hints', () => {
    expect(adminFreshSsoOutcomeSchema.parse('REAUTHENTICATED')).toBe(
      'REAUTHENTICATED'
    )
    expect(adminFreshSsoOutcomeSchema.safeParse('LINKED').success).toBe(false)
  })
})

describe('Google fresh report callback agreement', () => {
  it.each([
    '/admin/reports/11111111-1111-4111-8111-111111111111',
    '/admin/reports?status=OPEN&reason=OTHER&page=2'
  ])(
    'keeps the same safe report path through login and fresh parsing: %s',
    (path) => {
      const loginPath = safeSsoReturnPath(path)
      expect(loginPath).toBe(path)
      expect(safeAdminFreshReturnPath(loginPath)).toBe(path)
      expect(
        adminFreshSsoRequestSchema.parse({
          purpose: 'ADMIN_FRESH',
          provider: 'google',
          callbackURL: loginPath
        })
      ).toEqual({
        purpose: 'ADMIN_FRESH',
        provider: 'google',
        callbackURL: path
      })
    }
  )
  it.each([
    '/admin/reports/11111111-1111-4111-8111-111111111111?returnTo=%2Fadmin%2Freports',
    '/admin/reports?returnTo=%2F%2Fevil.test',
    '/admin/reports?reason=OTHER&reason=ANSWER_ERROR',
    '/admin/reports?role=ADMIN'
  ])(
    'does not bypass report callback validation for fresh entry: %s',
    (path) => {
      expect(safeAdminFreshReturnPath(path)).toBe('/')
      expect(
        adminFreshSsoRequestSchema.parse({
          purpose: 'ADMIN_FRESH',
          provider: 'google',
          callbackURL: path
        }).callbackURL
      ).toBe('/')
    }
  )
})
