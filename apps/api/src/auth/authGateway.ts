import { z } from 'zod'
import type { ApiEnvironment } from '../config/env.js'
import type { PrismaClient } from '../generated/prisma/client.js'
import { createClientIpAuthority } from './clientIp.js'

const AUTH_BODY_TIMEOUT_MS = 5_000
const MAX_AUTH_BODY_BYTES = 32 * 1_024
const PASSWORD_RESET_RESPONSE_FLOOR_MS = 5_250
const ENUMERATION_PROTECTED_PATHS = new Set([
  '/api/auth/request-password-reset',
  '/api/auth/send-verification-email',
  '/api/auth/sign-up/email'
])

const ALLOWED_AUTH_OPERATIONS = new Map<string, ReadonlySet<string>>([
  [
    'POST',
    new Set([
      '/api/auth/change-password',
      '/api/auth/request-password-reset',
      '/api/auth/reset-password',
      '/api/auth/send-verification-email',
      '/api/auth/sign-in/email',
      '/api/auth/sign-out',
      '/api/auth/sign-up/email',
      '/api/auth/verify-email'
    ])
  ]
])

const CREDENTIAL_KEY_PATTERN =
  /^(?:accessToken|authorization|cookie|idToken|password|refreshToken|sessionToken|token)$/iu
const COOKIE_ONLY_SUCCESS_PATHS = new Set([
  '/api/auth/change-password',
  '/api/auth/request-password-reset',
  '/api/auth/reset-password',
  '/api/auth/send-verification-email',
  '/api/auth/sign-in/email',
  '/api/auth/sign-out',
  '/api/auth/sign-up/email',
  '/api/auth/verify-email'
])
const JSON_CONTENT_TYPE_PATTERN = /^application\/json(?:\s*;|$)/iu
const internalSessionSchema = z
  .object({
    session: z.object({ id: z.uuid() }).passthrough(),
    user: z.object({ id: z.uuid() }).passthrough()
  })
  .passthrough()

interface AuthGatewayRuntime {
  api: {
    getSession: (input: { headers: Headers }) => Promise<unknown>
  }
  handler: (request: Request) => Promise<Response>
}

interface CreateAuthGatewayDependencies {
  auth: AuthGatewayRuntime
  client: PrismaClient
  environment: ApiEnvironment
  delay?: (milliseconds: number) => Promise<void>
  now?: () => number
}

const sleep = async (milliseconds: number): Promise<void> =>
  await new Promise((resolve) => setTimeout(resolve, milliseconds))

const isAllowedOperation = (method: string, pathname: string): boolean =>
  ALLOWED_AUTH_OPERATIONS.get(method)?.has(pathname) ?? false

const stripCredentials = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(stripCredentials)
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  const sanitized: Record<string, unknown> = {}

  for (const [key, nestedValue] of Object.entries(value)) {
    if (!CREDENTIAL_KEY_PATTERN.test(key)) {
      sanitized[key] = stripCredentials(nestedValue)
    }
  }

  return sanitized
}

export const sanitizeAuthResponse = async (
  response: Response
): Promise<Response> => {
  if (
    !response.ok ||
    !response.headers.get('Content-Type')?.includes('application/json')
  ) {
    return response
  }

  const payload: unknown = await response.json()
  const headers = new Headers(response.headers)
  headers.delete('Content-Length')

  return new Response(JSON.stringify(stripCredentials(payload)), {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}

const toCookieOnlySuccess = (response: Response): Response => {
  const headers = new Headers(response.headers)
  headers.set('Content-Type', 'application/json')
  headers.delete('Content-Length')

  return new Response(JSON.stringify({ success: true }), {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}

const assertTrustedWriteRequest = (
  request: Request,
  trustedOrigins: readonly string[]
): void => {
  const contentType = request.headers.get('Content-Type') ?? ''
  if (!JSON_CONTENT_TYPE_PATTERN.test(contentType)) {
    throw new AuthGatewayError(415, 'INVALID_CONTENT_TYPE')
  }

  const origin = request.headers.get('Origin')
  const fetchSite = request.headers.get('Sec-Fetch-Site')
  const hasTrustedOrigin = origin !== null && trustedOrigins.includes(origin)
  const hasSameOriginMetadata = origin === null && fetchSite === 'same-origin'

  if (!hasTrustedOrigin && !hasSameOriginMetadata) {
    throw new AuthGatewayError(403, 'UNTRUSTED_ORIGIN')
  }
}

const readLimitedJsonBody = async (
  request: Request
): Promise<Record<string, unknown>> => {
  const declaredLength = Number(request.headers.get('Content-Length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_AUTH_BODY_BYTES) {
    await request.body?.cancel().catch(() => undefined)
    throw new AuthGatewayError(413, 'REQUEST_TOO_LARGE')
  }

  const reader = request.body?.getReader()
  if (!reader) {
    throw new AuthGatewayError(400, 'INVALID_JSON')
  }

  const chunks: Uint8Array[] = []
  let totalBytes = 0
  let timeout: NodeJS.Timeout | undefined

  const readBody = async (): Promise<Uint8Array> => {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) {
        break
      }

      totalBytes += chunk.value.byteLength
      if (totalBytes > MAX_AUTH_BODY_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new AuthGatewayError(413, 'REQUEST_TOO_LARGE')
      }
      chunks.push(chunk.value)
    }

    const body = new Uint8Array(totalBytes)
    let offset = 0
    for (const chunk of chunks) {
      body.set(chunk, offset)
      offset += chunk.byteLength
    }
    return body
  }

  try {
    const bytes = await Promise.race([
      readBody(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          void reader.cancel().catch(() => undefined)
          reject(new AuthGatewayError(408, 'REQUEST_TIMEOUT'))
        }, AUTH_BODY_TIMEOUT_MS)
      })
    ])
    const payload: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    )
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new AuthGatewayError(400, 'INVALID_JSON')
    }
    return payload as Record<string, unknown>
  } catch (error: unknown) {
    if (error instanceof AuthGatewayError) {
      throw error
    }
    throw new AuthGatewayError(400, 'INVALID_JSON')
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
    reader.releaseLock()
  }
}

const withGatewayRequestPolicy = async (
  request: Request,
  pathname: string,
  environment: ApiEnvironment
): Promise<Request> => {
  const payload = await readLimitedJsonBody(request)
  const nextPayload: Record<string, unknown> = { ...payload }
  const spaOrigin =
    environment.TRUSTED_ORIGINS[0] ?? environment.BETTER_AUTH_URL

  if (
    pathname === '/api/auth/sign-up/email' ||
    pathname === '/api/auth/send-verification-email'
  ) {
    nextPayload.callbackURL = new URL('/login?verified=1', spaOrigin).href
  }

  if (pathname === '/api/auth/sign-up/email') {
    const name = z.string().trim().min(1).max(80).safeParse(nextPayload.name)
    if (!name.success) {
      throw new AuthGatewayError(400, 'INVALID_AUTH_PAYLOAD')
    }
    nextPayload.name = name.data
  }

  if (pathname === '/api/auth/verify-email') {
    const token = z.string().min(1).max(4_096).safeParse(nextPayload.token)
    if (!token.success) {
      throw new AuthGatewayError(400, 'INVALID_AUTH_PAYLOAD')
    }
    const verificationUrl = new URL(
      '/api/auth/verify-email',
      environment.BETTER_AUTH_URL
    )
    verificationUrl.searchParams.set('token', token.data)
    return new Request(verificationUrl, {
      headers: request.headers,
      method: 'GET'
    })
  }

  if (pathname === '/api/auth/request-password-reset') {
    delete nextPayload.redirectTo
  }

  if (pathname === '/api/auth/change-password') {
    nextPayload.revokeOtherSessions = true
  }

  return new Request(request.url, {
    headers: request.headers,
    method: request.method,
    body: JSON.stringify(nextPayload)
  })
}

const appendExpiredSessionCookies = (
  response: Response,
  isProduction: boolean
): Response => {
  const headers = new Headers(response.headers)
  const attributes = `Path=/; HttpOnly; SameSite=Lax; Max-Age=0${
    isProduction ? '; Secure' : ''
  }`
  headers.append('Set-Cookie', `nihongo.session_token=; ${attributes}`)
  headers.append('Set-Cookie', `__Secure-nihongo.session_token=; ${attributes}`)

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}

const appendDevelopmentCors = (
  response: Response,
  request: Request,
  environment: ApiEnvironment
): Response => {
  const origin = request.headers.get('Origin')
  if (
    environment.NODE_ENV === 'production' ||
    !origin ||
    !environment.TRUSTED_ORIGINS.includes(origin)
  ) {
    return response
  }

  const headers = new Headers(response.headers)
  headers.set('Access-Control-Allow-Credentials', 'true')
  headers.set('Access-Control-Allow-Origin', origin)
  headers.set('Access-Control-Expose-Headers', 'Retry-After, X-Request-Id')
  headers.append('Vary', 'Origin')

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}

const appendRateLimitRetryAfter = (response: Response): Response => {
  if (response.status !== 429 || response.headers.has('Retry-After')) {
    return response
  }

  const headers = new Headers(response.headers)
  headers.set('Retry-After', '60')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}

export class AuthGatewayError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 408 | 413 | 415,
    readonly code:
      | 'INVALID_AUTH_PAYLOAD'
      | 'INVALID_CONTENT_TYPE'
      | 'INVALID_JSON'
      | 'REQUEST_TIMEOUT'
      | 'REQUEST_TOO_LARGE'
      | 'UNTRUSTED_ORIGIN'
      | 'AUTH_ROUTE_NOT_FOUND'
  ) {
    super(code)
    this.name = 'AuthGatewayError'
  }
}

export interface AuthGateway {
  handle: (request: Request, peerAddress?: string) => Promise<Response>
}

export const createAuthGateway = ({
  auth,
  client,
  environment,
  delay = sleep,
  now = Date.now
}: CreateAuthGatewayDependencies): AuthGateway => {
  const clientIpAuthority = createClientIpAuthority(
    environment.AUTH_TRUSTED_PROXY_CIDRS
  )

  return {
    handle: async (incomingRequest, peerAddress) => {
      const request = clientIpAuthority.apply(incomingRequest, peerAddress)
      const pathname = new URL(request.url).pathname
      const startedAt = now()

      if (request.method === 'OPTIONS') {
        const origin = request.headers.get('Origin')
        const requestedMethod = request.headers.get(
          'Access-Control-Request-Method'
        )

        if (
          environment.NODE_ENV === 'production' ||
          !origin ||
          !environment.TRUSTED_ORIGINS.includes(origin) ||
          !requestedMethod ||
          !isAllowedOperation(requestedMethod, pathname)
        ) {
          throw new AuthGatewayError(404, 'AUTH_ROUTE_NOT_FOUND')
        }

        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Credentials': 'true',
            'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key',
            'Access-Control-Allow-Methods': requestedMethod,
            'Access-Control-Allow-Origin': origin,
            Vary: 'Origin'
          }
        })
      }

      if (!isAllowedOperation(request.method, pathname)) {
        throw new AuthGatewayError(404, 'AUTH_ROUTE_NOT_FOUND')
      }

      let forwardedRequest = request
      let sessionBeforePasswordChange: unknown

      if (request.method === 'POST') {
        assertTrustedWriteRequest(request, environment.TRUSTED_ORIGINS)
        forwardedRequest = await withGatewayRequestPolicy(
          request,
          pathname,
          environment
        )
      }

      if (pathname === '/api/auth/change-password') {
        sessionBeforePasswordChange = await auth.api.getSession({
          headers: request.headers
        })
      }

      let response = await auth.handler(forwardedRequest)

      if (pathname === '/api/auth/change-password' && response.ok) {
        const session = internalSessionSchema.safeParse(
          sessionBeforePasswordChange
        )
        if (session.success) {
          await client.session.deleteMany({
            where: { userId: session.data.user.id }
          })
        }
        response = appendExpiredSessionCookies(
          response,
          environment.NODE_ENV === 'production'
        )
      }

      response =
        response.ok && COOKIE_ONLY_SUCCESS_PATHS.has(pathname)
          ? toCookieOnlySuccess(response)
          : await sanitizeAuthResponse(response)
      response = appendRateLimitRetryAfter(response)
      if (
        ENUMERATION_PROTECTED_PATHS.has(pathname) &&
        environment.NODE_ENV === 'production'
      ) {
        const remaining = PASSWORD_RESET_RESPONSE_FLOOR_MS - (now() - startedAt)
        if (remaining > 0) {
          await delay(remaining)
        }
      }
      return appendDevelopmentCors(response, request, environment)
    }
  }
}
