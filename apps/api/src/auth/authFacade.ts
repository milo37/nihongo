import { z } from 'zod'
import type { ApiEnvironment } from '../config/env.js'
import type { PrismaClient } from '../generated/prisma/client.js'
import type { AuthEmailDispatcher } from './emailDispatcher.js'
import {
  createExpiredSessionCookies,
  readSessionToken
} from './sessionCookie.js'

const emptySchema = z.object({}).strict()

export interface OwnedAuthFacade {
  handle: (
    request: Request,
    pathname: string,
    payload: Record<string, unknown>
  ) => Promise<Response>
}

export type AuthFacade = OwnedAuthFacade

const response = (status: number, payload: Record<string, unknown>): Response =>
  Response.json(payload, { status })

const success = (cookies: readonly string[] = []): Response => {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  for (const cookie of cookies) headers.append('Set-Cookie', cookie)
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers
  })
}

const invalidPayload = (): Response =>
  response(400, {
    code: 'INVALID_AUTH_PAYLOAD',
    message: 'Invalid auth payload.'
  })

const unavailable = (): Response =>
  response(503, {
    code: 'AUTH_SERVICE_UNAVAILABLE',
    message: 'Authentication service is unavailable.'
  })

// Only sign-out reaches this facade: the gateway answers 404 for the retired
// email/password routes (isAllowedOperation in authGateway.ts).
export const createPhase7AuthFacade = ({
  client,
  environment
}: {
  client: Pick<PrismaClient, '$queryRawUnsafe'>
  emailDispatcher: AuthEmailDispatcher
  environment: ApiEnvironment
}): AuthFacade => {
  const isProduction = environment.NODE_ENV === 'production'

  const handlers: Record<
    string,
    (request: Request, payload: Record<string, unknown>) => Promise<Response>
  > = {
    '/api/auth/sign-out': async (_request, payload) => {
      if (!emptySchema.safeParse(payload).success) return invalidPayload()
      const credential = readSessionToken({
        cookieHeader: _request.headers.get('Cookie'),
        isProduction,
        secret: environment.BETTER_AUTH_SECRET
      })
      if (credential.token) {
        const rows = await client.$queryRawUnsafe<
          Array<{ signedOut: boolean }>
        >('SELECT "phase7_owned_sign_out"($1) AS "signedOut"', credential.token)
        if (rows.length !== 1 || rows[0]?.signedOut !== true)
          return unavailable()
      }
      return success(createExpiredSessionCookies(isProduction))
    }
  }

  return {
    handle: async (request, pathname, payload) => {
      const handler = handlers[pathname]
      if (!handler) return response(404, { code: 'AUTH_ROUTE_NOT_FOUND' })
      try {
        return await handler(request, payload)
      } catch {
        return unavailable()
      }
    }
  }
}

export { createPhase7AuthFacade as createOwnedAuthFacade }
