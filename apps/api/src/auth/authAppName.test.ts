import { describe, expect, it } from 'vitest'
import type { ApiEnvironment } from '../config/env.js'
import type { PrismaClient } from '../generated/prisma/client.js'
import { createAuthRuntime } from './createAuth.js'

const environment = {
  BETTER_AUTH_URL: 'http://127.0.0.1:3000',
  BETTER_AUTH_SECRET: 'synthetic-app-name-secret-0123456789abcdef',
  TRUSTED_ORIGINS: ['http://127.0.0.1:5173'],
  NODE_ENV: 'test'
} as unknown as ApiEnvironment

describe('auth app name', () => {
  it('uses the product name without changing the session cookie prefix', () => {
    const auth = createAuthRuntime({
      client: {} as PrismaClient,
      environment
    })
    expect(auth.options.appName).toBe('하루마루')
    expect(auth.options.advanced?.cookiePrefix).toBe('nihongo')
  })
})
