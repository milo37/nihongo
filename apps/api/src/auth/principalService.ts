import { adminSessionFreshSql } from './adminFreshAuthority.js'
import { ADMIN_FRESH_WINDOW_MS } from './adminFreshWindow.js'
import {
  authenticatedUserSchema,
  type AuthenticatedUser
} from '@nihongo/contracts/auth/get-current-principal'
import { z } from 'zod'
import type { PrismaClient } from '../generated/prisma/client.js'
import { createSessionCookie, readSessionToken } from './sessionCookie.js'
import {
  refreshRememberedSession,
  v1PrincipalQuery,
  type OwnedSessionClient
} from './ownedSessionAuthority.js'

const ABSOLUTE_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000
export const ADMIN_SESSION_ABSOLUTE_TTL_MS = 8 * 60 * 60 * 1_000

const getAdminSessionExpiresAt = (sessionCreatedAt: Date): Date =>
  new Date(sessionCreatedAt.getTime() + ADMIN_SESSION_ABSOLUTE_TTL_MS)

// An ADMIN session ends 8 hours after sign-in regardless of activity.
const isAdminSessionOverLimit = (
  role: 'USER' | 'ADMIN',
  sessionCreatedAt: Date,
  now: Date
): boolean =>
  role === 'ADMIN' &&
  now.getTime() >= getAdminSessionExpiresAt(sessionCreatedAt).getTime()

// Freshness also requires the session itself to be inside the window, so the
// window always ends at session creation + ADMIN_FRESH_WINDOW_MS.

const toAuthenticatedUser = (
  user: {
    id: string
    name: string
    role: 'USER' | 'ADMIN'
    targetLevel: AuthenticatedUser['targetLevel']
  },
  sessionCreatedAt: Date,
  isFresh = false
): AuthenticatedUser =>
  authenticatedUserSchema.parse({
    id: user.id,
    name: user.name,
    role: user.role,
    targetLevel: user.targetLevel,
    ...(user.role === 'ADMIN'
      ? {
          adminSessionExpiresAt:
            getAdminSessionExpiresAt(sessionCreatedAt).toISOString(),
          adminFreshUntil: isFresh
            ? new Date(
                sessionCreatedAt.getTime() + ADMIN_FRESH_WINDOW_MS
              ).toISOString()
            : null
        }
      : {})
  })
const authSessionSchema = z
  .object({
    session: z.object({
      id: z.uuid(),
      createdAt: z.coerce.date()
    }),
    user: z.object({ id: z.uuid() })
  })
  .passthrough()

interface AuthSessionReader {
  getSession: (input: {
    headers: Headers
    returnHeaders: true
  }) => Promise<{ headers: Headers; response: unknown }>
}

interface CreatePrincipalServiceDependencies {
  authApi: AuthSessionReader
  client: PrismaClient
  now?: () => Date
}

export interface PrincipalService {
  resolveAuthenticatedUser: (
    headers: Headers,
    options?: {
      classifyAdminAuthorityLoss?: boolean
      refreshRememberedSession?: boolean
    }
  ) => Promise<{
    adminAuthorityFailure?: 'ADMIN_REQUIRED' | 'AUTH_SESSION_EXPIRED'
    clearSessionCookie: boolean
    headers: Headers
    ownedSessionProof?: AdminSessionProof
    user: AuthenticatedUser | null
  }>
  getAuthenticatedUser: (headers: Headers) => Promise<AuthenticatedUser | null>
}

interface AdminSessionProof {
  readonly id: string
  readonly token: string
  readonly createdAt: Date
  readonly expiresAt: Date
  readonly isFresh: boolean
}

export const createPrincipalService = ({
  authApi,
  client,
  now = () => new Date()
}: CreatePrincipalServiceDependencies): PrincipalService => {
  const resolveAuthenticatedUser: PrincipalService['resolveAuthenticatedUser'] =
    async (headers) => {
      const sessionResult = await authApi.getSession({
        headers,
        returnHeaders: true
      })
      const parsedSession = authSessionSchema.safeParse(sessionResult.response)

      if (!parsedSession.success) {
        return {
          clearSessionCookie: false,
          headers: sessionResult.headers,
          user: null
        }
      }

      if (
        now().getTime() - parsedSession.data.session.createdAt.getTime() >
        ABSOLUTE_SESSION_TTL_MS
      ) {
        await client.session.deleteMany({
          where: { id: parsedSession.data.session.id }
        })
        return {
          clearSessionCookie: true,
          headers: sessionResult.headers,
          user: null
        }
      }

      const user = await client.user.findUnique({
        where: { id: parsedSession.data.user.id },
        select: {
          id: true,
          name: true,
          role: true,
          targetLevel: true,
          accountStatus: true
        }
      })

      if (
        !user ||
        user.accountStatus !== 'ACTIVE' ||
        isAdminSessionOverLimit(
          user.role,
          parsedSession.data.session.createdAt,
          now()
        )
      ) {
        await client.session.deleteMany({
          where: { id: parsedSession.data.session.id }
        })
        return {
          clearSessionCookie: true,
          headers: sessionResult.headers,
          user: null
        }
      }

      return {
        clearSessionCookie: false,
        headers: sessionResult.headers,
        user: toAuthenticatedUser(user, parsedSession.data.session.createdAt)
      }
    }

  return {
    resolveAuthenticatedUser,
    getAuthenticatedUser: async (headers) => {
      const resolution = await resolveAuthenticatedUser(headers)
      return resolution.user
    }
  }
}

interface PrincipalDatabaseRow {
  userId: string
  name: string
  role: 'USER' | 'ADMIN'
  targetLevel: 'N5' | 'N4' | 'N3' | 'N2' | 'N1' | null
  sessionId: string
  createdAt: Date
  expiresAt: Date
  isFresh: boolean
}

interface AdminAuthorityFailureRow {
  outcome: 'ADMIN_REQUIRED' | 'AUTH_SESSION_EXPIRED'
}

export const createOwnedPrincipalService = ({
  client,
  isProduction,
  now = () => new Date(),
  refreshClient,
  secret
}: {
  client: Pick<PrismaClient, '$queryRawUnsafe'>
  isProduction: boolean
  now?: () => Date
  refreshClient: OwnedSessionClient
  secret: string
}): PrincipalService => {
  const resolveAuthenticatedUser: PrincipalService['resolveAuthenticatedUser'] =
    async (headers, options = {}) => {
      const credential = readSessionToken({
        cookieHeader: headers.get('Cookie'),
        isProduction,
        secret
      })
      if (!credential.token) {
        return {
          clearSessionCookie: credential.present,
          headers: new Headers(),
          user: null
        }
      }

      const refreshRows =
        options.refreshRememberedSession === false
          ? []
          : await refreshRememberedSession(refreshClient, credential.token)
      if (refreshRows.length > 1) {
        return {
          clearSessionCookie: true,
          headers: new Headers(),
          user: null
        }
      }

      const rows = await client.$queryRawUnsafe<PrincipalDatabaseRow[]>(
        `SELECT principal.*,
           ${adminSessionFreshSql('$1')} AS "isFresh"
         FROM (${v1PrincipalQuery('$1')}) AS principal`,
        credential.token
      )
      if (rows.length !== 1) {
        let adminAuthorityFailure:
          | AdminAuthorityFailureRow['outcome']
          | undefined
        if (options.classifyAdminAuthorityLoss) {
          const authorityRows = await client.$queryRawUnsafe<
            AdminAuthorityFailureRow[]
          >('SELECT * FROM "classify_admin_authority"($1)', credential.token)
          const outcome = authorityRows[0]?.outcome
          if (
            authorityRows.length !== 1 ||
            (outcome !== 'ADMIN_REQUIRED' && outcome !== 'AUTH_SESSION_EXPIRED')
          ) {
            throw new Error('ADMIN authority classification failed.')
          }
          adminAuthorityFailure = outcome
        }
        // An unresolved token may be one that a re-authentication just rotated.
        // Clearing the cookie here would erase the replacement session cookie.
        return {
          ...(adminAuthorityFailure === undefined
            ? {}
            : { adminAuthorityFailure }),
          clearSessionCookie: false,
          headers: new Headers(),
          user: null
        }
      }

      const row = rows[0]!
      if (isAdminSessionOverLimit(row.role, row.createdAt, now())) {
        return {
          ...(options.classifyAdminAuthorityLoss
            ? { adminAuthorityFailure: 'AUTH_SESSION_EXPIRED' as const }
            : {}),
          clearSessionCookie: true,
          headers: new Headers(),
          user: null
        }
      }
      const refresh = refreshRows[0]
      if (refresh && refresh.id !== row.sessionId) {
        return {
          clearSessionCookie: true,
          headers: new Headers(),
          user: null
        }
      }
      const responseHeaders = new Headers()
      if (refresh?.refreshed) {
        responseHeaders.append(
          'Set-Cookie',
          createSessionCookie({
            expiresAt: refresh.expiresAt,
            isProduction,
            rememberMe: true,
            now: refresh.updatedAt,
            secret,
            token: credential.token
          })
        )
      }
      return {
        clearSessionCookie: false,
        headers: responseHeaders,
        ownedSessionProof: {
          id: row.sessionId,
          token: credential.token,
          createdAt: row.createdAt,
          expiresAt: row.expiresAt,
          isFresh: row.isFresh
        },
        user: toAuthenticatedUser(
          {
            id: row.userId,
            name: row.name,
            role: row.role,
            targetLevel: row.targetLevel
          },
          row.createdAt,
          row.isFresh
        )
      }
    }

  return {
    resolveAuthenticatedUser,
    getAuthenticatedUser: async (headers) =>
      (await resolveAuthenticatedUser(headers)).user
  }
}
