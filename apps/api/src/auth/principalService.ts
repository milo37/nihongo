import {
  authenticatedUserSchema,
  type AuthenticatedUser
} from '@nihongo/contracts/auth/get-current-principal'
import { z } from 'zod'
import type { PrismaClient } from '../generated/prisma/client.js'

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
  resolveAuthenticatedUser: (headers: Headers) => Promise<{
    clearSessionCookie: boolean
    headers: Headers
    user: AuthenticatedUser | null
  }>
  getAuthenticatedUser: (headers: Headers) => Promise<AuthenticatedUser | null>
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
