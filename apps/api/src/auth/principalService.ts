import {
  authenticatedUserSchema,
  type AuthenticatedUser
} from '@nihongo/contracts/auth/get-current-principal'
import { z } from 'zod'
import type { PrismaClient } from '../generated/prisma/client.js'
import {
  createPhase7SessionCookie,
  readPhase7SessionToken
} from './phase7SessionCookie.js'

const ABSOLUTE_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000
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
    phase7Session?: Phase7AdminSessionProof
    user: AuthenticatedUser | null
  }>
  getAuthenticatedUser: (headers: Headers) => Promise<AuthenticatedUser | null>
}

export interface Phase7AdminSessionProof {
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

      if (!user || user.accountStatus !== 'ACTIVE') {
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
        user: authenticatedUserSchema.parse({
          id: user.id,
          name: user.name,
          role: user.role,
          targetLevel: user.targetLevel
        })
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

interface Phase7PrincipalRow {
  userId: string
  name: string
  role: 'USER' | 'ADMIN'
  targetLevel: 'N5' | 'N4' | 'N3' | 'N2' | 'N1' | null
  sessionId: string
  createdAt: Date
  expiresAt: Date
  isFresh: boolean
}

interface Phase7RememberedSessionRefreshRow {
  id: string
  updatedAt: Date
  expiresAt: Date
  refreshed: boolean
}

interface Phase7AdminAuthorityFailureRow {
  outcome: 'ADMIN_REQUIRED' | 'AUTH_SESSION_EXPIRED'
}

export const createPhase7PrincipalService = ({
  client,
  isProduction,
  refreshClient,
  secret
}: {
  client: Pick<PrismaClient, '$queryRawUnsafe'>
  isProduction: boolean
  refreshClient: Pick<PrismaClient, '$queryRawUnsafe'>
  secret: string
}): PrincipalService => {
  const resolveAuthenticatedUser: PrincipalService['resolveAuthenticatedUser'] =
    async (headers, options = {}) => {
      const credential = readPhase7SessionToken({
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
          : await refreshClient.$queryRawUnsafe<
              Phase7RememberedSessionRefreshRow[]
            >(
              'SELECT * FROM "phase7_refresh_current_remembered_session"($1)',
              credential.token
            )
      if (refreshRows.length > 1) {
        return {
          clearSessionCookie: true,
          headers: new Headers(),
          user: null
        }
      }

      const rows = await client.$queryRawUnsafe<Phase7PrincipalRow[]>(
        `SELECT principal.*,
           principal."createdAt" + INTERVAL '5 minutes' > clock_timestamp()
             AS "isFresh"
         FROM "phase7_resolve_v1_principal"($1) AS principal`,
        credential.token
      )
      if (rows.length !== 1) {
        let adminAuthorityFailure:
          | Phase7AdminAuthorityFailureRow['outcome']
          | undefined
        if (options.classifyAdminAuthorityLoss) {
          const authorityRows = await client.$queryRawUnsafe<
            Phase7AdminAuthorityFailureRow[]
          >(
            'SELECT * FROM "phase7_classify_admin_authority"($1)',
            credential.token
          )
          const outcome = authorityRows[0]?.outcome
          if (
            authorityRows.length !== 1 ||
            (outcome !== 'ADMIN_REQUIRED' && outcome !== 'AUTH_SESSION_EXPIRED')
          ) {
            throw new Error('Phase 7 ADMIN authority classification failed.')
          }
          adminAuthorityFailure = outcome
        }
        return {
          ...(adminAuthorityFailure === undefined
            ? {}
            : { adminAuthorityFailure }),
          clearSessionCookie: true,
          headers: new Headers(),
          user: null
        }
      }

      const row = rows[0]!
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
          createPhase7SessionCookie({
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
        phase7Session: {
          id: row.sessionId,
          token: credential.token,
          createdAt: row.createdAt,
          expiresAt: row.expiresAt,
          isFresh: row.isFresh
        },
        user: authenticatedUserSchema.parse({
          id: row.userId,
          name: row.name,
          role: row.role,
          targetLevel: row.targetLevel
        })
      }
    }

  return {
    resolveAuthenticatedUser,
    getAuthenticatedUser: async (headers) =>
      (await resolveAuthenticatedUser(headers)).user
  }
}
