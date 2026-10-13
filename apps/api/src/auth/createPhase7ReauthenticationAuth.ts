import { betterAuth } from 'better-auth/minimal'
import type { ApiEnvironment } from '../config/env.js'
import type { PrismaClient } from '../generated/prisma/client.js'
import { INTERNAL_CLIENT_IP_HEADER } from './clientIp.js'
import { createPhase7ReauthenticationAdapter } from './phase7ReauthenticationAdapter.js'
import type { Phase7ReauthenticationContext } from './phase7ReauthenticationContext.js'

const ONE_DAY_SECONDS = 24 * 60 * 60
const ONE_WEEK_SECONDS = 7 * ONE_DAY_SECONDS

export interface Phase7ReauthenticationAuthApi {
  readonly signInEmail: (input: {
    readonly headers: Headers
    readonly body: {
      readonly email: string
      readonly password: string
      readonly rememberMe: false
    }
    readonly returnHeaders: true
  }) => Promise<{
    readonly headers: Headers
    readonly response: {
      readonly redirect: boolean
      readonly token: string
      readonly url?: string | undefined
      readonly user: { readonly id: string; readonly email: string }
    }
  }>
  readonly verifyPassword: (input: {
    readonly headers: Headers
    readonly body: { readonly password: string }
  }) => Promise<{ readonly status: boolean }>
}

export const createPhase7ReauthenticationAuthApi = ({
  client,
  context,
  environment
}: {
  client: Pick<PrismaClient, '$queryRawUnsafe'>
  context: Phase7ReauthenticationContext
  environment: ApiEnvironment
}): Phase7ReauthenticationAuthApi => {
  const auth = betterAuth({
    appName: 'JLPT Drill Note',
    basePath: '/internal/phase7/reauthentication',
    baseURL: environment.BETTER_AUTH_URL,
    secret: environment.BETTER_AUTH_SECRET,
    trustedOrigins: environment.TRUSTED_ORIGINS,
    database: createPhase7ReauthenticationAdapter({
      client,
      getIntentId: context.getIntentId
    }),
    experimental: { joins: true },
    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
      requireEmailVerification: true,
      minPasswordLength: 12,
      maxPasswordLength: 128
    },
    user: {
      additionalFields: {
        role: {
          type: ['USER', 'ADMIN'],
          input: false,
          required: true,
          defaultValue: 'USER'
        },
        targetLevel: {
          type: ['N5', 'N4', 'N3', 'N2', 'N1'],
          input: true,
          required: false
        },
        accountStatus: {
          type: ['ACTIVE', 'DELETION_PENDING', 'DELETED'],
          input: false,
          required: true,
          returned: false,
          defaultValue: 'ACTIVE'
        },
        deletedAt: {
          type: 'date',
          input: false,
          required: false,
          returned: false
        }
      }
    },
    session: {
      expiresIn: ONE_WEEK_SECONDS,
      updateAge: ONE_DAY_SECONDS,
      freshAge: 5 * 60,
      disableSessionRefresh: true,
      cookieCache: { enabled: false }
    },
    account: { accountLinking: { enabled: false } },
    rateLimit: { enabled: false },
    advanced: {
      database: { generateId: 'uuid' },
      ipAddress: { ipAddressHeaders: [INTERNAL_CLIENT_IP_HEADER] },
      trustedProxyHeaders: false,
      cookiePrefix: 'nihongo',
      useSecureCookies: environment.NODE_ENV === 'production',
      disableCSRFCheck: false,
      disableOriginCheck: false,
      defaultCookieAttributes: {
        httpOnly: true,
        secure: environment.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/'
      }
    },
    logger: { disabled: true }
  })

  return {
    verifyPassword: async (input) => await auth.api.verifyPassword(input),
    signInEmail: async (input) => await auth.api.signInEmail(input)
  }
}
