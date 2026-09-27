import {
  assertCreateAdminQuestionResponse,
  assertCreateAdminQuestionVersionResponse,
  assertRequestContentReviewResponse,
  assertRequestQuestionChangesResponse,
  assertReauthenticateAdminResponse,
  assertUpdateQuestionVersionResponse,
  buildPhase7OperationFailureResponse,
  createAdminQuestionRequestSchema,
  createAdminQuestionVersionParamsSchema,
  createAdminQuestionVersionRequestSchema,
  parsePhase7JsonBytes,
  Phase7JsonParseError,
  requestContentReviewParamsSchema,
  requestContentReviewRequestSchema,
  requestQuestionChangesParamsSchema,
  requestQuestionChangesRequestSchema,
  reauthenticateAdminRequestSchema,
  updateQuestionVersionParamsSchema,
  updateQuestionVersionRequestSchema,
  type Phase7Operation
} from '@nihongo/contracts/admin/phase7'
import {
  apiFailureSchema,
  type ApiFailure
} from '@nihongo/contracts/common/error'
import { requestIdSchema } from '@nihongo/contracts/common/id'
import { http, HttpResponse, type JsonBodyType } from 'msw'
import { z, type ZodError, type ZodType } from 'zod'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { MockPhase7AdminCommandError } from '@mocks/repository/phase7AdminCmsState'
import { MOCK_ADMIN_PASSWORD } from '@mocks/handlers/authHandlers'

const LARGE_BODY_CAP = 256 * 1024
const SMALL_BODY_CAP = 16 * 1024
const CANONICAL_CONTENT_LENGTH = /^(?:0|[1-9][0-9]*)$/u
const JSON_MEDIA_TYPE =
  /^application\/json(?:[ \t]*;[ \t]*charset[ \t]*=[ \t]*(?:utf-8|"utf-8"))?$/iu
const LOWERCASE_UUID =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'

const canonicalCommandPaths = [
  /^\/api\/v1\/admin\/questions$/,
  new RegExp(`^/api/v1/admin/questions/${LOWERCASE_UUID}/versions$`),
  new RegExp(`^/api/v1/admin/question-versions/${LOWERCASE_UUID}$`),
  new RegExp(
    `^/api/v1/admin/question-versions/${LOWERCASE_UUID}/review-request$`
  ),
  new RegExp(
    `^/api/v1/admin/question-versions/${LOWERCASE_UUID}/change-request$`
  ),
  /^\/api\/v1\/admin\/reauthentication$/
] as const

const bodyCapByOperation: Readonly<Partial<Record<Phase7Operation, number>>> = {
  createAdminQuestion: LARGE_BODY_CAP,
  createAdminQuestionVersion: LARGE_BODY_CAP,
  updateQuestionVersion: LARGE_BODY_CAP,
  requestContentReview: SMALL_BODY_CAP,
  requestQuestionChanges: SMALL_BODY_CAP,
  reauthenticateAdmin: 4 * 1024
}

type RateGroup = 'ADMIN_EDIT' | 'REAUTHENTICATION'

const groupByOperation: Readonly<Partial<Record<Phase7Operation, RateGroup>>> =
  {
    createAdminQuestion: 'ADMIN_EDIT',
    createAdminQuestionVersion: 'ADMIN_EDIT',
    updateQuestionVersion: 'ADMIN_EDIT',
    requestContentReview: 'ADMIN_EDIT',
    requestQuestionChanges: 'ADMIN_EDIT',
    reauthenticateAdmin: 'REAUTHENTICATION'
  }

const ratePolicyByGroup: Readonly<
  Record<RateGroup, { limit: number; windowMs: number }>
> = {
  ADMIN_EDIT: { limit: 30, windowMs: 10 * 60 * 1000 },
  REAUTHENTICATION: { limit: 5, windowMs: 15 * 60 * 1000 }
}

const freshOperations = new Set<Phase7Operation>()

interface RateWindow {
  count: number
  windowStartedAt: number
}

const rateWindowByKey = new Map<string, RateWindow>()

export const resetAdminCmsCommandRateLimitForTesting = (): void => {
  rateWindowByKey.clear()
}

const toFieldErrors = (error: ZodError): Record<string, string[]> => {
  const fieldErrors: Record<string, string[]> = {}
  for (const issue of error.issues) {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'request'
    fieldErrors[path] = [...(fieldErrors[path] ?? []), issue.message]
  }
  return fieldErrors
}

const getRequestId = (request: Request): string => {
  const incoming = requestIdSchema.safeParse(
    request.headers.get('X-Request-Id')
  )
  return incoming.success ? incoming.data : crypto.randomUUID()
}

const responseHeaders = (
  requestId: string,
  request?: Request,
  baseHeaders?: HeadersInit,
  retryAfterSeconds?: number
): Headers => {
  const headers = new Headers(baseHeaders)
  headers.set('Cache-Control', 'private, no-store')
  headers.set('X-Request-Id', requestId)
  if (retryAfterSeconds !== undefined) {
    headers.set('Retry-After', String(retryAfterSeconds))
  }
  if (request) {
    headers.set('Access-Control-Allow-Credentials', 'true')
    headers.set(
      'Access-Control-Expose-Headers',
      'Content-Disposition, Idempotency-Replayed, Location, Retry-After, X-Request-Id, X-Nihongo-Practice-Contract'
    )
    headers.set('Vary', 'Origin')
    const origin = request.headers.get('Origin')
    if (origin !== null && origin === new URL(request.url).origin) {
      headers.set('Access-Control-Allow-Origin', origin)
    }
  }
  return headers
}

const genericNotFound = (request: Request): HttpResponse<ApiFailure> => {
  const requestId = getRequestId(request)
  return HttpResponse.json(
    apiFailureSchema.parse({
      code: 'RESOURCE_NOT_FOUND',
      message: '요청한 경로를 찾을 수 없습니다.',
      requestId,
      retryable: false
    }),
    { status: 404, headers: responseHeaders(requestId) }
  )
}

const toFailureResponse = (
  operation: Phase7Operation,
  request: Request,
  requestId: string,
  error: unknown
): HttpResponse<ApiFailure> => {
  const failure =
    error instanceof MockPhase7AdminCommandError
      ? error
      : new MockPhase7AdminCommandError({
          code: 'SERVICE_UNAVAILABLE',
          message: '관리자 명령 결과를 확인할 수 없습니다.',
          disposition: 'COMMIT_UNKNOWN'
        })
  const response = buildPhase7OperationFailureResponse({
    operation,
    failure: {
      code: failure.code,
      message: failure.message,
      ...(failure.fieldErrors ? { fieldErrors: failure.fieldErrors } : {}),
      requestId
    },
    disposition: failure.disposition,
    ...(failure.internalReason === undefined
      ? {}
      : { internalReason: failure.internalReason }),
    ...(failure.retryAfterSeconds === undefined
      ? {}
      : { retryAfterSeconds: failure.retryAfterSeconds })
  })
  return HttpResponse.json(response.body, {
    status: response.status,
    headers: responseHeaders(
      requestId,
      request,
      response.headers,
      failure.retryAfterSeconds
    )
  })
}

const hasCanonicalCommandPath = (request: Request): boolean => {
  const url = new URL(request.url)
  return (
    url.hash === '' &&
    canonicalCommandPaths.some((pattern) => pattern.test(url.pathname))
  )
}

const bodyCap = (operation: Phase7Operation): number =>
  bodyCapByOperation[operation] ?? SMALL_BODY_CAP

const assertDeclaredBodyBound = (
  request: Request,
  maximumBytes: number
): void => {
  const declared = request.headers.get('Content-Length')
  if (declared === null) return
  if (!CANONICAL_CONTENT_LENGTH.test(declared)) {
    throw new MockPhase7AdminCommandError({
      code: 'INVALID_REQUEST',
      message: 'Content-Length가 올바르지 않습니다.'
    })
  }
  if (BigInt(declared) > BigInt(maximumBytes)) {
    throw new MockPhase7AdminCommandError({
      code: 'REQUEST_TOO_LARGE',
      message: '요청 본문이 허용된 크기를 초과했습니다.'
    })
  }
}

const requireAdmin = (): string => {
  const user = mockDatabase.getCurrentUser()
  if (!user) {
    throw new MockPhase7AdminCommandError({
      code: 'AUTHENTICATION_REQUIRED',
      message: '관리자 기능을 사용하려면 로그인이 필요합니다.'
    })
  }
  if (user.role !== 'ADMIN') {
    throw new MockPhase7AdminCommandError({
      code: 'ADMIN_REQUIRED',
      message: '관리자 권한이 필요합니다.'
    })
  }
  return user.id
}

const assertFreshAssurance = (
  operation: Phase7Operation,
  actorId: string
): void => {
  if (
    freshOperations.has(operation) &&
    !mockDatabase.getPhase7AdminCmsStateForHandlers().hasFreshAssurance(actorId)
  ) {
    throw new MockPhase7AdminCommandError({
      code: 'FRESH_ASSURANCE_REQUIRED',
      message: '민감한 관리자 작업을 위해 비밀번호를 다시 확인해 주세요.'
    })
  }
}

const assertJsonTransport = (request: Request): void => {
  const encoding = request.headers.get('Content-Encoding')
  if (encoding !== null && encoding.toLowerCase() !== 'identity') {
    throw new MockPhase7AdminCommandError({
      code: 'INVALID_REQUEST',
      message: '지원하지 않는 Content-Encoding입니다.'
    })
  }
  const contentType = request.headers.get('Content-Type')
  if (!contentType || !JSON_MEDIA_TYPE.test(contentType)) {
    throw new MockPhase7AdminCommandError({
      code: 'INVALID_REQUEST',
      message: 'JSON Content-Type이 필요합니다.'
    })
  }
}

const assertTrustedOrigin = (request: Request): void => {
  const origin = request.headers.get('Origin')
  const fetchSite = request.headers.get('Sec-Fetch-Site')
  const originIsTrusted =
    origin !== null &&
    !origin.includes(',') &&
    origin === new URL(request.url).origin
  const trustedWithOrigin =
    originIsTrusted &&
    (fetchSite === null ||
      fetchSite === 'same-origin' ||
      fetchSite === 'same-site')
  const sameOriginWithoutOrigin = origin === null && fetchSite === 'same-origin'
  if (trustedWithOrigin || sameOriginWithoutOrigin) return
  throw new MockPhase7AdminCommandError({
    code: 'UNTRUSTED_ORIGIN',
    message: '신뢰할 수 있는 요청 출처가 필요합니다.'
  })
}

const consumeRate = (operation: Phase7Operation, actorId: string): void => {
  const group = groupByOperation[operation]
  if (!group) {
    throw new MockPhase7AdminCommandError({
      code: 'INTERNAL_SERVER_ERROR',
      message: '관리자 명령 정책을 확인할 수 없습니다.'
    })
  }
  const policy = ratePolicyByGroup[group]
  const now = Date.now()
  let maximumRetry = 0
  for (const key of [`${group}:actor:${actorId}`, `${group}:ip:mock-client`]) {
    const previous = rateWindowByKey.get(key)
    const current =
      !previous || now >= previous.windowStartedAt + policy.windowMs
        ? { count: 1, windowStartedAt: now }
        : {
            count: previous.count + 1,
            windowStartedAt: previous.windowStartedAt
          }
    rateWindowByKey.set(key, current)
    if (current.count > policy.limit) {
      maximumRetry = Math.max(
        maximumRetry,
        Math.max(
          1,
          Math.ceil((current.windowStartedAt + policy.windowMs - now) / 1000)
        )
      )
    }
  }
  if (maximumRetry > 0) {
    throw new MockPhase7AdminCommandError({
      code: 'RATE_LIMITED',
      message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
      retryAfterSeconds: maximumRetry
    })
  }
}

const assertEmptyQuery = (request: Request): void => {
  if (new URL(request.url).search.length > 0) {
    throw new MockPhase7AdminCommandError({
      code: 'VALIDATION_ERROR',
      message: '관리자 명령 쿼리 문자열이 올바르지 않습니다.',
      fieldErrors: { query: ['쿼리 파라미터를 사용할 수 없습니다.'] }
    })
  }
}

export const readPhase7MockJsonBody = async (
  request: Request,
  maximumBytes: number
): Promise<unknown> => {
  const reader = request.body?.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  if (reader) {
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        byteLength += chunk.value.byteLength
        if (byteLength > maximumBytes) {
          void reader.cancel().catch(() => undefined)
          throw new MockPhase7AdminCommandError({
            code: 'REQUEST_TOO_LARGE',
            message: '요청 본문이 허용된 크기를 초과했습니다.'
          })
        }
        chunks.push(chunk.value)
      }
    } catch (error: unknown) {
      if (error instanceof MockPhase7AdminCommandError) throw error
      throw new MockPhase7AdminCommandError({
        code: 'INVALID_JSON',
        message: 'JSON 요청 본문이 올바르지 않습니다.'
      })
    }
  }
  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    const value = parsePhase7JsonBytes(bytes)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new MockPhase7AdminCommandError({
        code: 'INVALID_JSON',
        message: 'JSON 요청 본문이 올바르지 않습니다.'
      })
    }
    return value
  } catch (error: unknown) {
    if (
      error instanceof Phase7JsonParseError &&
      error.kind === 'MAX_DEPTH_EXCEEDED'
    ) {
      throw new MockPhase7AdminCommandError({
        code: 'VALIDATION_ERROR',
        message: 'JSON 요청 본문의 중첩 깊이가 너무 큽니다.'
      })
    }
    throw new MockPhase7AdminCommandError({
      code: 'INVALID_JSON',
      message: 'JSON 요청 본문이 올바르지 않습니다.'
    })
  }
}

const parseBody = async <Schema extends ZodType>(
  request: Request,
  operation: Phase7Operation,
  schema: Schema,
  message: string
): Promise<z.output<Schema>> => {
  const raw = await readPhase7MockJsonBody(request, bodyCap(operation))
  const result = schema.safeParse(raw)
  if (result.success) return result.data
  throw new MockPhase7AdminCommandError({
    code: 'VALIDATION_ERROR',
    message,
    fieldErrors: toFieldErrors(result.error)
  })
}

const assertCommitted = <Result>(assertion: () => Result): Result => {
  try {
    return assertion()
  } catch {
    throw new MockPhase7AdminCommandError({
      code: 'INTERNAL_SERVER_ERROR',
      message: '관리자 명령 응답 무결성을 확인할 수 없습니다.',
      disposition: 'COMMIT_CONFIRMED'
    })
  }
}

const handleCommand = async <
  Schema extends ZodType,
  Result,
  Response extends JsonBodyType
>(input: {
  assertResult: (body: z.output<Schema>, raw: Result) => Response
  execute: (context: {
    actorId: string
    body: z.output<Schema>
    requestId: string
  }) => Promise<Result>
  message: string
  operation: Phase7Operation
  request: Request
  schema: Schema
  setCookies?: (context: {
    actorId: string
    body: z.output<Schema>
    raw: Result
    requestId: string
  }) => readonly string[]
  status?: number
}): Promise<HttpResponse<JsonBodyType>> => {
  const requestId = getRequestId(input.request)
  try {
    assertDeclaredBodyBound(input.request, bodyCap(input.operation))
    const actorId = requireAdmin()
    assertFreshAssurance(input.operation, actorId)
    assertJsonTransport(input.request)
    assertTrustedOrigin(input.request)
    consumeRate(input.operation, actorId)
    assertEmptyQuery(input.request)
    const body = await parseBody(
      input.request,
      input.operation,
      input.schema,
      input.message
    )
    const raw = await input.execute({ actorId, body, requestId })
    const response = assertCommitted(() => input.assertResult(body, raw))
    const headers = responseHeaders(requestId, input.request)
    for (const cookie of input.setCookies?.({
      actorId,
      body,
      raw,
      requestId
    }) ?? []) {
      headers.append('Set-Cookie', cookie)
    }
    return HttpResponse.json(response, {
      status: input.status ?? 200,
      headers
    })
  } catch (error: unknown) {
    return toFailureResponse(input.operation, input.request, requestId, error)
  }
}

const parseParams = <Schema extends ZodType>(
  schema: Schema,
  value: unknown
): z.output<Schema> => schema.parse(value)

const sources = () => mockDatabase.listCanonicalAdminQuestionSources()
const state = () => mockDatabase.getPhase7AdminCmsStateForHandlers()
const commitAuthority = (actorId: string, operation: Phase7Operation) => () =>
  mockDatabase.assertPhase7AdminCommandAuthority({
    actorId,
    requiresFresh: freshOperations.has(operation)
  })

export const adminCmsCommandHandlers = [
  http.options(
    ({ request }) => hasCanonicalCommandPath(request),
    ({ request }) => {
      const origin = request.headers.get('Origin')
      const requestOrigin = new URL(request.url).origin
      const headers = responseHeaders(getRequestId(request))
      headers.set('Access-Control-Allow-Credentials', 'true')
      headers.set('Access-Control-Allow-Headers', 'Content-Type')
      headers.set(
        'Access-Control-Allow-Methods',
        'DELETE, GET, OPTIONS, PATCH, POST, PUT'
      )
      headers.set(
        'Access-Control-Expose-Headers',
        'Content-Disposition, Idempotency-Replayed, Location, Retry-After, X-Request-Id, X-Nihongo-Practice-Contract'
      )
      headers.set('Access-Control-Max-Age', '600')
      headers.set('Vary', 'Origin')
      if (origin !== null && origin === requestOrigin) {
        headers.set('Access-Control-Allow-Origin', origin)
      }
      return new HttpResponse(null, { status: 204, headers })
    }
  ),
  http.post('*/api/v1/admin/questions', ({ request }) =>
    hasCanonicalCommandPath(request)
      ? handleCommand({
          operation: 'createAdminQuestion',
          request,
          schema: createAdminQuestionRequestSchema,
          message: '관리자 문제 생성 요청이 올바르지 않습니다.',
          status: 201,
          execute: ({ actorId, body, requestId }) =>
            state().createQuestion({
              actorId,
              assertAuthority: commitAuthority(actorId, 'createAdminQuestion'),
              request: body,
              requestId,
              sources: sources()
            }),
          assertResult: (body, raw) =>
            assertCreateAdminQuestionResponse(body, raw)
        })
      : genericNotFound(request)
  ),
  http.post(
    '*/api/v1/admin/questions/:questionId/versions',
    ({ params, request }) => {
      if (!hasCanonicalCommandPath(request)) return genericNotFound(request)
      const parsedParams = parseParams(createAdminQuestionVersionParamsSchema, {
        questionId: String(params.questionId ?? '')
      })
      return handleCommand({
        operation: 'createAdminQuestionVersion',
        request,
        schema: createAdminQuestionVersionRequestSchema,
        message: '관리자 문제 버전 생성 요청이 올바르지 않습니다.',
        status: 201,
        execute: ({ actorId, body, requestId }) =>
          state().createVersion({
            actorId,
            assertAuthority: commitAuthority(
              actorId,
              'createAdminQuestionVersion'
            ),
            questionId: parsedParams.questionId,
            request: body,
            requestId,
            sources: sources()
          }),
        assertResult: (body, raw) =>
          assertCreateAdminQuestionVersionResponse(parsedParams, body, raw)
      })
    }
  ),
  http.patch(
    '*/api/v1/admin/question-versions/:versionId',
    ({ params, request }) => {
      if (!hasCanonicalCommandPath(request)) return genericNotFound(request)
      const parsedParams = parseParams(updateQuestionVersionParamsSchema, {
        versionId: String(params.versionId ?? '')
      })
      return handleCommand({
        operation: 'updateQuestionVersion',
        request,
        schema: updateQuestionVersionRequestSchema,
        message: '관리자 문제 버전 수정 요청이 올바르지 않습니다.',
        execute: ({ actorId, body, requestId }) =>
          state().updateVersion({
            actorId,
            assertAuthority: commitAuthority(actorId, 'updateQuestionVersion'),
            versionId: parsedParams.versionId,
            request: body,
            requestId,
            sources: sources()
          }),
        assertResult: (body, raw) =>
          assertUpdateQuestionVersionResponse(parsedParams, body, raw)
      })
    }
  ),
  http.post(
    '*/api/v1/admin/question-versions/:versionId/review-request',
    ({ params, request }) => {
      if (!hasCanonicalCommandPath(request)) return genericNotFound(request)
      const parsedParams = parseParams(requestContentReviewParamsSchema, {
        versionId: String(params.versionId ?? '')
      })
      return handleCommand({
        operation: 'requestContentReview',
        request,
        schema: requestContentReviewRequestSchema,
        message: '콘텐츠 검수 요청이 올바르지 않습니다.',
        execute: ({ actorId, body, requestId }) =>
          state().transitionVersion({
            actorId,
            assertAuthority: commitAuthority(actorId, 'requestContentReview'),
            operation: 'requestContentReview',
            versionId: parsedParams.versionId,
            request: body,
            requestId,
            sources: sources()
          }),
        assertResult: (body, raw) =>
          assertRequestContentReviewResponse(parsedParams, body, raw)
      })
    }
  ),
  http.post(
    '*/api/v1/admin/question-versions/:versionId/change-request',
    ({ params, request }) => {
      if (!hasCanonicalCommandPath(request)) return genericNotFound(request)
      const parsedParams = parseParams(requestQuestionChangesParamsSchema, {
        versionId: String(params.versionId ?? '')
      })
      return handleCommand({
        operation: 'requestQuestionChanges',
        request,
        schema: requestQuestionChangesRequestSchema,
        message: '수정 요청이 올바르지 않습니다.',
        execute: ({ actorId, body, requestId }) =>
          state().transitionVersion({
            actorId,
            assertAuthority: commitAuthority(actorId, 'requestQuestionChanges'),
            operation: 'requestQuestionChanges',
            versionId: parsedParams.versionId,
            request: body,
            requestId,
            sources: sources()
          }),
        assertResult: (body, raw) =>
          assertRequestQuestionChangesResponse(parsedParams, body, raw)
      })
    }
  ),
  http.post('*/api/v1/admin/reauthentication', ({ request }) =>
    hasCanonicalCommandPath(request)
      ? handleCommand({
          operation: 'reauthenticateAdmin',
          request,
          schema: reauthenticateAdminRequestSchema,
          message: '관리자 재인증 요청이 올바르지 않습니다.',
          execute: ({ actorId, body, requestId }) => {
            if (body.password !== MOCK_ADMIN_PASSWORD) {
              throw new MockPhase7AdminCommandError({
                code: 'REAUTHENTICATION_FAILED',
                message: '비밀번호를 확인할 수 없습니다.'
              })
            }
            return state().reauthenticate({
              actorId,
              assertAuthority: commitAuthority(actorId, 'reauthenticateAdmin'),
              requestId
            })
          },
          assertResult: (body, raw) =>
            assertReauthenticateAdminResponse(body, raw),
          setCookies: () => [
            `nihongo.session_token=mock-${crypto.randomUUID()}; Path=/; HttpOnly; SameSite=Lax`,
            'nihongo.dont_remember=1; Path=/; HttpOnly; SameSite=Lax'
          ]
        })
      : genericNotFound(request)
  )
]
