import {
  buildPhase7OperationFailureResponse,
  diffQuestionVersionParamsSchema,
  diffQuestionVersionQuerySchema,
  getAdminQuestionParamsSchema,
  getAdminQuestionQuerySchema,
  listAdminAuditLogQuerySchema,
  listAdminQuestionsQuerySchema,
  listAdminQuestionVersionsParamsSchema,
  listAdminQuestionVersionsQuerySchema,
  listAdminTagsQuerySchema,
  listQuestionVersionReviewsParamsSchema,
  listQuestionVersionReviewsQuerySchema,
  previewQuestionVersionParamsSchema,
  previewQuestionVersionQuerySchema,
  type Phase7Operation
} from '@nihongo/contracts/admin/phase7'
import {
  apiFailureSchema,
  errorStatusByCode,
  type ApiFailure,
  type StableErrorCode
} from '@nihongo/contracts/common/error'
import { requestIdSchema } from '@nihongo/contracts/common/id'
import { http, HttpResponse, type JsonBodyType } from 'msw'
import { z, type ZodError, type ZodType } from 'zod'
import {
  MockAdminCmsReadIntegrityError,
  MockAdminCmsReadNotFoundError,
  toCanonicalAdminAuditLog,
  toCanonicalAdminQuestionDetail,
  toCanonicalAdminQuestionDiff,
  toCanonicalAdminQuestionList,
  toCanonicalAdminQuestionPreview,
  toCanonicalAdminQuestionReviews,
  toCanonicalAdminQuestionVersions,
  toCanonicalAdminTagList
} from '@mocks/adapters/adminCmsReadContractAdapter'
import { mockDatabase } from '@mocks/repository/mockDatabase'

const ADMIN_READ_LIMIT = 120
const ADMIN_READ_WINDOW_MS = 60_000
const LOWERCASE_UUID =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const canonicalPaths = [
  /^\/api\/v1\/admin\/questions$/,
  new RegExp(`^/api/v1/admin/questions/${LOWERCASE_UUID}$`),
  new RegExp(`^/api/v1/admin/questions/${LOWERCASE_UUID}/versions$`),
  /^\/api\/v1\/admin\/tags$/,
  new RegExp(`^/api/v1/admin/question-versions/${LOWERCASE_UUID}/preview$`),
  new RegExp(`^/api/v1/admin/question-versions/${LOWERCASE_UUID}/diff$`),
  new RegExp(`^/api/v1/admin/question-versions/${LOWERCASE_UUID}/reviews$`),
  /^\/api\/v1\/admin\/audit-log$/
] as const
const forbiddenQueryKeys = new Set(['__proto__', 'constructor', 'prototype'])
const MALFORMED_PERCENT_PATTERN = /%(?![0-9a-f]{2})/iu

interface RateLimitWindow {
  count: number
  windowStartedAt: number
}

class CanonicalReadError extends Error {
  readonly code: StableErrorCode
  readonly fieldErrors?: Record<string, string[]>
  readonly retryAfterSeconds?: number
  readonly retryable: boolean

  constructor(input: {
    code: StableErrorCode
    message: string
    fieldErrors?: Record<string, string[]>
    retryable?: boolean
    retryAfterSeconds?: number
  }) {
    super(input.message)
    this.name = 'CanonicalReadError'
    this.code = input.code
    this.fieldErrors = input.fieldErrors
    this.retryable = input.retryable ?? false
    this.retryAfterSeconds = input.retryAfterSeconds
  }
}

const rateLimitByKey = new Map<string, RateLimitWindow>()

export const resetAdminCmsReadRateLimitForTesting = (): void => {
  rateLimitByKey.clear()
}

export const primeAdminCmsReadRateLimitForTesting = (
  actorId: string,
  count: number
): void => {
  const windowStartedAt = Date.now()
  rateLimitByKey.set(`actor:${actorId}`, { count, windowStartedAt })
  rateLimitByKey.set('ip:mock-client', { count, windowStartedAt })
}

const toFieldErrors = (
  error: ZodError,
  fallbackPath = 'request'
): Record<string, string[]> => {
  const fieldErrors: Record<string, string[]> = {}
  for (const issue of error.issues) {
    const path = issue.path.length > 0 ? issue.path.join('.') : fallbackPath
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
  retryAfterSeconds?: number,
  corsRequest?: Request,
  baseHeaders?: HeadersInit
): Headers => {
  const headers = new Headers(
    baseHeaders ?? {
      'Cache-Control': 'private, no-store',
      'X-Request-Id': requestId
    }
  )
  if (retryAfterSeconds !== undefined) {
    headers.set('Retry-After', String(retryAfterSeconds))
  }
  if (corsRequest) {
    headers.set('Access-Control-Allow-Credentials', 'true')
    headers.set(
      'Access-Control-Expose-Headers',
      'Content-Disposition, Idempotency-Replayed, Location, Retry-After, X-Request-Id, X-Nihongo-Practice-Contract'
    )
    headers.set('Vary', 'Origin')
    const origin = corsRequest.headers.get('Origin')
    if (origin !== null && origin === new URL(corsRequest.url).origin) {
      headers.set('Access-Control-Allow-Origin', origin)
    }
  }
  return headers
}

const toFailureResponse = (
  requestId: string,
  error: unknown,
  corsRequest?: Request,
  operation?: Phase7Operation
): HttpResponse<ApiFailure> => {
  let failure: ApiFailure
  let retryAfterSeconds: number | undefined

  if (error instanceof CanonicalReadError) {
    retryAfterSeconds = error.retryAfterSeconds
    failure = {
      code: error.code,
      message: error.message,
      fieldErrors: error.fieldErrors,
      requestId,
      retryable: error.retryable
    }
  } else if (error instanceof MockAdminCmsReadNotFoundError) {
    failure = {
      code: 'RESOURCE_NOT_FOUND',
      message: error.message,
      requestId,
      retryable: false
    }
  } else {
    failure = {
      code: 'INTERNAL_SERVER_ERROR',
      message:
        error instanceof MockAdminCmsReadIntegrityError
          ? '관리자 문제 조회 무결성을 확인할 수 없습니다.'
          : '관리자 문제 조회 중 오류가 발생했습니다.',
      requestId,
      retryable: true
    }
  }

  if (operation !== undefined) {
    let response
    try {
      response = buildPhase7OperationFailureResponse({
        operation,
        failure: {
          code: failure.code,
          message: failure.message,
          ...(failure.fieldErrors === undefined
            ? {}
            : { fieldErrors: failure.fieldErrors }),
          requestId
        },
        disposition: 'NO_TX',
        ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds })
      })
    } catch {
      response = buildPhase7OperationFailureResponse({
        operation,
        failure: {
          code: 'INTERNAL_SERVER_ERROR',
          message: '관리자 문제 조회 중 오류가 발생했습니다.',
          requestId
        },
        disposition: 'NO_TX'
      })
    }
    return HttpResponse.json(response.body, {
      status: response.status,
      headers: responseHeaders(
        requestId,
        undefined,
        corsRequest,
        response.headers
      )
    })
  }

  const parsed = apiFailureSchema.parse(failure)
  return HttpResponse.json(parsed, {
    status: errorStatusByCode[parsed.code],
    headers: responseHeaders(requestId, retryAfterSeconds, corsRequest)
  })
}

const requireAdmin = (): string => {
  const user = mockDatabase.getCurrentUser()
  if (!user) {
    throw new CanonicalReadError({
      code: 'AUTHENTICATION_REQUIRED',
      message: '관리자 기능을 사용하려면 로그인이 필요합니다.'
    })
  }
  if (user.role !== 'ADMIN') {
    throw new CanonicalReadError({
      code: 'ADMIN_REQUIRED',
      message: '관리자 권한이 필요합니다.'
    })
  }
  return user.id
}

const consumeRateLimitKey = (key: string, now: number): number | null => {
  const previous = rateLimitByKey.get(key)
  const current =
    !previous || now >= previous.windowStartedAt + ADMIN_READ_WINDOW_MS
      ? { count: 1, windowStartedAt: now }
      : { count: previous.count + 1, windowStartedAt: previous.windowStartedAt }
  rateLimitByKey.set(key, current)
  return current.count > ADMIN_READ_LIMIT
    ? Math.max(
        1,
        Math.ceil(
          (current.windowStartedAt + ADMIN_READ_WINDOW_MS - now) / 1_000
        )
      )
    : null
}

const guardAdminRead = (request: Request): void => {
  const actorId = requireAdmin()
  const now = Date.now()
  const actorRetry = consumeRateLimitKey(`actor:${actorId}`, now)
  const ipRetry = consumeRateLimitKey('ip:mock-client', now)
  const retryAfterSeconds = Math.max(actorRetry ?? 0, ipRetry ?? 0)
  if (retryAfterSeconds > 0) {
    throw new CanonicalReadError({
      code: 'RATE_LIMITED',
      message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
      retryable: true,
      retryAfterSeconds
    })
  }
  void request
}

const decodeQueryComponent = (value: string): string => {
  if (MALFORMED_PERCENT_PATTERN.test(value)) {
    throw new Error('Malformed percent encoding.')
  }

  const formValue = value.replaceAll('+', ' ')
  const bytes: number[] = []

  for (let index = 0; index < formValue.length; index += 1) {
    const unit = formValue.charCodeAt(index)
    if (unit === 0x25) {
      bytes.push(Number.parseInt(formValue.slice(index + 1, index + 3), 16))
      index += 2
      continue
    }

    if (unit >= 0xd800 && unit <= 0xdbff) {
      const trailing = formValue.charCodeAt(index + 1)
      if (trailing < 0xdc00 || trailing > 0xdfff) {
        throw new Error('Unpaired surrogate in raw query.')
      }
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new Error('Unpaired surrogate in raw query.')
    }

    const codePoint = formValue.codePointAt(index)
    if (codePoint === undefined) {
      throw new Error('Invalid query code point.')
    }
    const character = String.fromCodePoint(codePoint)
    bytes.push(...new TextEncoder().encode(character))
    if (character.length === 2) {
      index += 1
    }
  }

  return new TextDecoder('utf-8', { fatal: true }).decode(
    Uint8Array.from(bytes)
  )
}

const parseRawQuery = <Schema extends ZodType>(
  request: Request,
  schema: Schema,
  message: string
): z.output<Schema> => {
  const requestTarget = request.url
  const queryStart = requestTarget.indexOf('?')
  const fragmentStart = requestTarget.indexOf('#', queryStart + 1)
  const rawQuery =
    queryStart < 0
      ? ''
      : requestTarget.slice(
          queryStart + 1,
          fragmentStart < 0 ? requestTarget.length : fragmentStart
        )
  const values = Object.create(null) as Record<string, string[]>

  try {
    for (const pair of rawQuery === '' ? [] : rawQuery.split('&')) {
      const separatorIndex = pair.indexOf('=')
      const rawKey = separatorIndex < 0 ? pair : pair.slice(0, separatorIndex)
      const rawValue = separatorIndex < 0 ? '' : pair.slice(separatorIndex + 1)
      const key = decodeQueryComponent(rawKey)
      const value = decodeQueryComponent(rawValue)
      if (key.length === 0 || forbiddenQueryKeys.has(key)) {
        throw new Error('Reserved or empty query key.')
      }
      const entries = values[key] ?? []
      entries.push(value)
      values[key] = entries
    }
  } catch {
    throw new CanonicalReadError({
      code: 'VALIDATION_ERROR',
      message,
      fieldErrors: { query: ['쿼리 문자열이 올바르지 않습니다.'] }
    })
  }

  const scalars = Object.create(null) as Record<string, string>
  for (const [key, entries] of Object.entries(values)) {
    if (entries.length !== 1) {
      throw new CanonicalReadError({
        code: 'VALIDATION_ERROR',
        message,
        fieldErrors: { [key]: ['중복 쿼리 키는 허용되지 않습니다.'] }
      })
    }
    scalars[key] = entries[0]!
  }

  const result = schema.safeParse(scalars)
  if (!result.success) {
    throw new CanonicalReadError({
      code: 'VALIDATION_ERROR',
      message,
      fieldErrors: toFieldErrors(result.error, 'query')
    })
  }
  return result.data
}

const parseParams = <Schema extends ZodType>(
  schema: Schema,
  value: unknown,
  message: string
): z.output<Schema> => {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new CanonicalReadError({
      code: 'INVALID_ID',
      message,
      fieldErrors: toFieldErrors(result.error)
    })
  }
  return result.data
}

const withCanonicalRead = <Body extends JsonBodyType>(
  operation: Phase7Operation,
  request: Request,
  read: () => Body
): HttpResponse<Body | ApiFailure> => {
  const requestId = getRequestId(request)
  try {
    guardAdminRead(request)
    return HttpResponse.json(read(), {
      headers: responseHeaders(requestId, undefined, request)
    })
  } catch (error: unknown) {
    return toFailureResponse(requestId, error, request, operation)
  }
}

const genericNotFound = (request: Request): HttpResponse<ApiFailure> => {
  const requestId = getRequestId(request)
  return toFailureResponse(
    requestId,
    new CanonicalReadError({
      code: 'RESOURCE_NOT_FOUND',
      message: '요청한 경로를 찾을 수 없습니다.'
    })
  )
}

const hasCanonicalPath = (request: Request): boolean => {
  const url = new URL(request.url)
  return (
    url.hash === '' &&
    canonicalPaths.some((pattern) => pattern.test(url.pathname))
  )
}

const PHASE_7_PREFIXES = ['/api/v1/admin', '/api/v1/question-reports'] as const
const MAX_PERCENT_DECODING_PASSES = 16

const hasPhase7Prefix = (pathname: string): boolean =>
  PHASE_7_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + '/')
  )

const getSlashNormalizedPathnames = (pathname: string): readonly string[] => {
  const unresolvedSegments: string[] = []
  const resolvedSegments: string[] = []

  for (const segment of pathname
    .replaceAll(String.fromCharCode(92), '/')
    .split('/')) {
    if (segment.length === 0 || segment === '.') {
      continue
    }

    const normalizedSegment = segment.toLowerCase()
    unresolvedSegments.push(normalizedSegment)
    if (normalizedSegment === '..') {
      resolvedSegments.pop()
      continue
    }
    resolvedSegments.push(normalizedSegment)
  }

  return ['/' + unresolvedSegments.join('/'), '/' + resolvedSegments.join('/')]
}

const hasPhase7Alias = (rawPathname: string): boolean => {
  let candidate = rawPathname

  for (let pass = 0; pass < MAX_PERCENT_DECODING_PASSES; pass += 1) {
    if (getSlashNormalizedPathnames(candidate).some(hasPhase7Prefix)) {
      return true
    }

    const decoded = candidate.replace(
      /%([0-7][0-9a-f])/giu,
      (_match, hexadecimal: string) =>
        String.fromCharCode(Number.parseInt(hexadecimal, 16))
    )
    if (decoded === candidate) {
      return false
    }
    candidate = decoded
  }

  return true
}

const isNonCanonicalPhase7Alias = (request: Request): boolean => {
  const url = new URL(request.url)
  const pathname = url.pathname
  return (
    hasPhase7Alias(pathname) &&
    (url.hash !== '' ||
      !canonicalPaths.some((pattern) => pattern.test(pathname)))
  )
}

const readModel = () => {
  const sources = mockDatabase.listCanonicalAdminQuestionSources()
  return {
    sources,
    snapshot: mockDatabase.getCanonicalAdminCmsSnapshot(sources)
  }
}

export const adminCmsReadHandlers = [
  http.all(
    ({ request }) => isNonCanonicalPhase7Alias(request),
    ({ request }) => genericNotFound(request)
  ),
  http.options('*/api/v1/admin/*', ({ request }) => {
    if (!hasCanonicalPath(request)) {
      return genericNotFound(request)
    }
    const origin = request.headers.get('Origin')
    const requestOrigin = new URL(request.url).origin
    const headers = new Headers({
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'DELETE, GET, OPTIONS, PATCH, POST, PUT',
      'Access-Control-Expose-Headers':
        'Content-Disposition, Idempotency-Replayed, Location, Retry-After, X-Request-Id, X-Nihongo-Practice-Contract',
      'Access-Control-Max-Age': '600',
      'Cache-Control': 'private, no-store',
      Vary: 'Origin',
      'X-Request-Id': getRequestId(request)
    })
    if (origin !== null && origin === requestOrigin) {
      headers.set('Access-Control-Allow-Origin', origin)
    }
    return new HttpResponse(null, { status: 204, headers })
  }),
  http.get('*/api/v1/admin/questions', ({ request }) =>
    hasCanonicalPath(request)
      ? withCanonicalRead('listAdminQuestions', request, () => {
          const query = parseRawQuery(
            request,
            listAdminQuestionsQuerySchema,
            '관리자 문제 목록 조회 조건이 올바르지 않습니다.'
          )
          return toCanonicalAdminQuestionList(readModel(), query)
        })
      : genericNotFound(request)
  ),
  http.get(
    '*/api/v1/admin/questions/:questionId/versions',
    ({ params, request }) =>
      hasCanonicalPath(request)
        ? withCanonicalRead('listAdminQuestionVersions', request, () => {
            const parsed = parseParams(
              listAdminQuestionVersionsParamsSchema,
              { questionId: String(params.questionId ?? '') },
              '문제 ID 형식이 올바르지 않습니다.'
            )
            const query = parseRawQuery(
              request,
              listAdminQuestionVersionsQuerySchema,
              '문제 버전 이력 조회 조건이 올바르지 않습니다.'
            )
            return toCanonicalAdminQuestionVersions(
              readModel(),
              parsed.questionId,
              query
            )
          })
        : genericNotFound(request)
  ),
  http.get('*/api/v1/admin/questions/:questionId', ({ params, request }) =>
    hasCanonicalPath(request)
      ? withCanonicalRead('getAdminQuestion', request, () => {
          const parsed = parseParams(
            getAdminQuestionParamsSchema,
            { questionId: String(params.questionId ?? '') },
            '문제 ID 형식이 올바르지 않습니다.'
          )
          parseRawQuery(
            request,
            getAdminQuestionQuerySchema,
            '관리자 문제 상세 조회 조건이 올바르지 않습니다.'
          )
          return toCanonicalAdminQuestionDetail(readModel(), parsed.questionId)
        })
      : genericNotFound(request)
  ),
  http.get('*/api/v1/admin/tags', ({ request }) =>
    hasCanonicalPath(request)
      ? withCanonicalRead('listAdminTags', request, () => {
          const query = parseRawQuery(
            request,
            listAdminTagsQuerySchema,
            '관리자 태그 조회 조건이 올바르지 않습니다.'
          )
          return toCanonicalAdminTagList(readModel(), query)
        })
      : genericNotFound(request)
  ),
  http.get(
    '*/api/v1/admin/question-versions/:versionId/preview',
    ({ params, request }) =>
      hasCanonicalPath(request)
        ? withCanonicalRead('previewQuestionVersion', request, () => {
            const parsed = parseParams(
              previewQuestionVersionParamsSchema,
              { versionId: String(params.versionId ?? '') },
              '문제 버전 ID 형식이 올바르지 않습니다.'
            )
            parseRawQuery(
              request,
              previewQuestionVersionQuerySchema,
              '문제 버전 preview 조회 조건이 올바르지 않습니다.'
            )
            return toCanonicalAdminQuestionPreview(
              readModel(),
              parsed.versionId
            )
          })
        : genericNotFound(request)
  ),
  http.get(
    '*/api/v1/admin/question-versions/:versionId/diff',
    ({ params, request }) =>
      hasCanonicalPath(request)
        ? withCanonicalRead('diffQuestionVersion', request, () => {
            const parsed = parseParams(
              diffQuestionVersionParamsSchema,
              { versionId: String(params.versionId ?? '') },
              '문제 버전 ID 형식이 올바르지 않습니다.'
            )
            const raw = parseRawQuery(
              request,
              z.object({ baseVersionId: z.string() }).strict(),
              '문제 버전 비교 조건이 올바르지 않습니다.'
            )
            const query = parseParams(
              diffQuestionVersionQuerySchema,
              raw,
              '기준 문제 버전 ID 형식이 올바르지 않습니다.'
            )
            return toCanonicalAdminQuestionDiff(
              readModel(),
              parsed.versionId,
              query
            )
          })
        : genericNotFound(request)
  ),
  http.get(
    '*/api/v1/admin/question-versions/:versionId/reviews',
    ({ params, request }) =>
      hasCanonicalPath(request)
        ? withCanonicalRead('listQuestionVersionReviews', request, () => {
            const parsed = parseParams(
              listQuestionVersionReviewsParamsSchema,
              { versionId: String(params.versionId ?? '') },
              '문제 버전 ID 형식이 올바르지 않습니다.'
            )
            const query = parseRawQuery(
              request,
              listQuestionVersionReviewsQuerySchema,
              '문제 버전 검수 이력 조회 조건이 올바르지 않습니다.'
            )
            return toCanonicalAdminQuestionReviews(
              readModel(),
              parsed.versionId,
              query
            )
          })
        : genericNotFound(request)
  ),
  http.get('*/api/v1/admin/audit-log', ({ request }) =>
    hasCanonicalPath(request)
      ? withCanonicalRead('listAdminAuditLog', request, () =>
          toCanonicalAdminAuditLog(
            readModel(),
            parseRawQuery(
              request,
              listAdminAuditLogQuerySchema,
              '관리자 감사 로그 조회 조건이 올바르지 않습니다.'
            )
          )
        )
      : genericNotFound(request)
  ),
  http.all('*/api/v1/admin', ({ request }) => genericNotFound(request)),
  http.all('*/api/v1/admin/*', ({ request }) => genericNotFound(request)),
  http.all('*/api/v1/question-reports', ({ request }) =>
    genericNotFound(request)
  ),
  http.all('*/api/v1/question-reports/*', ({ request }) =>
    genericNotFound(request)
  )
]
