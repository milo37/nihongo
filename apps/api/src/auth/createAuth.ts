import { prismaAdapter } from '@better-auth/prisma-adapter'
import { betterAuth } from 'better-auth'
import type { ApiEnvironment } from '../config/env.js'
import type { PrismaClient } from '../generated/prisma/client.js'
import { INTERNAL_CLIENT_IP_HEADER } from './clientIp.js'
import type { AuthEmailDispatcher } from './emailDispatcher.js'

const ONE_DAY_SECONDS = 60 * 60 * 24
const ONE_WEEK_SECONDS = ONE_DAY_SECONDS * 7

interface CreateAuthRuntimeDependencies {
  client: PrismaClient
  emailDispatcher?: AuthEmailDispatcher
  environment: ApiEnvironment
}

export const createAuthRuntime = ({
  client,
  environment
}: CreateAuthRuntimeDependencies) =>
  betterAuth({
    appName: 'JLPT Drill Note',
    basePath: '/api/auth',
    baseURL: environment.BETTER_AUTH_URL,
    secret: environment.BETTER_AUTH_SECRET,
    trustedOrigins: environment.TRUSTED_ORIGINS,
    database: prismaAdapter(client, {
      provider: 'postgresql',
      transaction: true
    }),
    emailAndPassword: { enabled: false },
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
      cookieCache: { enabled: false }
    },
    account: {
      accountLinking: { enabled: false }
    },
    verification: {
      storeIdentifier: 'hashed'
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-up/email': { window: 60, max: 5 },
        '/request-password-reset': { window: 60, max: 3 },
        '/send-verification-email': { window: 60, max: 3 }
      }
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => ({
            data: {
              ...user,
              role: 'USER',
              accountStatus: 'ACTIVE',
              deletedAt: null
            }
          })
        }
      },
      session: {
        create: {
          before: async (session) => {
            const user = await client.user.findUnique({
              where: { id: session.userId },
              select: { accountStatus: true }
            })

            return user?.accountStatus === 'ACTIVE'
          }
        }
      }
    },
    advanced: {
      database: { generateId: 'uuid' },
      ipAddress: {
        ipAddressHeaders: [INTERNAL_CLIENT_IP_HEADER]
      },
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

export type AuthRuntime = ReturnType<typeof createAuthRuntime>
