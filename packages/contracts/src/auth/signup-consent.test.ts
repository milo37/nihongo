import { describe, expect, it } from 'vitest'
import {
  SIGNUP_CONSENT_PATHS,
  SIGNUP_PENDING_SECONDS,
  cancelSignupConsentRequestSchema,
  signupConsentErrorCodeSchema,
  signupConsentRequestSchema,
  signupConsentResponseSchema,
  signupConsentStateSchema
} from './signup-consent.js'

describe('sign-up consent contract (#1085)', () => {
  it('keeps the routes under the SSO auth paths and a 10-minute pending', () => {
    expect(SIGNUP_CONSENT_PATHS).toEqual({
      consent: '/api/auth/sso/signup-consent',
      cancel: '/api/auth/sso/signup-consent/cancel'
    })
    expect(SIGNUP_PENDING_SECONDS).toBe(600)
  })

  it('accepts only both boxes checked', () => {
    expect(
      signupConsentRequestSchema.safeParse({
        ageConfirmed: true,
        termsConfirmed: true
      }).success
    ).toBe(true)
    for (const body of [
      {},
      { ageConfirmed: true },
      { ageConfirmed: true, termsConfirmed: false },
      { ageConfirmed: true, termsConfirmed: true, extra: 1 }
    ])
      expect(signupConsentRequestSchema.safeParse(body).success).toBe(false)
    expect(cancelSignupConsentRequestSchema.safeParse({}).success).toBe(true)
  })

  it('reads the pending kind and a same-site return path only', () => {
    const state = {
      kind: 'EXISTING',
      expiresAt: '2026-11-17T05:10:00.000Z',
      redirect: '/study'
    }
    expect(signupConsentStateSchema.parse(state)).toEqual(state)
    expect(
      signupConsentStateSchema.safeParse({ ...state, kind: 'ADMIN' }).success
    ).toBe(false)
    expect(
      signupConsentResponseSchema.safeParse({
        signedIn: true,
        redirect: 'https://elsewhere.example/'
      }).success
    ).toBe(false)
    expect(signupConsentErrorCodeSchema.options).toEqual([
      'SIGNUP_CONSENT_REQUIRED',
      'SIGNUP_PENDING_EXPIRED',
      'SIGNUP_UNAVAILABLE'
    ])
  })
})
