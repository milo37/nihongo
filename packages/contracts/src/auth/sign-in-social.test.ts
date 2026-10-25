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
