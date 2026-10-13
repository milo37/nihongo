import axios, { type AxiosRequestConfig } from 'axios'
import {
  assertAdminAuditContentDigest,
  assertAdminImportApplyForRequest,
  assertAdminImportValidationForRequest,
  assertApproveQuestionVersionResponse,
  assertArchiveAdminQuestionResponse,
  assertCreateAdminQuestionResponse,
  assertCreateAdminQuestionVersionResponse,
  assertCreateQuestionReportForRequest,
  assertDiffQuestionVersionForRequest,
  assertGetAdminQuestionForRequest,
  assertGetAdminQuestionReportForRequest,
  assertListAdminAuditLogForRequest,
  assertListAdminQuestionReportsForRequest,
  assertListAdminQuestionsForRequest,
  assertListAdminQuestionVersionsForRequest,
  assertListAdminTagsForRequest,
  assertListQuestionVersionReviewsForRequest,
  assertPreviewQuestionVersionForRequest,
  assertPublishQuestionVersionResponse,
  assertQuestionReportDescriptionDigest,
  assertReauthenticateAdminResponse,
  assertRequestContentReviewBatchResponse,
  assertRequestContentReviewResponse,
  assertRequestQuestionChangesResponse,
  assertResolveAdminQuestionReportResponse,
  assertRetireQuestionVersionResponse,
  assertTriageAdminQuestionReportResponse,
  assertUpdateQuestionVersionResponse,
  assertWithdrawQuestionApprovalResponse,
  phase7OperationManifest,
  phase7OperationSchemas,
  type Phase7Operation
} from '@nihongo/contracts/admin/phase7'
import type { z } from 'zod'
import { errorStatusByCode } from '@nihongo/contracts/common/error'
import { requestIdSchema } from '@nihongo/contracts/common/id'
import {
  apiClient,
  createResponseValidationError,
  parseApiResponse,
  withErrorFlags
} from '@api/config'
import {
  AuthTransitionSupersededError,
  assertCurrentAuthTransitionEpoch,
  captureAuthTransitionEpoch
} from '@libs/authTransitionFence'
import { phase7Sha256TextPort } from '@libs/phase7Sha256'

type OperationSchemas<Operation extends Phase7Operation> =
  (typeof phase7OperationSchemas)[Operation]

export type Phase7OperationParams<Operation extends Phase7Operation> = z.input<
  OperationSchemas<Operation>['params']
>

export type Phase7OperationQuery<Operation extends Phase7Operation> = z.input<
  OperationSchemas<Operation>['query']
>

export type Phase7OperationBody<Operation extends Phase7Operation> = z.input<
  OperationSchemas<Operation>['body']
>

export type Phase7OperationResult<Operation extends Phase7Operation> = z.output<
  OperationSchemas<Operation>['success']
>

export interface Phase7OperationRequest<Operation extends Phase7Operation> {
  readonly operation: Operation
  readonly params: Phase7OperationParams<Operation>
  readonly query: Phase7OperationQuery<Operation>
  readonly body: Phase7OperationBody<Operation>
  readonly config?: AxiosRequestConfig
}

const manifestByOperation = new Map(
  phase7OperationManifest.map((entry) => [entry.operation, entry])
)

const RETRY_AFTER_SECONDS = /^[1-9][0-9]*$/u

const readHeader = (headers: unknown, name: string): string | null => {
  if (!headers || typeof headers !== 'object') return null
  if ('get' in headers && typeof headers.get === 'function') {
    const value: unknown = headers.get(name)
    return typeof value === 'string' ? value : null
  }
  const record = headers as Readonly<Record<string, unknown>>
  const value = record[name] ?? record[name.toLowerCase()]
  return typeof value === 'string' ? value : null
}

const assertSuccessTransport = (
  status: number,
  headers: unknown,
  expectedStatus: number
): void => {
  const requestId = readHeader(headers, 'x-request-id')
  if (
    status !== expectedStatus ||
    readHeader(headers, 'cache-control') !== 'private, no-store' ||
    !requestIdSchema.safeParse(requestId).success ||
    readHeader(headers, 'retry-after') !== null
  ) {
    throw new Error('Phase 7 success transport metadata is not canonical.')
  }
}

const assertFailureTransport = (input: {
  readonly code: keyof typeof errorStatusByCode
  readonly requestId: string
  readonly status: number
  readonly headers: unknown
}): void => {
  const retryAfter = readHeader(input.headers, 'retry-after')
  if (
    input.status !== errorStatusByCode[input.code] ||
    readHeader(input.headers, 'cache-control') !== 'private, no-store' ||
    readHeader(input.headers, 'x-request-id') !== input.requestId ||
    (input.code === 'RATE_LIMITED' && retryAfter === null) ||
    (retryAfter !== null &&
      input.code !== 'RATE_LIMITED' &&
      input.code !== 'SERVICE_UNAVAILABLE') ||
    (retryAfter !== null && !RETRY_AFTER_SECONDS.test(retryAfter))
  ) {
    throw new Error('Phase 7 failure transport metadata is not canonical.')
  }
}

const toClientPath = (manifestPath: string, params: unknown): string => {
  const values = params as Readonly<Record<string, unknown>>
  const interpolated = manifestPath.replace(
    /:([A-Za-z][A-Za-z0-9]*)/gu,
    (_match, key: string) => {
      const value = values[key]
      if (typeof value !== 'string') {
        throw new Error(`Phase 7 path parameter ${key} is unavailable.`)
      }
      return encodeURIComponent(value)
    }
  )

  return interpolated.startsWith('/api/')
    ? interpolated.slice('/api'.length)
    : interpolated
}

const assertCorrelatedResponse = async (
  operation: Phase7Operation,
  params: unknown,
  query: unknown,
  body: unknown,
  response: unknown
): Promise<unknown> => {
  switch (operation) {
    case 'listAdminQuestions':
      return assertListAdminQuestionsForRequest(query, response)
    case 'createAdminQuestion':
      return assertCreateAdminQuestionResponse(body, response)
    case 'getAdminQuestion':
      return assertGetAdminQuestionForRequest(params, query, response)
    case 'listAdminTags':
      return assertListAdminTagsForRequest(query, response)
    case 'createAdminQuestionVersion':
      return assertCreateAdminQuestionVersionResponse(params, body, response)
    case 'archiveAdminQuestion':
      return assertArchiveAdminQuestionResponse(params, body, response)
    case 'previewQuestionVersion':
      return assertPreviewQuestionVersionForRequest(params, query, response)
    case 'diffQuestionVersion':
      return assertDiffQuestionVersionForRequest(params, query, response)
    case 'listAdminQuestionVersions':
      return assertListAdminQuestionVersionsForRequest(params, query, response)
    case 'listQuestionVersionReviews':
      return assertListQuestionVersionReviewsForRequest(params, query, response)
    case 'updateQuestionVersion':
      return assertUpdateQuestionVersionResponse(params, body, response)
    case 'requestContentReview':
      return assertRequestContentReviewResponse(params, body, response)
    case 'requestQuestionChanges':
      return assertRequestQuestionChangesResponse(params, body, response)
    case 'approveQuestionVersion':
      return assertApproveQuestionVersionResponse(params, body, response)
    case 'withdrawQuestionApproval':
      return assertWithdrawQuestionApprovalResponse(params, body, response)
    case 'publishQuestionVersion':
      return assertPublishQuestionVersionResponse(params, body, response)
    case 'retireQuestionVersion':
      return assertRetireQuestionVersionResponse(params, body, response)
    case 'requestContentReviewBatch':
      return assertRequestContentReviewBatchResponse(body, response)
    case 'validateQuestionImport':
      return assertAdminImportValidationForRequest(
        phase7Sha256TextPort,
        body,
        response
      )
    case 'applyQuestionImport':
      return (
        await assertAdminImportApplyForRequest(
          phase7Sha256TextPort,
          body,
          response
        )
      ).response
    case 'exportAdminQuestions':
      return response
    case 'listAdminAuditLog': {
      const asserted = assertListAdminAuditLogForRequest(query, response)
      await Promise.all(
        asserted.items.map((item) =>
          assertAdminAuditContentDigest(phase7Sha256TextPort, item)
        )
      )
      return asserted
    }
    case 'reauthenticateAdmin':
      return assertReauthenticateAdminResponse(body, response)
    case 'createQuestionReport':
      return assertCreateQuestionReportForRequest(body, response)
    case 'listAdminQuestionReports':
      return assertListAdminQuestionReportsForRequest(query, response)
    case 'getAdminQuestionReport': {
      const asserted = assertGetAdminQuestionReportForRequest(params, response)
      await assertQuestionReportDescriptionDigest(
        phase7Sha256TextPort,
        asserted
      )
      return asserted
    }
    case 'triageAdminQuestionReport':
      return assertTriageAdminQuestionReportResponse(params, body, response)
    case 'resolveAdminQuestionReport':
      return assertResolveAdminQuestionReportResponse(params, body, response)
  }
}

export const requestPhase7Operation = async <
  Operation extends Exclude<Phase7Operation, 'exportAdminQuestions'>
>(
  input: Phase7OperationRequest<Operation>
): Promise<Phase7OperationResult<Operation>> => {
  const entry = manifestByOperation.get(input.operation)
  if (!entry) {
    throw new Error(`Unknown Phase 7 operation: ${input.operation}`)
  }
  const schemas = phase7OperationSchemas[input.operation]
  const params = schemas.params.parse(input.params)
  const query = schemas.query.parse(input.query)
  const body = schemas.body.parse(input.body)
  const requestEpoch = captureAuthTransitionEpoch()

  try {
    const response = await apiClient.request<unknown>({
      ...input.config,
      url: toClientPath(entry.path, params),
      method: entry.method,
      params: query,
      ...(entry.method === 'GET' ? {} : { data: body })
    })
    assertCurrentAuthTransitionEpoch(requestEpoch)
    try {
      assertSuccessTransport(
        response.status,
        response.headers,
        entry.successStatus
      )
      const parsed = parseApiResponse(schemas.success, response.data)
      const correlated = (await assertCorrelatedResponse(
        input.operation,
        params,
        query,
        body,
        parsed
      )) as Phase7OperationResult<Operation>
      assertCurrentAuthTransitionEpoch(requestEpoch)
      return correlated
    } catch (error: unknown) {
      if (error instanceof AuthTransitionSupersededError) throw error
      throw createResponseValidationError(error, response.status)
    }
  } catch (error: unknown) {
    assertCurrentAuthTransitionEpoch(requestEpoch)
    if (axios.isAxiosError(error) && error.response) {
      const parsedFailure = schemas.error.safeParse(error.response.data)
      if (!parsedFailure.success) {
        throw createResponseValidationError(
          parsedFailure.error,
          error.response.status
        )
      }
      try {
        assertFailureTransport({
          code: parsedFailure.data.code,
          requestId: parsedFailure.data.requestId,
          status: error.response.status,
          headers: error.response.headers
        })
      } catch (transportError: unknown) {
        throw createResponseValidationError(
          transportError,
          error.response.status
        )
      }
      throw withErrorFlags(error, {
        code: parsedFailure.data.code,
        fieldErrors: parsedFailure.data.fieldErrors,
        isServerValidationError: error.response.status === 422,
        isValidationError: error.response.status === 422,
        requestId: parsedFailure.data.requestId,
        retryable: parsedFailure.data.retryable,
        serverMessage: parsedFailure.data.message,
        status: error.response.status
      })
    }
    throw error
  }
}
