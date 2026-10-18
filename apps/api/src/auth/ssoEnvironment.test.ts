import { describe, expect, it } from 'vitest'
import {
  EnvironmentValidationError,
  parseApiEnvironment
} from '../config/env.js'
import { createConfiguredSsoProviders } from './ssoPublicRuntime.js'
const input = {
  NODE_ENV: 'test',
  DATABASE_URL:
    'postgresql://nihongo_test_app_login:placeholder@localhost/unused_test?schema=public',
  AUTH_GATEWAY_DATABASE_URL:
    'postgresql://nihongo_test_auth_gateway_login:placeholder@localhost/unused_test?schema=public',
  BETTER_AUTH_SECRET: 'test-auth-placeholder-only-1234567890',
  GUEST_COOKIE_SECRET: 'test-guest-placeholder-only-1234567890',
  AUTH_EMAIL_FROM: 'test@example.test'
}
describe('Apple/Google runtime environment mapping', () => {
  it('keeps absent providers unavailable and maps both explicit pairs', () => {
    expect(createConfiguredSsoProviders(parseApiEnvironment(input))).toEqual({})
    const environment = parseApiEnvironment({
      ...input,
      BETTER_AUTH_URL: 'https://app.example.test',
      GOOGLE_CLIENT_ID: 'google-test',
      GOOGLE_CLIENT_SECRET: 'placeholder',
      APPLE_CLIENT_ID: 'apple-test',
      APPLE_CLIENT_SECRET: 'signed-jwt-placeholder'
    })
    expect(
      Object.keys(createConfiguredSsoProviders(environment)).sort()
    ).toEqual(['apple', 'google'])
  })
  it.each([
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'APPLE_CLIENT_ID',
    'APPLE_CLIENT_SECRET'
  ])('rejects incomplete pair %s without printing its value', (field) => {
    expect(() =>
      parseApiEnvironment({ ...input, [field]: 'placeholder' })
    ).toThrow(EnvironmentValidationError)
  })
  it.each([
    'http://localhost:3001',
    'https://127.0.0.1',
    'https://example.localhost'
  ])('rejects unsupported Apple callback origin %s', (origin) => {
    expect(() =>
      parseApiEnvironment({
        ...input,
        BETTER_AUTH_URL: origin,
        APPLE_CLIENT_ID: 'apple-test',
        APPLE_CLIENT_SECRET: 'placeholder'
      })
    ).toThrow(EnvironmentValidationError)
  })
})
