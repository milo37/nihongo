import { describe, expect, it } from 'vitest'
import {
  ADMIN_FRESH_WINDOW_SECONDS,
  adminFreshSsoRequestSchema,
  adminFreshSsoOutcomeSchema,
  safeAdminFreshReturnPath
} from './admin-fresh-sso.js'
import { safeSsoReturnPath } from './sign-in-social.js'
describe('ADMIN_FRESH distinct transport', () => {
  it('opens a 30-minute window (#683)', () => {
    expect(ADMIN_FRESH_WINDOW_SECONDS).toBe(1_800)
  })
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
  it('keeps login return purpose-specific', () => {
    expect(safeAdminFreshReturnPath('/login')).toBe('/login')
    expect(safeAdminFreshReturnPath(undefined)).toBe('/login')
    expect(safeSsoReturnPath('/login')).toBe('/')
  })
  // #683: the same-tab return lands only on admin pages that start a
  // fresh-required command, with only their own navigation keys.
  it.each([
    '/admin/questions',
    '/admin/questions?status=IN_REVIEW&level=N3&page=2&pageSize=100',
    '/admin/questions?search=%E3%81%82&sort=STATUS&subject=VOCABULARY&difficulty=EASY',
    '/admin/questions/new?returnTo=%2Fadmin%2Fquestions%3Fpage%3D2',
    '/admin/questions/import',
    '/admin/questions/11111111-1111-4111-8111-111111111111',
    '/admin/questions/11111111-1111-4111-8111-111111111111?version=22222222-2222-4222-8222-222222222222&returnTo=%2Fadmin%2Fquestions',
    '/admin/questions/11111111-1111-4111-8111-111111111111/edit?returnTo=%2Fadmin%2Fquestions%3Fstatus%3DDRAFT',
    '/admin/members',
    '/admin/members?sort=joinedAt&order=asc&page=3&pageSize=50',
    '/admin/members/11111111-1111-4111-8111-111111111111'
  ])('returns to the admin page: %s', (path) => {
    expect(safeAdminFreshReturnPath(path)).toBe(path)
  })
  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '/admin/questions#approve',
    '/admin/questions?status=IN_REVIEW&status=DRAFT',
    '/admin/questions?action=approve',
    '/admin/questions?returnTo=%2Fadmin%2Fquestions',
    '/admin/questions/not-an-id',
    '/admin/questions/11111111-1111-4111-8111-111111111111/approve',
    '/admin/questions/11111111-1111-4111-8111-111111111111/edit?version=1',
    '/admin/questions/11111111-1111-4111-8111-111111111111?returnTo=https%3A%2F%2Fevil.example',
    '/admin/questions/11111111-1111-4111-8111-111111111111?returnTo=%2Fdashboard',
    '/admin/questions/new?returnTo=%2F%2Fevil.example',
    '/admin/questions/import?file=x',
    '/admin/members?email=learner%40example.com',
    '/admin/members/11111111-1111-4111-8111-111111111111?tab=restrict',
    '/admin/members/11111111-1111-4111-8111-111111111111/restriction',
    '/admin/audit-log',
    '/admin',
    '/admin/../dashboard',
    '/dashboard',
    '/questions?page=2',
    '/login?redirect=https://evil.example',
    '/login#token',
    '/account/data'
  ])('lands anything else on /: %s', (path) => {
    expect(safeAdminFreshReturnPath(path)).toBe('/')
    expect(
      adminFreshSsoRequestSchema.parse({
        purpose: 'ADMIN_FRESH',
        provider: 'google',
        callbackURL: path
      }).callbackURL
    ).toBe('/')
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
