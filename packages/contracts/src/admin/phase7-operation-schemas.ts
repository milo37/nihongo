import { z } from 'zod'

import {
  apiFailureSchema,
  errorStatusByCode,
  stableErrorCodeSchema,
  type ApiFailure,
  type StableErrorCode
} from '../common/error.js'
import {
  applyQuestionImportErrorSchema,
  applyQuestionImportRequestSchema,
  adminImportApplyResponseSchema,
  adminImportValidationResponseSchema,
  createQuestionReportErrorSchema,
  createQuestionReportRequestSchema,
  createQuestionReportResponseSchema,
  getAdminQuestionReportErrorSchema,
  getAdminQuestionReportParamsSchema,
  getAdminQuestionReportResponseSchema,
  listAdminQuestionReportsErrorSchema,
  listAdminQuestionReportsQuerySchema,
  listAdminQuestionReportsResponseSchema,
  resolveAdminQuestionReportErrorSchema,
  resolveAdminQuestionReportParamsSchema,
  resolveAdminQuestionReportRequestSchema,
  resolveAdminQuestionReportResponseSchema,
  triageAdminQuestionReportErrorSchema,
  triageAdminQuestionReportParamsSchema,
  triageAdminQuestionReportRequestSchema,
  triageAdminQuestionReportResponseSchema,
  validateQuestionImportErrorSchema,
  validateQuestionImportRequestSchema
} from './phase7-future.js'
import {
  approveQuestionVersionErrorSchema,
  approveQuestionVersionParamsSchema,
  approveQuestionVersionRequestSchema,
  approveQuestionVersionResponseSchema,
  archiveAdminQuestionErrorSchema,
  archiveAdminQuestionParamsSchema,
  archiveAdminQuestionRequestSchema,
  archiveAdminQuestionResponseSchema,
  createAdminQuestionErrorSchema,
  createAdminQuestionRequestSchema,
  createAdminQuestionResponseSchema,
  createAdminQuestionVersionErrorSchema,
  createAdminQuestionVersionParamsSchema,
  createAdminQuestionVersionRequestSchema,
  createAdminQuestionVersionResponseSchema,
  exportAdminQuestionsErrorSchema,
  exportAdminQuestionsRequestSchema,
  exportAdminQuestionsResponseSchema,
  publishQuestionVersionErrorSchema,
  publishQuestionVersionParamsSchema,
  publishQuestionVersionRequestSchema,
  publishQuestionVersionResponseSchema,
  reauthenticateAdminErrorSchema,
  reauthenticateAdminRequestSchema,
  reauthenticateAdminResponseSchema,
  requestContentReviewBatchErrorSchema,
  requestContentReviewBatchRequestSchema,
  requestContentReviewBatchResponseSchema,
  requestContentReviewErrorSchema,
  requestContentReviewParamsSchema,
  requestContentReviewRequestSchema,
  requestContentReviewResponseSchema,
  requestQuestionChangesErrorSchema,
  requestQuestionChangesParamsSchema,
  requestQuestionChangesRequestSchema,
  requestQuestionChangesResponseSchema,
  retireQuestionVersionErrorSchema,
  retireQuestionVersionParamsSchema,
  retireQuestionVersionRequestSchema,
  retireQuestionVersionResponseSchema,
  updateQuestionVersionErrorSchema,
  updateQuestionVersionParamsSchema,
  updateQuestionVersionRequestSchema,
  updateQuestionVersionResponseSchema,
  withdrawQuestionApprovalErrorSchema,
  withdrawQuestionApprovalParamsSchema,
  withdrawQuestionApprovalRequestSchema,
  withdrawQuestionApprovalResponseSchema
} from './phase7-commands.js'
import {
  diffQuestionVersionErrorSchema,
  diffQuestionVersionParamsSchema,
  diffQuestionVersionQuerySchema,
  diffQuestionVersionResponseSchema,
  getAdminQuestionErrorSchema,
  getAdminQuestionParamsSchema,
  getAdminQuestionQuerySchema,
  getAdminQuestionResponseSchema,
  listAdminAuditLogErrorSchema,
  listAdminAuditLogQuerySchema,
  listAdminAuditLogResponseSchema,
  listAdminQuestionsErrorSchema,
  listAdminQuestionsQuerySchema,
  listAdminQuestionsResponseSchema,
  listAdminQuestionVersionsErrorSchema,
  listAdminQuestionVersionsParamsSchema,
  listAdminQuestionVersionsQuerySchema,
  listAdminQuestionVersionsResponseSchema,
  listAdminTagsErrorSchema,
  listAdminTagsQuerySchema,
  listAdminTagsResponseSchema,
  listQuestionVersionReviewsErrorSchema,
  listQuestionVersionReviewsParamsSchema,
  listQuestionVersionReviewsQuerySchema,
  listQuestionVersionReviewsResponseSchema,
  previewQuestionVersionErrorSchema,
  previewQuestionVersionParamsSchema,
  previewQuestionVersionQuerySchema,
  previewQuestionVersionResponseSchema
} from './phase7-read.js'
import {
  computePhase7Retryability,
  type Phase7ExecutionDisposition,
  type Phase7InternalFailureReason
} from './phase7-error-policy.js'
import {
  phase7OperationManifest,
  type Phase7Operation,
  type Phase7OperationManifestEntry
} from './phase7-manifest.js'

export const phase7EmptyParamsSchema = z.object({}).strict()
export const phase7EmptyQuerySchema = z.object({}).strict()
export const phase7NoRequestBodySchema = z.undefined()

export interface Phase7OperationSchemaDescriptor {
  readonly params: z.ZodType
  readonly query: z.ZodType
  readonly body: z.ZodType
  readonly success: z.ZodType
  readonly error: z.ZodType
}

export interface Phase7OperationSchemaManifestEntry
  extends Phase7OperationManifestEntry {
  readonly operation: Phase7Operation
  readonly schemas: Phase7OperationSchemaDescriptor
}

const noParams = phase7EmptyParamsSchema
const noQuery = phase7EmptyQuerySchema
const noBody = phase7NoRequestBodySchema

export const phase7OperationSchemas = {
  listAdminQuestions: {
    params: noParams,
    query: listAdminQuestionsQuerySchema,
    body: noBody,
    success: listAdminQuestionsResponseSchema,
    error: listAdminQuestionsErrorSchema
  },
  createAdminQuestion: {
    params: noParams,
    query: noQuery,
    body: createAdminQuestionRequestSchema,
    success: createAdminQuestionResponseSchema,
    error: createAdminQuestionErrorSchema
  },
  getAdminQuestion: {
    params: getAdminQuestionParamsSchema,
    query: getAdminQuestionQuerySchema,
    body: noBody,
    success: getAdminQuestionResponseSchema,
    error: getAdminQuestionErrorSchema
  },
  listAdminTags: {
    params: noParams,
    query: listAdminTagsQuerySchema,
    body: noBody,
    success: listAdminTagsResponseSchema,
    error: listAdminTagsErrorSchema
  },
  createAdminQuestionVersion: {
    params: createAdminQuestionVersionParamsSchema,
    query: noQuery,
    body: createAdminQuestionVersionRequestSchema,
    success: createAdminQuestionVersionResponseSchema,
    error: createAdminQuestionVersionErrorSchema
  },
  archiveAdminQuestion: {
    params: archiveAdminQuestionParamsSchema,
    query: noQuery,
    body: archiveAdminQuestionRequestSchema,
    success: archiveAdminQuestionResponseSchema,
    error: archiveAdminQuestionErrorSchema
  },
  previewQuestionVersion: {
    params: previewQuestionVersionParamsSchema,
    query: previewQuestionVersionQuerySchema,
    body: noBody,
    success: previewQuestionVersionResponseSchema,
    error: previewQuestionVersionErrorSchema
  },
  diffQuestionVersion: {
    params: diffQuestionVersionParamsSchema,
    query: diffQuestionVersionQuerySchema,
    body: noBody,
    success: diffQuestionVersionResponseSchema,
    error: diffQuestionVersionErrorSchema
  },
  listAdminQuestionVersions: {
    params: listAdminQuestionVersionsParamsSchema,
    query: listAdminQuestionVersionsQuerySchema,
    body: noBody,
    success: listAdminQuestionVersionsResponseSchema,
    error: listAdminQuestionVersionsErrorSchema
  },
  listQuestionVersionReviews: {
    params: listQuestionVersionReviewsParamsSchema,
    query: listQuestionVersionReviewsQuerySchema,
    body: noBody,
    success: listQuestionVersionReviewsResponseSchema,
    error: listQuestionVersionReviewsErrorSchema
  },
  updateQuestionVersion: {
    params: updateQuestionVersionParamsSchema,
    query: noQuery,
    body: updateQuestionVersionRequestSchema,
    success: updateQuestionVersionResponseSchema,
    error: updateQuestionVersionErrorSchema
  },
  requestContentReview: {
    params: requestContentReviewParamsSchema,
    query: noQuery,
    body: requestContentReviewRequestSchema,
    success: requestContentReviewResponseSchema,
    error: requestContentReviewErrorSchema
  },
  requestQuestionChanges: {
    params: requestQuestionChangesParamsSchema,
    query: noQuery,
    body: requestQuestionChangesRequestSchema,
    success: requestQuestionChangesResponseSchema,
    error: requestQuestionChangesErrorSchema
  },
  approveQuestionVersion: {
    params: approveQuestionVersionParamsSchema,
    query: noQuery,
    body: approveQuestionVersionRequestSchema,
    success: approveQuestionVersionResponseSchema,
    error: approveQuestionVersionErrorSchema
  },
  withdrawQuestionApproval: {
    params: withdrawQuestionApprovalParamsSchema,
    query: noQuery,
    body: withdrawQuestionApprovalRequestSchema,
    success: withdrawQuestionApprovalResponseSchema,
    error: withdrawQuestionApprovalErrorSchema
  },
  publishQuestionVersion: {
    params: publishQuestionVersionParamsSchema,
    query: noQuery,
    body: publishQuestionVersionRequestSchema,
    success: publishQuestionVersionResponseSchema,
    error: publishQuestionVersionErrorSchema
  },
  retireQuestionVersion: {
    params: retireQuestionVersionParamsSchema,
    query: noQuery,
    body: retireQuestionVersionRequestSchema,
    success: retireQuestionVersionResponseSchema,
    error: retireQuestionVersionErrorSchema
  },
  requestContentReviewBatch: {
    params: noParams,
    query: noQuery,
    body: requestContentReviewBatchRequestSchema,
    success: requestContentReviewBatchResponseSchema,
    error: requestContentReviewBatchErrorSchema
  },
  validateQuestionImport: {
    params: noParams,
    query: noQuery,
    body: validateQuestionImportRequestSchema,
    success: adminImportValidationResponseSchema,
    error: validateQuestionImportErrorSchema
  },
  applyQuestionImport: {
    params: noParams,
    query: noQuery,
    body: applyQuestionImportRequestSchema,
    success: adminImportApplyResponseSchema,
    error: applyQuestionImportErrorSchema
  },
  exportAdminQuestions: {
    params: noParams,
    query: noQuery,
    body: exportAdminQuestionsRequestSchema,
    success: exportAdminQuestionsResponseSchema,
    error: exportAdminQuestionsErrorSchema
  },
  listAdminAuditLog: {
    params: noParams,
    query: listAdminAuditLogQuerySchema,
    body: noBody,
    success: listAdminAuditLogResponseSchema,
    error: listAdminAuditLogErrorSchema
  },
  reauthenticateAdmin: {
    params: noParams,
    query: noQuery,
    body: reauthenticateAdminRequestSchema,
    success: reauthenticateAdminResponseSchema,
    error: reauthenticateAdminErrorSchema
  },
  createQuestionReport: {
    params: noParams,
    query: noQuery,
    body: createQuestionReportRequestSchema,
    success: createQuestionReportResponseSchema,
    error: createQuestionReportErrorSchema
  },
  listAdminQuestionReports: {
    params: noParams,
    query: listAdminQuestionReportsQuerySchema,
    body: noBody,
    success: listAdminQuestionReportsResponseSchema,
    error: listAdminQuestionReportsErrorSchema
  },
  getAdminQuestionReport: {
    params: getAdminQuestionReportParamsSchema,
    query: noQuery,
    body: noBody,
    success: getAdminQuestionReportResponseSchema,
    error: getAdminQuestionReportErrorSchema
  },
  triageAdminQuestionReport: {
    params: triageAdminQuestionReportParamsSchema,
    query: noQuery,
    body: triageAdminQuestionReportRequestSchema,
    success: triageAdminQuestionReportResponseSchema,
    error: triageAdminQuestionReportErrorSchema
  },
  resolveAdminQuestionReport: {
    params: resolveAdminQuestionReportParamsSchema,
    query: noQuery,
    body: resolveAdminQuestionReportRequestSchema,
    success: resolveAdminQuestionReportResponseSchema,
    error: resolveAdminQuestionReportErrorSchema
  }
} as const satisfies {
  readonly [Operation in Phase7Operation]: Phase7OperationSchemaDescriptor
}

export const phase7OperationSchemaManifest: readonly Phase7OperationSchemaManifestEntry[] =
  phase7OperationManifest.map((entry) => ({
    ...entry,
    schemas: phase7OperationSchemas[entry.operation]
  }))

export interface Phase7OperationFailureDetails {
  readonly code: StableErrorCode
  readonly message: string
  readonly fieldErrors?: ApiFailure['fieldErrors']
  readonly requestId: string
}

export interface BuildPhase7OperationFailureResponseInput {
  readonly operation: Phase7Operation
  readonly failure: Phase7OperationFailureDetails
  readonly disposition: Phase7ExecutionDisposition
  readonly internalReason?: Phase7InternalFailureReason | undefined
  readonly retryAfterSeconds?: number | undefined
}

export interface Phase7OperationFailureResponse {
  readonly status: (typeof errorStatusByCode)[StableErrorCode]
  readonly body: ApiFailure
  readonly headers: Readonly<Record<string, string>>
}

const parseRetryAfterSeconds = (value: number): number =>
  z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).parse(value)

const RETRY_AFTER_SECONDS_PATTERN = /^[1-9][0-9]*$/u

export const buildPhase7OperationFailureResponse = ({
  disposition,
  failure,
  internalReason,
  operation,
  retryAfterSeconds
}: BuildPhase7OperationFailureResponseInput): Phase7OperationFailureResponse => {
  const code = stableErrorCodeSchema.parse(failure.code)
  const status = errorStatusByCode[code]
  if (status === 429 && retryAfterSeconds === undefined) {
    throw new Error('Phase 7 429 response에는 Retry-After가 필요합니다.')
  }
  if (retryAfterSeconds !== undefined && status !== 429 && status !== 503) {
    throw new Error(
      'Retry-After는 Phase 7 429/503 response에만 사용할 수 있습니다.'
    )
  }
  const parsedRetryAfter =
    retryAfterSeconds === undefined
      ? undefined
      : parseRetryAfterSeconds(retryAfterSeconds)
  const retryable = computePhase7Retryability({
    code,
    disposition,
    ...(internalReason === undefined ? {} : { internalReason }),
    operation
  })
  const body = apiFailureSchema.parse(
    phase7OperationSchemas[operation].error.parse({
      ...failure,
      retryable
    })
  )
  return {
    status,
    body,
    headers: {
      'Cache-Control': 'private, no-store',
      'X-Request-Id': body.requestId,
      ...(parsedRetryAfter === undefined
        ? {}
        : { 'Retry-After': String(parsedRetryAfter) })
    }
  }
}

export interface AssertPhase7OperationFailureResponseInput {
  readonly operation: Phase7Operation
  readonly response: Phase7OperationFailureResponse
  readonly disposition: Phase7ExecutionDisposition
  readonly internalReason?: Phase7InternalFailureReason | undefined
}

export const assertPhase7OperationFailureResponse = ({
  disposition,
  internalReason,
  operation,
  response
}: AssertPhase7OperationFailureResponseInput): Phase7OperationFailureResponse => {
  const body = apiFailureSchema.parse(
    phase7OperationSchemas[operation].error.parse(response.body)
  )
  const expectedStatus = errorStatusByCode[body.code]
  if (response.status !== expectedStatus) {
    throw new Error('Phase 7 error status가 stable code mapping과 다릅니다.')
  }
  const expectedRetryable = computePhase7Retryability({
    code: body.code,
    disposition,
    ...(internalReason === undefined ? {} : { internalReason }),
    operation
  })
  if (body.retryable !== expectedRetryable) {
    throw new Error('Phase 7 retryable이 execution disposition과 다릅니다.')
  }
  if (
    response.headers['Cache-Control'] !== 'private, no-store' ||
    response.headers['X-Request-Id'] !== body.requestId
  ) {
    throw new Error(
      'Phase 7 failure response의 no-store/request ID가 다릅니다.'
    )
  }

  const retryAfter = response.headers['Retry-After']
  if (body.code === 'RATE_LIMITED' && retryAfter === undefined) {
    throw new Error('Phase 7 429 response에는 Retry-After가 필요합니다.')
  }
  if (
    retryAfter !== undefined &&
    expectedStatus !== 429 &&
    expectedStatus !== 503
  ) {
    throw new Error(
      'Retry-After는 Phase 7 429/503 response에만 사용할 수 있습니다.'
    )
  }
  if (retryAfter !== undefined) {
    if (!RETRY_AFTER_SECONDS_PATTERN.test(retryAfter)) {
      throw new Error('Retry-After는 canonical positive integer여야 합니다.')
    }
    parseRetryAfterSeconds(Number(retryAfter))
  }
  return response
}

export const assertPhase7OperationSchemaManifest = (): void => {
  const manifestOperations = phase7OperationManifest.map(
    (entry) => entry.operation
  )
  const schemaOperations = Object.keys(phase7OperationSchemas)
  if (JSON.stringify(manifestOperations) !== JSON.stringify(schemaOperations)) {
    throw new Error(
      'Phase 7 operation schema manifest는 canonical 28-operation 순서와 같아야 합니다.'
    )
  }
  if (
    phase7OperationSchemaManifest.length !== 28 ||
    phase7OperationSchemaManifest.some(
      (entry) => entry.schemas !== phase7OperationSchemas[entry.operation]
    )
  ) {
    throw new Error(
      'Phase 7 operation schema binding이 canonical하지 않습니다.'
    )
  }
}
