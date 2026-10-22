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
