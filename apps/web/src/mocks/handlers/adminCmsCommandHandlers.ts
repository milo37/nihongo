import {
  assertCreateQuestionReportForRequest,
  buildPhase7OperationFailureResponse,
  createQuestionReportRequestSchema,
  parseJsonBytes,
  JsonParseError,
  type ContentOperation
} from '@nihongo/contracts/admin/content-operations'
import {
  apiFailureSchema,
  type ApiFailure
} from '@nihongo/contracts/common/error'
import { requestIdSchema } from '@nihongo/contracts/common/id'
import { http, HttpResponse, type JsonBodyType } from 'msw'
import { z, type ZodError, type ZodType } from 'zod'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { MockContentCommandError } from '@mocks/repository/mockContentState'
import {
  questionReportRateLimitRepository,
  QuestionReportRateLimitRepositoryUnavailableError,
  type QuestionReportRateLimitInput
} from '@mocks/repository/questionReportRateLimitRepository'

const REPORT_BODY_CAP = 32 * 1024
const CANONICAL_CONTENT_LENGTH = /^(?:0|[1-9][0-9]*)$/u
const JSON_MEDIA_TYPE =
  /^application\/json(?:[ \t]*;[ \t]*charset[ \t]*=[ \t]*(?:utf-8|"utf-8"))?$/iu
const MOCK_CLIENT_ORIGIN_HEADER = 'X-Nihongo-MSW-Client-Origin'
const canonicalCommandPaths = [/^\/api\/v1\/question-reports$/] as const

export const resetAdminCmsCommandRateLimitForTesting = (): void => {
  questionReportRateLimitRepository.resetForTesting()
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
  operation: ContentOperation,
  request: Request,
  requestId: string,
  error: unknown
): HttpResponse<ApiFailure> => {
  const failure =
    error instanceof MockContentCommandError
      ? error
      : new MockContentCommandError({
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

const bodyCap = (_operation: ContentOperation): number => REPORT_BODY_CAP

const assertDeclaredBodyBound = (
  request: Request,
  maximumBytes: number
): void => {
  const declared = request.headers.get('Content-Length')
  if (declared === null) return
  if (!CANONICAL_CONTENT_LENGTH.test(declared)) {
    throw new MockContentCommandError({
      code: 'INVALID_REQUEST',
      message: 'Content-Length가 올바르지 않습니다.'
    })
  }
  if (BigInt(declared) > BigInt(maximumBytes)) {
    throw new MockContentCommandError({
      code: 'REQUEST_TOO_LARGE',
      message: '요청 본문이 허용된 크기를 초과했습니다.'
    })
  }
}

const requireReporter = (): { actorId: string; role: 'USER' | 'ADMIN' } => {
  let user: ReturnType<typeof mockDatabase.getCurrentUser>
  try {
    user = mockDatabase.getCurrentUser()
  } catch {
    throw new MockContentCommandError({
      code: 'SERVICE_UNAVAILABLE',
      message: '최신 인증 세션을 확인하지 못했습니다.',
      disposition: 'NO_TX'
    })
  }
  if (!user) {
    throw new MockContentCommandError({
      code: 'AUTHENTICATION_REQUIRED',
      message: '문제를 신고하려면 로그인이 필요합니다.'
    })
  }
  if (user.role !== 'USER' && user.role !== 'ADMIN') {
    throw new MockContentCommandError({
      code: 'FORBIDDEN',
      message: '문제 신고 권한이 없습니다.'
    })
  }
  return { actorId: user.id, role: user.role }
}

const assertJsonTransport = (request: Request): void => {
  const encoding = request.headers.get('Content-Encoding')
  if (encoding !== null && encoding.toLowerCase() !== 'identity') {
    throw new MockContentCommandError({
      code: 'INVALID_REQUEST',
      message: '지원하지 않는 Content-Encoding입니다.'
    })
  }
  const contentType = request.headers.get('Content-Type')
  if (!contentType || !JSON_MEDIA_TYPE.test(contentType)) {
    throw new MockContentCommandError({
      code: 'INVALID_REQUEST',
      message: 'JSON Content-Type이 필요합니다.'
    })
  }
}

const assertTrustedOrigin = (request: Request): void => {
  const origin = request.headers.get('Origin')
  const fetchSite = request.headers.get('Sec-Fetch-Site')
  const mockClientOrigin = request.headers.get(MOCK_CLIENT_ORIGIN_HEADER)
  const requestOrigin = new URL(request.url).origin
  const originIsTrusted =
    origin !== null && !origin.includes(',') && origin === requestOrigin
  const trustedWithOrigin =
    originIsTrusted &&
    (fetchSite === null ||
      fetchSite === 'same-origin' ||
      fetchSite === 'same-site')
  const sameOriginWithoutOrigin = origin === null && fetchSite === 'same-origin'
  let hasActiveMockController = false
  if (
    typeof window !== 'undefined' &&
    'serviceWorker' in window.navigator &&
    window.navigator.serviceWorker.controller
  ) {
    const controllerUrl = new URL(
      window.navigator.serviceWorker.controller.scriptURL,
      window.location.href
    )
    hasActiveMockController =
      controllerUrl.origin === requestOrigin &&
      controllerUrl.pathname === '/mockServiceWorker.js' &&
      controllerUrl.search === '' &&
      controllerUrl.hash === ''
  }
  const sameOriginMockAttestation =
    origin === null &&
    fetchSite === null &&
    hasActiveMockController &&
    mockClientOrigin !== null &&
    !mockClientOrigin.includes(',') &&
    mockClientOrigin === requestOrigin
  if (
    trustedWithOrigin ||
    sameOriginWithoutOrigin ||
    sameOriginMockAttestation
  ) {
    return
  }
  throw new MockContentCommandError({
    code: 'UNTRUSTED_ORIGIN',
    message: '신뢰할 수 있는 요청 출처가 필요합니다.'
  })
}

const consumeSharedRate = async (
  input: QuestionReportRateLimitInput
): Promise<void> => {
  let retryAfterSeconds: number | null
  try {
    ;({ retryAfterSeconds } =
      await questionReportRateLimitRepository.consume(input))
  } catch (error: unknown) {
    if (error instanceof QuestionReportRateLimitRepositoryUnavailableError) {
      throw new MockContentCommandError({
        code: 'SERVICE_UNAVAILABLE',
        message: '요청 제한 상태를 확인할 수 없습니다.',
        disposition: 'NO_TX',
        retryAfterSeconds: error.retryAfterSeconds
      })
    }
    throw error
  }
  if (retryAfterSeconds !== null) {
    throw new MockContentCommandError({
      code: 'RATE_LIMITED',
      message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
      retryAfterSeconds
    })
  }
}

const consumeQuestionReportRate = async (
  group: 'REPORT_ACTOR' | 'REPORT_VERSION',
  value: string
): Promise<void> => {
  await consumeSharedRate(
    group === 'REPORT_ACTOR'
      ? { actorId: value, group }
      : { group, versionId: value }
  )
}

const assertEmptyQuery = (request: Request): void => {
  if (new URL(request.url).search.length > 0) {
    throw new MockContentCommandError({
      code: 'VALIDATION_ERROR',
      message: '관리자 명령 쿼리 문자열이 올바르지 않습니다.',
      fieldErrors: { query: ['쿼리 파라미터를 사용할 수 없습니다.'] }
    })
  }
}

export const readMockJsonBody = async (
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
          throw new MockContentCommandError({
            code: 'REQUEST_TOO_LARGE',
            message: '요청 본문이 허용된 크기를 초과했습니다.'
          })
        }
        chunks.push(chunk.value)
      }
    } catch (error: unknown) {
      if (error instanceof MockContentCommandError) throw error
      throw new MockContentCommandError({
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
    const value = parseJsonBytes(bytes)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new MockContentCommandError({
        code: 'INVALID_JSON',
        message: 'JSON 요청 본문이 올바르지 않습니다.'
      })
    }
    return value
  } catch (error: unknown) {
    if (
      error instanceof JsonParseError &&
      error.kind === 'MAX_DEPTH_EXCEEDED'
    ) {
      throw new MockContentCommandError({
        code: 'VALIDATION_ERROR',
        message: 'JSON 요청 본문의 중첩 깊이가 너무 큽니다.'
      })
    }
    throw new MockContentCommandError({
      code: 'INVALID_JSON',
      message: 'JSON 요청 본문이 올바르지 않습니다.'
    })
  }
}

const parseBody = async <Schema extends ZodType>(
  request: Request,
  operation: ContentOperation,
  schema: Schema,
  message: string
): Promise<z.output<Schema>> => {
  const raw = await readMockJsonBody(request, bodyCap(operation))
  const result = schema.safeParse(raw)
  if (result.success) return result.data
  throw new MockContentCommandError({
    code: 'VALIDATION_ERROR',
    message,
    fieldErrors: toFieldErrors(result.error)
  })
}

const assertOperationResult = async <Result>(
  assertion: () => Result | Promise<Result>,
  disposition: 'NO_TX' | 'COMMIT_CONFIRMED'
): Promise<Result> => {
  try {
    return await assertion()
  } catch {
    throw new MockContentCommandError({
      code: 'INTERNAL_SERVER_ERROR',
      message: '관리자 명령 응답 무결성을 확인할 수 없습니다.',
      disposition
    })
  }
}

const state = () => mockDatabase.getMockContentStateForHandlers()

const handleCreateQuestionReport = async (
  request: Request
): Promise<HttpResponse<JsonBodyType>> => {
  const operation = 'createQuestionReport' as const
  const requestId = getRequestId(request)
  try {
    assertDeclaredBodyBound(request, bodyCap(operation))
    const reporter = requireReporter()
    assertJsonTransport(request)
    assertTrustedOrigin(request)
    await consumeQuestionReportRate('REPORT_ACTOR', reporter.actorId)
    assertEmptyQuery(request)
    const body = await parseBody(
      request,
      operation,
      createQuestionReportRequestSchema,
      '문제 신고 요청이 올바르지 않습니다.'
    )
    const entitledQuestionId = mockDatabase.resolveQuestionReportEntitlement(
      reporter.actorId,
      body.questionVersionId,
      'NO_TX'
    )
    if (!entitledQuestionId) {
      throw new MockContentCommandError({
        code: 'RESOURCE_NOT_FOUND',
        message: '신고할 수 있는 문제 버전을 찾을 수 없습니다.'
      })
    }
    await consumeQuestionReportRate('REPORT_VERSION', body.questionVersionId)
    const raw = await state().createQuestionReport({
      actorId: reporter.actorId,
      actorRole: reporter.role,
      assertAuthority: () => {
        mockDatabase.assertQuestionReportAuthority(reporter.actorId)
      },
      resolveEntitledQuestionId: (disposition) =>
        mockDatabase.resolveQuestionReportEntitlement(
          reporter.actorId,
          body.questionVersionId,
          disposition
        ),
      request: body
    })
    const response = await assertOperationResult(
      () => assertCreateQuestionReportForRequest(body, raw),
      'COMMIT_CONFIRMED'
    )
    return HttpResponse.json(response, {
      status: 201,
      headers: responseHeaders(requestId, request)
    })
  } catch (error: unknown) {
    return toFailureResponse(operation, request, requestId, error)
  }
}

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
  http.post('*/api/v1/question-reports', ({ request }) =>
    hasCanonicalCommandPath(request)
      ? handleCreateQuestionReport(request)
      : genericNotFound(request)
  )
]
