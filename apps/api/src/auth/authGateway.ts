import { z } from 'zod'
import type { ApiEnvironment } from '../config/env.js'
import type { PrismaClient } from '../generated/prisma/client.js'
import { createClientIpAuthority } from './clientIp.js'
import type { Phase7AuthFacade } from './phase7AuthFacade.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import { getRawRequestPathname } from '../app/phase7PrefixExclusion.js'

const AUTH_BODY_TIMEOUT_MS = 5_000
const MAX_LEGACY_AUTH_BODY_BYTES = 32 * 1_024
const MAX_TECHNICAL_AUTH_BODY_BYTES = 4 * 1_024
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
const JSON_CONTENT_TYPE_PATTERN =
  /^application\/json(?:[\t ]*;[\t ]*charset[\t ]*=[\t ]*(?:utf-8|"utf-8"))?[\t ]*$/iu
const CONTENT_LENGTH_PATTERN = /^(?:0|[1-9][0-9]*)$/u
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
  auth?: AuthGatewayRuntime
  client?: PrismaClient
  environment: ApiEnvironment
  phase7Facade?: Phase7AuthFacade
  technicalRateLimiter?: ApplicationRateLimiter
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

  const contentEncoding = request.headers.get('Content-Encoding')
  if (
    contentEncoding !== null &&
    contentEncoding.toLowerCase() !== 'identity'
  ) {
    throw new AuthGatewayError(400, 'INVALID_REQUEST')
  }

  const origin = request.headers.get('Origin')
  const fetchSite = request.headers.get('Sec-Fetch-Site')
  const hasTrustedOrigin = origin !== null && trustedOrigins.includes(origin)
  const hasTrustedOriginMetadata =
    fetchSite === null ||
    fetchSite === 'same-origin' ||
    fetchSite === 'same-site'
  const hasSameOriginMetadata = origin === null && fetchSite === 'same-origin'

  if (
    !(hasTrustedOrigin && hasTrustedOriginMetadata) &&
    !hasSameOriginMetadata
  ) {
    throw new AuthGatewayError(403, 'UNTRUSTED_ORIGIN')
  }
}

class JsonMemberScanner {
  readonly #source: string
  #index = 0

  constructor(source: string) {
    this.#source = source
  }

  scan(): void {
    this.#skipWhitespace()
    this.#scanValue(0)
    this.#skipWhitespace()
    if (this.#index !== this.#source.length) {
      throw new SyntaxError('Invalid JSON.')
    }
  }

  #skipWhitespace(): void {
    while (/^[\t\n\r ]$/u.test(this.#source[this.#index] ?? '')) {
      this.#index += 1
    }
  }

  #scanValue(depth: number): void {
    if (depth > 100) {
      throw new SyntaxError('JSON nesting is too deep.')
    }

    const character = this.#source[this.#index]
    if (character === '{') {
      this.#scanObject(depth + 1)
      return
    }
    if (character === '[') {
      this.#scanArray(depth + 1)
      return
    }
    if (character === '"') {
      this.#scanString()
      return
    }
    if (character === 't' || character === 'f' || character === 'n') {
      this.#scanKeyword(
        character === 't' ? 'true' : character === 'f' ? 'false' : 'null'
      )
      return
    }
    if (character === '-' || /^[0-9]$/u.test(character ?? '')) {
      this.#scanNumber()
      return
    }

    throw new SyntaxError('Invalid JSON value.')
  }

  #scanKeyword(keyword: string): void {
    if (
      this.#source.slice(this.#index, this.#index + keyword.length) !== keyword
    ) {
      throw new SyntaxError('Invalid JSON keyword.')
    }
    this.#index += keyword.length
  }

  #scanNumber(): void {
    const token = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(
      this.#source.slice(this.#index)
    )?.[0]
    if (!token) {
      throw new SyntaxError('Invalid JSON number.')
    }
    this.#index += token.length
  }

  #scanString(): string {
    const start = this.#index
    this.#index += 1

    while (this.#index < this.#source.length) {
      const character = this.#source[this.#index]
      if (character === '"') {
        this.#index += 1
        return JSON.parse(this.#source.slice(start, this.#index)) as string
      }
      if (character === '\\') {
        const escape = this.#source[this.#index + 1]
        if (escape === 'u') {
          if (
            !/^[0-9a-f]{4}$/iu.test(
              this.#source.slice(this.#index + 2, this.#index + 6)
            )
          ) {
            throw new SyntaxError('Invalid JSON Unicode escape.')
          }
          this.#index += 6
          continue
        }
        if (!'"\\/bfnrt'.includes(escape ?? '')) {
          throw new SyntaxError('Invalid JSON escape.')
        }
        this.#index += 2
        continue
      }
      if (character === undefined || character.charCodeAt(0) < 0x20) {
        throw new SyntaxError('Invalid JSON string.')
      }
      this.#index += 1
    }

    throw new SyntaxError('Unterminated JSON string.')
  }

  #scanArray(depth: number): void {
    this.#index += 1
    this.#skipWhitespace()
    if (this.#source[this.#index] === ']') {
      this.#index += 1
      return
    }

    while (true) {
      this.#scanValue(depth)
      this.#skipWhitespace()
      const character = this.#source[this.#index]
      this.#index += 1
      if (character === ']') {
        return
      }
      if (character !== ',') {
        throw new SyntaxError('Invalid JSON array.')
      }
      this.#skipWhitespace()
    }
  }

  #scanObject(depth: number): void {
    this.#index += 1
    this.#skipWhitespace()
    const keys = new Set<string>()
    if (this.#source[this.#index] === '}') {
      this.#index += 1
      return
    }

    while (true) {
      if (this.#source[this.#index] !== '"') {
        throw new SyntaxError('Invalid JSON object key.')
      }
      const key = this.#scanString()
      if (keys.has(key)) {
        throw new SyntaxError('Duplicate JSON object member.')
      }
      keys.add(key)
      this.#skipWhitespace()
      if (this.#source[this.#index] !== ':') {
        throw new SyntaxError('Invalid JSON object.')
      }
      this.#index += 1
      this.#skipWhitespace()
      this.#scanValue(depth)
      this.#skipWhitespace()
      const character = this.#source[this.#index]
      this.#index += 1
      if (character === '}') {
        return
      }
      if (character !== ',') {
        throw new SyntaxError('Invalid JSON object.')
      }
      this.#skipWhitespace()
    }
  }
}

const parseDeclaredContentLength = (request: Request): number | null => {
  const header = request.headers.get('Content-Length')
  if (header === null) {
    return null
  }
  if (!CONTENT_LENGTH_PATTERN.test(header)) {
    throw new AuthGatewayError(400, 'INVALID_REQUEST')
  }
  const value = Number(header)
  if (!Number.isSafeInteger(value)) {
    throw new AuthGatewayError(400, 'INVALID_REQUEST')
  }
  return value
}

const readLimitedJsonBody = async (
  request: Request,
  maximumBytes: number
): Promise<Record<string, unknown>> => {
  let declaredLength: number | null
  try {
    declaredLength = parseDeclaredContentLength(request)
  } catch (error: unknown) {
    await request.body?.cancel().catch(() => undefined)
    throw error
  }
  if (declaredLength !== null && declaredLength > maximumBytes) {
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
      if (totalBytes > maximumBytes) {
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
    if (declaredLength !== null && bytes.byteLength !== declaredLength) {
      throw new AuthGatewayError(400, 'INVALID_REQUEST')
    }
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    new JsonMemberScanner(source).scan()
    const payload: unknown = JSON.parse(source)
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
  const payload = await readLimitedJsonBody(request, MAX_LEGACY_AUTH_BODY_BYTES)
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
    const headers = new Headers(request.headers)
    headers.delete('Content-Encoding')
    headers.delete('Content-Length')
    return new Request(verificationUrl, {
      headers,
      method: 'GET'
    })
  }

  if (pathname === '/api/auth/request-password-reset') {
    delete nextPayload.redirectTo
  }

  if (pathname === '/api/auth/change-password') {
    nextPayload.revokeOtherSessions = true
  }

  const headers = new Headers(request.headers)
  headers.delete('Content-Encoding')
  headers.delete('Content-Length')
  return new Request(request.url, {
    headers,
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

const appendPrivateNoStore = (response: Response): Response => {
  const headers = new Headers(response.headers)
  headers.set('Cache-Control', 'private, no-store')

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
      | 'INVALID_REQUEST'
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
  handle: (
    request: Request,
    peerAddress?: string,
    rawRequestTarget?: string
  ) => Promise<Response>
}

export const createAuthGateway = ({
  auth,
  client,
  environment,
  phase7Facade,
  technicalRateLimiter,
  delay = sleep,
  now = Date.now
}: CreateAuthGatewayDependencies): AuthGateway => {
  const technicalMode = environment.ADMIN_CMS_MODE === 'technical'
  if (
    technicalMode ? !phase7Facade || !technicalRateLimiter : !auth || !client
  ) {
    throw new Error('Auth gateway runtime dependencies do not match its mode.')
  }
  const clientIpAuthority = createClientIpAuthority(
    environment.AUTH_TRUSTED_PROXY_CIDRS
  )

  return {
    handle: async (incomingRequest, peerAddress, rawRequestTarget) => {
      const request = clientIpAuthority.apply(incomingRequest, peerAddress)
      const requestUrl = new URL(request.url)
      const pathname = requestUrl.pathname
      const startedAt = now()

      const rawPathname = getRawRequestPathname(
        rawRequestTarget ?? incomingRequest.url
      )
      if (rawPathname === null || rawPathname !== pathname) {
        throw new AuthGatewayError(404, 'AUTH_ROUTE_NOT_FOUND')
      }

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

        return appendPrivateNoStore(
          new Response(null, {
            status: 204,
            headers: {
              'Access-Control-Allow-Credentials': 'true',
              'Access-Control-Allow-Headers': 'Content-Type',
              'Access-Control-Allow-Methods': requestedMethod,
              'Access-Control-Allow-Origin': origin,
              Vary: 'Origin'
            }
          })
        )
      }

      if (!isAllowedOperation(request.method, pathname)) {
        throw new AuthGatewayError(404, 'AUTH_ROUTE_NOT_FOUND')
      }
      if (technicalMode && request.url.includes('?')) {
        throw new AuthGatewayError(400, 'INVALID_AUTH_PAYLOAD')
      }

      let forwardedRequest = request
      let technicalPayload: Record<string, unknown> | undefined
      let sessionBeforePasswordChange: unknown

      if (request.method === 'POST') {
        assertTrustedWriteRequest(request, environment.TRUSTED_ORIGINS)
        if (technicalMode) {
          technicalPayload = await readLimitedJsonBody(
            request,
            MAX_TECHNICAL_AUTH_BODY_BYTES
          )
          const strictLimit = new Set([
            '/api/auth/request-password-reset',
            '/api/auth/send-verification-email'
          ]).has(pathname)
          const credentialLimit = new Set([
            '/api/auth/sign-in/email',
            '/api/auth/sign-up/email'
          ]).has(pathname)
          await technicalRateLimiter!.consume({
            clientIp:
              request.headers.get('x-nihongo-client-ip') ?? 'unresolved',
            max: strictLimit ? 3 : credentialLimit ? 5 : 100,
            operation: `auth:${pathname}`,
            windowMs: 60_000
          })
        } else {
          forwardedRequest = await withGatewayRequestPolicy(
            request,
            pathname,
            environment
          )
        }
      }

      if (!technicalMode && pathname === '/api/auth/change-password') {
        sessionBeforePasswordChange = await auth!.api.getSession({
          headers: request.headers
        })
      }

      let response = technicalMode
        ? await phase7Facade!.handle(request, pathname, technicalPayload ?? {})
        : await auth!.handler(forwardedRequest)

      if (
        !technicalMode &&
        pathname === '/api/auth/change-password' &&
        response.ok
      ) {
        const session = internalSessionSchema.safeParse(
          sessionBeforePasswordChange
        )
        if (session.success) {
          await client!.session.deleteMany({
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
        (environment.NODE_ENV === 'production' ||
          (technicalMode && pathname === '/api/auth/request-password-reset'))
      ) {
        const remaining = PASSWORD_RESET_RESPONSE_FLOOR_MS - (now() - startedAt)
        if (remaining > 0) {
          await delay(remaining)
        }
      }
      return appendPrivateNoStore(
        appendDevelopmentCors(response, request, environment)
      )
    }
  }
}
