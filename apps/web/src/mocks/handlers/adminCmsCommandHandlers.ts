import {
  adminQuestionExportContentDisposition,
  adminQuestionExportContentType,
  applyQuestionImportRequestSchema,
  assertAdminImportApplyForRequest,
  assertAdminImportValidationForRequest,
  assertAdminQuestionExportDocumentForRequest,
  assertApproveQuestionVersionResponse,
  assertArchiveAdminQuestionResponse,
  assertCreateAdminQuestionResponse,
  assertCreateAdminQuestionVersionResponse,
  assertCreateQuestionReportForRequest,
  assertPublishQuestionVersionResponse,
  assertRequestContentReviewBatchResponse,
  assertRequestContentReviewResponse,
  assertRequestQuestionChangesResponse,
  assertReauthenticateAdminResponse,
  assertResolveAdminQuestionReportResponse,
  assertRetireQuestionVersionResponse,
  assertTriageAdminQuestionReportResponse,
  assertUpdateQuestionVersionResponse,
  assertWithdrawQuestionApprovalResponse,
  approveQuestionVersionParamsSchema,
  approveQuestionVersionRequestSchema,
  archiveAdminQuestionParamsSchema,
  archiveAdminQuestionRequestSchema,
  buildPhase7OperationFailureResponse,
  createAdminQuestionRequestSchema,
  createAdminQuestionVersionParamsSchema,
  createAdminQuestionVersionRequestSchema,
  createQuestionReportRequestSchema,
  exportAdminQuestionsRequestSchema,
  parsePhase7JsonBytes,
  Phase7JsonParseError,
  publishQuestionVersionParamsSchema,
  publishQuestionVersionRequestSchema,
  requestContentReviewBatchRequestSchema,
  requestContentReviewParamsSchema,
  requestContentReviewRequestSchema,
  requestQuestionChangesParamsSchema,
  requestQuestionChangesRequestSchema,
  reauthenticateAdminRequestSchema,
  resolveAdminQuestionReportParamsSchema,
  resolveAdminQuestionReportRequestSchema,
  retireQuestionVersionParamsSchema,
  retireQuestionVersionRequestSchema,
  triageAdminQuestionReportParamsSchema,
  triageAdminQuestionReportRequestSchema,
  updateQuestionVersionParamsSchema,
  updateQuestionVersionRequestSchema,
  validateQuestionImportRequestSchema,
  withdrawQuestionApprovalParamsSchema,
  withdrawQuestionApprovalRequestSchema,
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
import {
  phase7RateLimitRepository,
  Phase7RateLimitRepositoryUnavailableError,
  type Phase7RateLimitInput
} from '@mocks/repository/phase7RateLimitRepository'
import { isMockAdminPasswordForActor } from '@mocks/handlers/authHandlers'
import { phase7Sha256TextPort } from '@libs/phase7Sha256'

const LARGE_BODY_CAP = 256 * 1024
const IMPORT_BODY_CAP = 2 * 1024 * 1024
const REPORT_BODY_CAP = 32 * 1024
const SMALL_BODY_CAP = 16 * 1024
const CANONICAL_CONTENT_LENGTH = /^(?:0|[1-9][0-9]*)$/u
const JSON_MEDIA_TYPE =
  /^application\/json(?:[ \t]*;[ \t]*charset[ \t]*=[ \t]*(?:utf-8|"utf-8"))?$/iu
const MOCK_CLIENT_ORIGIN_HEADER = 'X-Nihongo-MSW-Client-Origin'
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
  new RegExp(`^/api/v1/admin/question-versions/${LOWERCASE_UUID}/approval$`),
  new RegExp(
    `^/api/v1/admin/question-versions/${LOWERCASE_UUID}/approval-withdrawal$`
  ),
  new RegExp(`^/api/v1/admin/questions/${LOWERCASE_UUID}/archive$`),
  new RegExp(`^/api/v1/admin/question-versions/${LOWERCASE_UUID}/publication$`),
  new RegExp(`^/api/v1/admin/question-versions/${LOWERCASE_UUID}/retirement$`),
  /^\/api\/v1\/admin\/question-versions\/review-request-batch$/,
  /^\/api\/v1\/admin\/questions\/import-validation$/,
  /^\/api\/v1\/admin\/questions\/import-application$/,
  /^\/api\/v1\/admin\/questions\/export$/,
  new RegExp(`^/api/v1/admin/question-reports/${LOWERCASE_UUID}/triage$`),
  new RegExp(`^/api/v1/admin/question-reports/${LOWERCASE_UUID}/resolution$`),
  /^\/api\/v1\/admin\/reauthentication$/,
  /^\/api\/v1\/question-reports$/
] as const

const bodyCapByOperation: Readonly<Partial<Record<Phase7Operation, number>>> = {
  createAdminQuestion: LARGE_BODY_CAP,
  createAdminQuestionVersion: LARGE_BODY_CAP,
  updateQuestionVersion: LARGE_BODY_CAP,
  requestContentReview: SMALL_BODY_CAP,
  requestQuestionChanges: SMALL_BODY_CAP,
  approveQuestionVersion: SMALL_BODY_CAP,
  withdrawQuestionApproval: SMALL_BODY_CAP,
  publishQuestionVersion: SMALL_BODY_CAP,
  retireQuestionVersion: SMALL_BODY_CAP,
  archiveAdminQuestion: SMALL_BODY_CAP,
  requestContentReviewBatch: LARGE_BODY_CAP,
  validateQuestionImport: IMPORT_BODY_CAP,
  applyQuestionImport: IMPORT_BODY_CAP,
  exportAdminQuestions: SMALL_BODY_CAP,
  createQuestionReport: REPORT_BODY_CAP,
  triageAdminQuestionReport: SMALL_BODY_CAP,
  resolveAdminQuestionReport: SMALL_BODY_CAP,
  reauthenticateAdmin: 4 * 1024
}

type RateGroup =
  | 'ADMIN_EDIT'
  | 'ADMIN_SENSITIVE'
  | 'IMPORT_VALIDATION'
  | 'REAUTHENTICATION'

const groupByOperation: Readonly<Partial<Record<Phase7Operation, RateGroup>>> =
  {
    createAdminQuestion: 'ADMIN_EDIT',
    createAdminQuestionVersion: 'ADMIN_EDIT',
    updateQuestionVersion: 'ADMIN_EDIT',
    requestContentReview: 'ADMIN_EDIT',
    requestQuestionChanges: 'ADMIN_EDIT',
    approveQuestionVersion: 'ADMIN_SENSITIVE',
    withdrawQuestionApproval: 'ADMIN_SENSITIVE',
    publishQuestionVersion: 'ADMIN_SENSITIVE',
    retireQuestionVersion: 'ADMIN_SENSITIVE',
    archiveAdminQuestion: 'ADMIN_SENSITIVE',
    requestContentReviewBatch: 'ADMIN_SENSITIVE',
    validateQuestionImport: 'IMPORT_VALIDATION',
    applyQuestionImport: 'ADMIN_SENSITIVE',
    exportAdminQuestions: 'ADMIN_SENSITIVE',
    triageAdminQuestionReport: 'ADMIN_EDIT',
    resolveAdminQuestionReport: 'ADMIN_SENSITIVE',
    reauthenticateAdmin: 'REAUTHENTICATION'
  }

const freshOperations = new Set<Phase7Operation>([
  'approveQuestionVersion',
  'withdrawQuestionApproval',
  'publishQuestionVersion',
  'retireQuestionVersion',
  'archiveAdminQuestion',
  'requestContentReviewBatch',
  'applyQuestionImport',
  'exportAdminQuestions',
  'resolveAdminQuestionReport'
])

export const resetAdminCmsCommandRateLimitForTesting = (): void => {
  phase7RateLimitRepository.resetForTesting()
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
  let user: ReturnType<typeof mockDatabase.getCurrentUser>
  try {
    user = mockDatabase.getCurrentUser()
  } catch {
    throw new MockPhase7AdminCommandError({
      code: 'SERVICE_UNAVAILABLE',
      message: '최신 인증 세션을 확인하지 못했습니다.',
      disposition: 'NO_TX'
    })
  }
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

const requireReporter = (): { actorId: string; role: 'USER' | 'ADMIN' } => {
  let user: ReturnType<typeof mockDatabase.getCurrentUser>
  try {
    user = mockDatabase.getCurrentUser()
  } catch {
    throw new MockPhase7AdminCommandError({
      code: 'SERVICE_UNAVAILABLE',
      message: '최신 인증 세션을 확인하지 못했습니다.',
      disposition: 'NO_TX'
    })
  }
  if (!user) {
    throw new MockPhase7AdminCommandError({
      code: 'AUTHENTICATION_REQUIRED',
      message: '문제를 신고하려면 로그인이 필요합니다.'
    })
  }
  if (user.role !== 'USER' && user.role !== 'ADMIN') {
    throw new MockPhase7AdminCommandError({
      code: 'FORBIDDEN',
      message: '문제 신고 권한이 없습니다.'
    })
  }
  return { actorId: user.id, role: user.role }
}

const assertFreshAssurance = (
  operation: Phase7Operation,
  actorId: string
): void => {
  if (!freshOperations.has(operation)) return
  let hasFreshAssurance: boolean
  try {
    hasFreshAssurance =
      mockDatabase.hasAuthoritativePhase7FreshAssurance(actorId)
  } catch {
    throw new MockPhase7AdminCommandError({
      code: 'SERVICE_UNAVAILABLE',
      message: '최신 인증 보증 상태를 확인하지 못했습니다.',
      disposition: 'NO_TX'
    })
  }
  if (!hasFreshAssurance) {
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
  throw new MockPhase7AdminCommandError({
    code: 'UNTRUSTED_ORIGIN',
    message: '신뢰할 수 있는 요청 출처가 필요합니다.'
  })
}

const consumeSharedRate = async (
  input: Phase7RateLimitInput
): Promise<void> => {
  let retryAfterSeconds: number | null
  try {
    ;({ retryAfterSeconds } = await phase7RateLimitRepository.consume(input))
  } catch (error: unknown) {
    if (error instanceof Phase7RateLimitRepositoryUnavailableError) {
      throw new MockPhase7AdminCommandError({
        code: 'SERVICE_UNAVAILABLE',
        message: '요청 제한 상태를 확인할 수 없습니다.',
        disposition: 'NO_TX',
        retryAfterSeconds: error.retryAfterSeconds
      })
    }
    throw error
  }
  if (retryAfterSeconds !== null) {
    throw new MockPhase7AdminCommandError({
      code: 'RATE_LIMITED',
      message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
      retryAfterSeconds
    })
  }
}

const consumeRate = async (
  operation: Phase7Operation,
  actorId: string
): Promise<void> => {
  const group = groupByOperation[operation]
  if (!group) {
    throw new MockPhase7AdminCommandError({
      code: 'INTERNAL_SERVER_ERROR',
      message: '관리자 명령 정책을 확인할 수 없습니다.'
    })
  }
  await consumeSharedRate({ actorId, group })
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

const assertOperationResult = async <Result>(
  assertion: () => Result | Promise<Result>,
  disposition: 'NO_TX' | 'COMMIT_CONFIRMED'
): Promise<Result> => {
  try {
    return await assertion()
  } catch {
    throw new MockPhase7AdminCommandError({
      code: 'INTERNAL_SERVER_ERROR',
      message: '관리자 명령 응답 무결성을 확인할 수 없습니다.',
      disposition
    })
  }
}

const handleCommand = async <
  Schema extends ZodType,
  Result,
  Response extends JsonBodyType
>(input: {
  assertResult: (
    body: z.output<Schema>,
    raw: Result
  ) => Response | Promise<Response>
  assertionDisposition?: 'NO_TX' | 'COMMIT_CONFIRMED'
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
    await consumeRate(input.operation, actorId)
    assertEmptyQuery(input.request)
    const body = await parseBody(
      input.request,
      input.operation,
      input.schema,
      input.message
    )
    const raw = await input.execute({ actorId, body, requestId })
    const response = await assertOperationResult(
      () => input.assertResult(body, raw),
      input.assertionDisposition ?? 'COMMIT_CONFIRMED'
    )
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

const sources = () => mockDatabase.listPhase7AuthoritativeAdminQuestionSources()
const state = () => mockDatabase.getPhase7AdminCmsStateForHandlers()
const commitAuthority = (actorId: string, operation: Phase7Operation) => () =>
  mockDatabase.assertPhase7AdminCommandAuthority({
    actorId,
    requiresFresh: freshOperations.has(operation)
  })

const handleExportAdminQuestions = async (
  request: Request
): Promise<HttpResponse<JsonBodyType | string>> => {
  const operation = 'exportAdminQuestions' as const
  const requestId = getRequestId(request)
  try {
    assertDeclaredBodyBound(request, bodyCap(operation))
    const actorId = requireAdmin()
    assertFreshAssurance(operation, actorId)
    assertJsonTransport(request)
    assertTrustedOrigin(request)
    await consumeRate(operation, actorId)
    assertEmptyQuery(request)
    const body = await parseBody(
      request,
      operation,
      exportAdminQuestionsRequestSchema,
      '관리자 문제 내보내기 요청이 올바르지 않습니다.'
    )
    const raw = await state().exportAdminQuestions({
      actorId,
      assertAuthority: commitAuthority(actorId, operation),
      request: body,
      requestId,
      sources: sources()
    })
    await assertOperationResult(
      () =>
        assertAdminQuestionExportDocumentForRequest(
          phase7Sha256TextPort,
          body,
          raw.document,
          {
            canonicalResponseBody: raw.canonicalBody,
            auditEvidence: raw.auditEvidence
          }
        ),
      'COMMIT_CONFIRMED'
    )
    const headers = responseHeaders(requestId, request)
    headers.set('Content-Type', adminQuestionExportContentType)
    headers.set('Content-Disposition', adminQuestionExportContentDisposition)
    return new HttpResponse(raw.canonicalBody, { status: 200, headers })
  } catch (error: unknown) {
    return toFailureResponse(operation, request, requestId, error)
  }
}

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
    const entitledQuestionId =
      mockDatabase.resolvePhase7QuestionReportEntitlement(
        reporter.actorId,
        body.questionVersionId,
        'NO_TX'
      )
    if (!entitledQuestionId) {
      throw new MockPhase7AdminCommandError({
        code: 'RESOURCE_NOT_FOUND',
        message: '신고할 수 있는 문제 버전을 찾을 수 없습니다.'
      })
    }
    await consumeQuestionReportRate('REPORT_VERSION', body.questionVersionId)
    const raw = await state().createQuestionReport({
      actorId: reporter.actorId,
      actorRole: reporter.role,
      assertAuthority: () => {
        mockDatabase.assertPhase7QuestionReportAuthority(reporter.actorId)
      },
      resolveEntitledQuestionId: (disposition) =>
        mockDatabase.resolvePhase7QuestionReportEntitlement(
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
  http.post(
    '*/api/v1/admin/question-versions/:versionId/approval',
    ({ params, request }) => {
      if (!hasCanonicalCommandPath(request)) return genericNotFound(request)
      const parsedParams = parseParams(approveQuestionVersionParamsSchema, {
        versionId: String(params.versionId ?? '')
      })
      return handleCommand({
        operation: 'approveQuestionVersion',
        request,
        schema: approveQuestionVersionRequestSchema,
        message: '문제 버전 승인 요청이 올바르지 않습니다.',
        execute: ({ actorId, body, requestId }) =>
          state().transitionVersion({
            actorId,
            assertAuthority: commitAuthority(actorId, 'approveQuestionVersion'),
            operation: 'approveQuestionVersion',
            versionId: parsedParams.versionId,
            request: body,
            requestId,
            sources: sources()
          }),
        assertResult: (body, raw) =>
          assertApproveQuestionVersionResponse(parsedParams, body, raw)
      })
    }
  ),
  http.post(
    '*/api/v1/admin/question-versions/:versionId/approval-withdrawal',
    ({ params, request }) => {
      if (!hasCanonicalCommandPath(request)) return genericNotFound(request)
      const parsedParams = parseParams(withdrawQuestionApprovalParamsSchema, {
        versionId: String(params.versionId ?? '')
      })
      return handleCommand({
        operation: 'withdrawQuestionApproval',
        request,
        schema: withdrawQuestionApprovalRequestSchema,
        message: '문제 버전 승인 철회 요청이 올바르지 않습니다.',
        execute: ({ actorId, body, requestId }) =>
          state().transitionVersion({
            actorId,
            assertAuthority: commitAuthority(
              actorId,
              'withdrawQuestionApproval'
            ),
            operation: 'withdrawQuestionApproval',
            versionId: parsedParams.versionId,
            request: body,
            requestId,
            sources: sources()
          }),
        assertResult: (body, raw) =>
          assertWithdrawQuestionApprovalResponse(parsedParams, body, raw)
      })
    }
  ),
  http.post(
    '*/api/v1/admin/question-versions/:versionId/publication',
    ({ params, request }) => {
      if (!hasCanonicalCommandPath(request)) return genericNotFound(request)
      const parsedParams = parseParams(publishQuestionVersionParamsSchema, {
        versionId: String(params.versionId ?? '')
      })
      return handleCommand({
        operation: 'publishQuestionVersion',
        request,
        schema: publishQuestionVersionRequestSchema,
        message: '문제 버전 게시 요청이 올바르지 않습니다.',
        execute: ({ actorId, body, requestId }) =>
          state().publishQuestionVersion({
            actorId,
            assertAuthority: commitAuthority(actorId, 'publishQuestionVersion'),
            request: body,
            requestId,
            sources: sources(),
            versionId: parsedParams.versionId
          }),
        assertResult: (body, raw) =>
          assertPublishQuestionVersionResponse(parsedParams, body, raw)
      })
    }
  ),
  http.post(
    '*/api/v1/admin/question-versions/:versionId/retirement',
    ({ params, request }) => {
      if (!hasCanonicalCommandPath(request)) return genericNotFound(request)
      const parsedParams = parseParams(retireQuestionVersionParamsSchema, {
        versionId: String(params.versionId ?? '')
      })
      return handleCommand({
        operation: 'retireQuestionVersion',
        request,
        schema: retireQuestionVersionRequestSchema,
        message: '문제 버전 퇴역 요청이 올바르지 않습니다.',
        execute: ({ actorId, body, requestId }) =>
          state().retireQuestionVersion({
            actorId,
            assertAuthority: commitAuthority(actorId, 'retireQuestionVersion'),
            request: body,
            requestId,
            sources: sources(),
            versionId: parsedParams.versionId
          }),
        assertResult: (body, raw) =>
          assertRetireQuestionVersionResponse(parsedParams, body, raw)
      })
    }
  ),
  http.post(
    '*/api/v1/admin/questions/:questionId/archive',
    ({ params, request }) => {
      if (!hasCanonicalCommandPath(request)) return genericNotFound(request)
      const parsedParams = parseParams(archiveAdminQuestionParamsSchema, {
        questionId: String(params.questionId ?? '')
      })
      return handleCommand({
        operation: 'archiveAdminQuestion',
        request,
        schema: archiveAdminQuestionRequestSchema,
        message: '관리자 문제 보관 요청이 올바르지 않습니다.',
        execute: ({ actorId, body, requestId }) =>
          state().archiveAdminQuestion({
            actorId,
            assertAuthority: commitAuthority(actorId, 'archiveAdminQuestion'),
            questionId: parsedParams.questionId,
            request: body,
            requestId,
            sources: sources()
          }),
        assertResult: (body, raw) =>
          assertArchiveAdminQuestionResponse(parsedParams, body, raw)
      })
    }
  ),
  http.post(
    '*/api/v1/admin/question-versions/review-request-batch',
    ({ request }) =>
      hasCanonicalCommandPath(request)
        ? handleCommand({
            operation: 'requestContentReviewBatch',
            request,
            schema: requestContentReviewBatchRequestSchema,
            message: '일괄 콘텐츠 검수 요청이 올바르지 않습니다.',
            execute: ({ actorId, body, requestId }) =>
              state().requestContentReviewBatch({
                actorId,
                assertAuthority: commitAuthority(
                  actorId,
                  'requestContentReviewBatch'
                ),
                request: body,
                requestId,
                sources: sources()
              }),
            assertResult: (body, raw) =>
              assertRequestContentReviewBatchResponse(body, raw)
          })
        : genericNotFound(request)
  ),
  http.post('*/api/v1/admin/questions/import-validation', ({ request }) =>
    hasCanonicalCommandPath(request)
      ? handleCommand({
          operation: 'validateQuestionImport',
          request,
          schema: validateQuestionImportRequestSchema,
          message: '문제 import 검증 요청이 올바르지 않습니다.',
          assertionDisposition: 'NO_TX',
          execute: ({ body }) =>
            state().validateQuestionImport({
              request: body,
              sources: sources()
            }),
          assertResult: (body, raw) =>
            assertAdminImportValidationForRequest(
              phase7Sha256TextPort,
              body,
              raw
            )
        })
      : genericNotFound(request)
  ),
  http.post('*/api/v1/admin/questions/import-application', ({ request }) =>
    hasCanonicalCommandPath(request)
      ? handleCommand({
          operation: 'applyQuestionImport',
          request,
          schema: applyQuestionImportRequestSchema,
          message: '문제 import 적용 요청이 올바르지 않습니다.',
          status: 201,
          execute: ({ actorId, body, requestId }) =>
            state().applyQuestionImport({
              actorId,
              assertAuthority: commitAuthority(actorId, 'applyQuestionImport'),
              request: body,
              requestId,
              sources: sources()
            }),
          assertResult: async (body, raw) =>
            (
              await assertAdminImportApplyForRequest(
                phase7Sha256TextPort,
                body,
                raw
              )
            ).response
        })
      : genericNotFound(request)
  ),
  http.post('*/api/v1/admin/questions/export', ({ request }) =>
    hasCanonicalCommandPath(request)
      ? handleExportAdminQuestions(request)
      : genericNotFound(request)
  ),
  http.post('*/api/v1/question-reports', ({ request }) =>
    hasCanonicalCommandPath(request)
      ? handleCreateQuestionReport(request)
      : genericNotFound(request)
  ),
  http.post(
    '*/api/v1/admin/question-reports/:reportId/triage',
    ({ params, request }) => {
      if (!hasCanonicalCommandPath(request)) return genericNotFound(request)
      const parsedParams = parseParams(triageAdminQuestionReportParamsSchema, {
        reportId: String(params.reportId ?? '')
      })
      return handleCommand({
        operation: 'triageAdminQuestionReport',
        request,
        schema: triageAdminQuestionReportRequestSchema,
        message: '문제 신고 triage 요청이 올바르지 않습니다.',
        execute: ({ actorId, body, requestId }) =>
          state().triageQuestionReport({
            actorId,
            assertAuthority: commitAuthority(
              actorId,
              'triageAdminQuestionReport'
            ),
            reportId: parsedParams.reportId,
            request: body,
            requestId
          }),
        assertResult: (body, raw) =>
          assertTriageAdminQuestionReportResponse(parsedParams, body, raw)
      })
    }
  ),
  http.post(
    '*/api/v1/admin/question-reports/:reportId/resolution',
    ({ params, request }) => {
      if (!hasCanonicalCommandPath(request)) return genericNotFound(request)
      const parsedParams = parseParams(resolveAdminQuestionReportParamsSchema, {
        reportId: String(params.reportId ?? '')
      })
      return handleCommand({
        operation: 'resolveAdminQuestionReport',
        request,
        schema: resolveAdminQuestionReportRequestSchema,
        message: '문제 신고 종결 요청이 올바르지 않습니다.',
        execute: ({ actorId, body, requestId }) =>
          state().resolveQuestionReport({
            actorId,
            assertAuthority: commitAuthority(
              actorId,
              'resolveAdminQuestionReport'
            ),
            reportId: parsedParams.reportId,
            request: body,
            requestId
          }),
        assertResult: (body, raw) => {
          const response = assertResolveAdminQuestionReportResponse(
            parsedParams,
            body,
            raw
          )
          if (response.rowVersion !== body.expectedRowVersion + 1) {
            throw new Error(
              'report resolution rowVersion이 request와 다릅니다.'
            )
          }
          return response
        }
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
            const assertAuthority = commitAuthority(
              actorId,
              'reauthenticateAdmin'
            )
            assertAuthority()
            if (!isMockAdminPasswordForActor(actorId, body.password)) {
              throw new MockPhase7AdminCommandError({
                code: 'REAUTHENTICATION_FAILED',
                message: '비밀번호를 확인할 수 없습니다.'
              })
            }
            return state().reauthenticate({
              actorId,
              assertAuthority,
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
