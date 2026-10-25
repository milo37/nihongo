import { describe, expect, it } from 'vitest'
import {
  safeSsoReturnPath,
  isSsoAuthorizationURLForProvider,
  signInSocialRequestSchema,
  signInSocialResponseSchema,
  ssoCallbackOutcomeSchema
} from './sign-in-social.js'

const validURL = () => {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.search = new URLSearchParams({
    state: 's'.repeat(43),
    nonce: 'n'.repeat(43),
    code_challenge: 'c'.repeat(43),
    code_challenge_method: 'S256'
  }).toString()
  return url.href
}

describe('agreed SSO transport', () => {
  it('allows only user-selected Apple and Google and fixed Apple code form_post', () => {
    expect(
      signInSocialRequestSchema.parse({ provider: 'apple' }).provider
    ).toBe('apple')
    for (const provider of ['kakao', 'naver', 'credential']) {
      expect(signInSocialRequestSchema.safeParse({ provider }).success).toBe(
        false
      )
    }
    const apple = new URL(
      validURL().replace(
        'https://accounts.google.com/o/oauth2/v2/auth',
        'https://appleid.apple.com/auth/authorize'
      )
    )
    apple.searchParams.set('response_mode', 'form_post')
    apple.searchParams.set('response_type', 'code')
    expect(isSsoAuthorizationURLForProvider('apple', apple.href)).toBe(true)
    expect(isSsoAuthorizationURLForProvider('google', apple.href)).toBe(false)
    expect(isSsoAuthorizationURLForProvider('apple', validURL())).toBe(false)
    expect(
      signInSocialResponseSchema.safeParse({ url: apple.href, redirect: true })
        .success
    ).toBe(true)
    apple.searchParams.set('response_type', 'code id_token')
    expect(
      signInSocialResponseSchema.safeParse({ url: apple.href, redirect: true })
        .success
    ).toBe(false)
  })
  it('uses a strict provider request and normalizes unsafe return paths', () => {
    expect(
      signInSocialRequestSchema.parse({
        provider: 'google',
        callbackURL: '//evil.test'
      })
    ).toEqual({ provider: 'google', callbackURL: '/' })
    expect(
      signInSocialRequestSchema.safeParse({ provider: 'google', role: 'ADMIN' })
        .success
    ).toBe(false)
    expect(
      signInSocialRequestSchema.safeParse({ provider: 'other' }).success
    ).toBe(false)
  })
  it('allows only fixed Google URL/PKCE and prevents response token leakage', () => {
    expect(
      signInSocialResponseSchema.parse({ url: validURL(), redirect: true })
        .redirect
    ).toBe(true)
    expect(
      signInSocialResponseSchema.safeParse({
        url: validURL(),
        redirect: true,
        token: 'must-not-return'
      }).success
    ).toBe(false)
    expect(
      signInSocialResponseSchema.safeParse({
        url: validURL().replace('accounts.google.com', 'evil.test'),
        redirect: true
      }).success
    ).toBe(false)
    const duplicate = new URL(validURL())
    duplicate.searchParams.append('state', 'x'.repeat(43))
    expect(
      signInSocialResponseSchema.safeParse({
        url: duplicate.href,
        redirect: true
      }).success
    ).toBe(false)
  })
  it('shares exactly the three callback failure outcomes', () => {
    for (const outcome of ['CANCELLED', 'FAILED', 'INVALID_CALLBACK']) {
      expect(ssoCallbackOutcomeSchema.parse(outcome)).toBe(outcome)
    }
    expect(
      ssoCallbackOutcomeSchema.safeParse('IDENTITY_VERIFIED').success
    ).toBe(false)
    expect(
      ssoCallbackOutcomeSchema.safeParse('provider-raw-error').success
    ).toBe(false)
  })
  it.each([
    '/dashboard?view=learning&count=5&resumePage=2',
    '/wrong-notes?view=UNREVIEWED&questionType=KANJI_READING&tag=example&page=2',
    '/practice/result/session-id?question=question-id'
  ])('retains actual UI filters: %s', (value) => {
    expect(safeSsoReturnPath(value)).toBe(value)
  })
  it('canonicalizes a finite detail-to-review-list returnTo', () => {
    const nested = '/wrong-notes/history?status=NEW&page=2'
    const result = safeSsoReturnPath(
      '/wrong-notes/question-id?returnTo=' + encodeURIComponent(nested)
    )
    expect(
      new URL(result, 'https://app.test').searchParams.get('returnTo')
    ).toBe('/wrong-notes?view=UNREVIEWED&page=2')
    expect(
      new URL(
        safeSsoReturnPath('/wrong-notes/question-id?returnTo=%2Fdashboard'),
        'https://app.test'
      ).searchParams.get('returnTo')
    ).toBe('/wrong-notes')
  })
  it.each([
    'https://evil.test',
    '//evil.test',
    '/login',
    '/wrong-notes#fragment',
    '/wrong-notes?page=1&page=2',
    '/wrong-notes?returnTo=%2Fwrong-notes',
    '/wrong-notes?keep=test',
    '/wrong-notes/%2e%2e/login'
  ])('rejects unsafe nested returnTo: %s', (nested) => {
    expect(
      safeSsoReturnPath(
        '/wrong-notes/question-id?returnTo=' + encodeURIComponent(nested)
      )
    ).toBe('/')
  })
  it('rejects returnTo outside a wrong-note detail', () => {
    expect(safeSsoReturnPath('/dashboard?returnTo=%2Fwrong-notes')).toBe('/')
  })
})

describe('report-owned SSO return paths', () => {
  const id = '11111111-1111-4111-8111-111111111111'
  it.each([
    '/admin/reports',
    `/admin/reports/${id}`,
    '/admin/reports?status=OPEN&reason=OTHER&page=2&pageSize=50&sort=CREATED_DESC'
  ])('preserves the agreed report destination %s', (path) => {
    expect(safeSsoReturnPath(path)).toBe(path)
  })
  it('accepts exactly the existing strict report list filters and date ranges', () => {
    const path =
      '/admin/reports?' +
      new URLSearchParams({
        status: 'TRIAGED',
        reason: 'AMBIGUOUS',
        questionId: id,
        assigneeActorId: '22222222-2222-4222-8222-222222222222',
        createdFrom: '2026-01-01T00:00:00Z',
        createdTo: '2026-01-02T00:00:00Z',
        updatedFrom: '2026-01-03T00:00:00Z',
        updatedTo: '2026-01-04T00:00:00Z',
        sort: 'CREATED_DESC',
        page: '2',
        pageSize: '50'
      }).toString()
    expect(safeSsoReturnPath(path)).toBe(path)
  })
  it.each([
    `/admin/reports/${id}?page=2`,
    `/admin/reports/${id}?returnTo=%2Fadmin%2Freports`,
    `/admin/reports/${id}/resolve`,
    '/admin/reports/not-an-id',
    '/admin/reports/',
    '/admin/reports?returnTo=%2Fadmin%2Freports',
    '/admin/reports?redirect=https%3A%2F%2Fevil.test',
    '/admin/reports?status=OPEN&status=TRIAGED',
    '/admin/reports?page=1&page=2',
    '/admin/reports?status=DRAFT',
    '/admin/reports?reason=WRONG',
    '/admin/reports?questionId=not-an-id',
    '/admin/reports?assigneeActorId=not-an-id',
    '/admin/reports?sort=RANDOM',
    '/admin/reports?page=0',
    '/admin/reports?pageSize=101',
    '/admin/reports?level=N5',
    '/admin/reports?search=anything',
    '/admin/reports?createdFrom=invalid',
    '/admin/reports?createdFrom=2026-01-02T00%3A00%3A00Z&createdTo=2026-01-01T00%3A00%3A00Z',
    '/admin/reports?updatedFrom=2024-01-01T00%3A00%3A00Z&updatedTo=2026-01-01T00%3A00%3A00Z',
    '/admin/reports/%2e%2e/questions',
    `/admin/reports/%2F${id}`,
    '/reports',
    `/reports/${id}`,
    '/admin/admin/reports',
    'https://evil.test/admin/reports',
    '//evil.test/admin/reports',
    '/admin/reports#token',
    '/admin/reports?status=OPEN\n',
    '/admin/reports?' + 'x'.repeat(2048),
    '/bookmarks?reason=OTHER',
    `/admin/questions?assigneeActorId=${id}`,
    '/wrong-notes/question-id?returnTo=%2Fadmin%2Freports'
  ])('keeps report and generic navigation boundaries closed: %s', (path) => {
    expect(safeSsoReturnPath(path)).toBe('/')
  })
})
