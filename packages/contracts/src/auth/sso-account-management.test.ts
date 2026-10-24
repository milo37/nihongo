import { describe, expect, it } from 'vitest'
import {
  accountSsoRequestSchema,
  ssoAccountCapabilitiesSchema,
  ssoAccountDeletionSchema,
  unlinkSsoAccountRequestSchema,
  deleteSsoAccountRequestSchema
} from './sso-account-management.js'
const capabilities = {
  providers: [
    {
      provider: 'google',
      reauthAvailable: true,
      canUnlink: false,
      unlinkBlockedReason: 'LAST_SIGN_IN_METHOD'
    }
  ],
  linkableProviders: ['apple'],
  unlinkRequiresFresh: false,
  canDelete: true,
  deletionBlockedReason: null,
  deleteRequiresFresh: true,
  freshVerified: false
}
describe('SSO account transport', () => {
  it.each(['ACCOUNT_FRESH', 'ACCOUNT_LINK'])(
    'strict %s keeps LOGIN allowlist separate',
    (purpose) => {
      expect(
        accountSsoRequestSchema.parse({
          purpose,
          provider: 'apple',
          callbackURL: '/login'
        }).callbackURL
      ).toBe('/login')
      expect(
        accountSsoRequestSchema.parse({
          purpose,
          provider: 'google',
          callbackURL: 'https://evil.test'
        }).callbackURL
      ).toBe('/')
      expect(
        accountSsoRequestSchema.safeParse({
          purpose,
          provider: 'google',
          userId: 'injected'
        }).success
      ).toBe(false)
    }
  )
  it.each(['LOGIN', 'ADMIN_FRESH', 'OTHER'])(
    'rejects unrelated purpose %s',
    (purpose) =>
      expect(
        accountSsoRequestSchema.safeParse({ purpose, provider: 'google' })
          .success
      ).toBe(false)
  )
  it('preserves explicit actual providers and denies contradictory grants', () => {
    expect(ssoAccountCapabilitiesSchema.parse(capabilities)).toEqual(
      capabilities
    )
    expect(
      ssoAccountCapabilitiesSchema.safeParse({
        ...capabilities,
        providers: [{ ...capabilities.providers[0], canUnlink: true }]
      }).success
    ).toBe(false)
    expect(
      ssoAccountCapabilitiesSchema.safeParse({
        ...capabilities,
        providers: [...capabilities.providers, ...capabilities.providers]
      }).success
    ).toBe(false)
    expect(
      ssoAccountCapabilitiesSchema.safeParse({
        ...capabilities,
        linkableProviders: ['google']
      }).success
    ).toBe(false)
    expect(
      ssoAccountCapabilitiesSchema.safeParse({
        ...capabilities,
        canDelete: false
      }).success
    ).toBe(false)
  })
  it('separates accepted/completed erasure and provider cleanup', () => {
    for (const appStatus of ['DELETION_PENDING', 'DELETED'])
      expect(
        ssoAccountDeletionSchema.parse({
          appStatus,
          providerCleanup: [
            { provider: 'apple', status: 'PENDING' },
            { provider: 'google', status: 'FAILED' }
          ]
        }).appStatus
      ).toBe(appStatus)
    expect(
      ssoAccountDeletionSchema.safeParse({
        appStatus: 'DELETED',
        providerCleanup: [{ provider: 'apple', status: 'DONE' }]
      }).success
    ).toBe(false)
    expect(
      ssoAccountDeletionSchema.safeParse({
        appStatus: 'DELETED',
        providerCleanup: [{ provider: 'apple', status: 'PENDING' }],
        userId: 'private'
      }).success
    ).toBe(false)
  })
  it('has no client identity, role, proof or token mutation fields', () => {
    expect(unlinkSsoAccountRequestSchema.parse({ provider: 'apple' })).toEqual({
      provider: 'apple'
    })
    expect(
      unlinkSsoAccountRequestSchema.safeParse({
        provider: 'apple',
        role: 'ADMIN'
      }).success
    ).toBe(false)
    expect(
      deleteSsoAccountRequestSchema.safeParse({ userId: 'other' }).success
    ).toBe(false)
  })
})
