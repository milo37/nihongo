import { z, type ZodType } from 'zod'

import {
  createApiFailureSchema,
  errorStatusByCode,
  stableErrorCodeSchema,
  type StableErrorCode
} from '../common/error.js'
import {
  phase7OperationManifest,
  type Phase7Operation
} from './phase7-manifest.js'

export const phase7ExecutionDispositionSchema = z.enum([
  'NO_TX',
  'DEFINITE_ROLLBACK',
  'COMMIT_CONFIRMED',
  'COMMIT_UNKNOWN'
])

export type Phase7ExecutionDisposition = z.output<
  typeof phase7ExecutionDispositionSchema
>

export const phase7InternalFailureReasonSchema = z.enum([
  'CONTENT_DUPLICATE_CONCURRENT_RACE'
])

export type Phase7InternalFailureReason = z.output<
  typeof phase7InternalFailureReasonSchema
>

export const phase7ErrorSurfaceSchema = z.enum([
  'GET_READ',
  'VALIDATION_WRITE_ZERO',
  'APPLY_IMPORT',
  'KEYLESS_MUTATION',
  'EXPORT',
  'REAUTHENTICATION'
])

export type Phase7ErrorSurface = z.output<typeof phase7ErrorSurfaceSchema>

export const phase7ErrorSurfaceByOperation = {
  listAdminQuestions: 'GET_READ',
  createAdminQuestion: 'KEYLESS_MUTATION',
  getAdminQuestion: 'GET_READ',
  listAdminTags: 'GET_READ',
  createAdminQuestionVersion: 'KEYLESS_MUTATION',
  archiveAdminQuestion: 'KEYLESS_MUTATION',
  previewQuestionVersion: 'GET_READ',
  diffQuestionVersion: 'GET_READ',
  listAdminQuestionVersions: 'GET_READ',
  listQuestionVersionReviews: 'GET_READ',
  updateQuestionVersion: 'KEYLESS_MUTATION',
  requestContentReview: 'KEYLESS_MUTATION',
  requestQuestionChanges: 'KEYLESS_MUTATION',
  approveQuestionVersion: 'KEYLESS_MUTATION',
  withdrawQuestionApproval: 'KEYLESS_MUTATION',
  publishQuestionVersion: 'KEYLESS_MUTATION',
  retireQuestionVersion: 'KEYLESS_MUTATION',
  requestContentReviewBatch: 'KEYLESS_MUTATION',
  validateQuestionImport: 'VALIDATION_WRITE_ZERO',
  applyQuestionImport: 'APPLY_IMPORT',
  exportAdminQuestions: 'EXPORT',
  listAdminAuditLog: 'GET_READ',
  reauthenticateAdmin: 'REAUTHENTICATION',
  createQuestionReport: 'KEYLESS_MUTATION',
  listAdminQuestionReports: 'GET_READ',
  getAdminQuestionReport: 'GET_READ',
  triageAdminQuestionReport: 'KEYLESS_MUTATION',
  resolveAdminQuestionReport: 'KEYLESS_MUTATION'
} as const satisfies Readonly<Record<Phase7Operation, Phase7ErrorSurface>>

const duplicateRaceOperations = new Set<Phase7Operation>([
  'createAdminQuestion',
  'createAdminQuestionVersion',
  'updateQuestionVersion',
  'publishQuestionVersion',
  'applyQuestionImport'
])

export interface Phase7RetryabilityInput {
  readonly operation: Phase7Operation
  readonly code: StableErrorCode
  readonly disposition: Phase7ExecutionDisposition
  readonly internalReason?: Phase7InternalFailureReason | undefined
}

const isPreCommitDisposition = (
  disposition: Phase7ExecutionDisposition
): boolean => disposition === 'NO_TX' || disposition === 'DEFINITE_ROLLBACK'

export const computePhase7Retryability = ({
  code,
  disposition,
  internalReason,
  operation
}: Phase7RetryabilityInput): boolean => {
  const status = errorStatusByCode[code]

  if (internalReason !== undefined) {
    if (
      internalReason !== 'CONTENT_DUPLICATE_CONCURRENT_RACE' ||
      code !== 'SERVICE_UNAVAILABLE' ||
      disposition !== 'DEFINITE_ROLLBACK' ||
      !duplicateRaceOperations.has(operation)
    ) {
      throw new Error(
        'CONTENT_DUPLICATE_CONCURRENT_RACE는 지정된 operation의 rollback 503에만 사용할 수 있습니다.'
      )
    }
    return false
  }

  if (status >= 400 && status < 500) {
    if (code !== 'RATE_LIMITED') {
      return false
    }
    if (disposition !== 'NO_TX') {
      throw new Error('Phase 7 RATE_LIMITED는 transaction 전 NO_TX여야 합니다.')
    }
    return true
  }

  if (code !== 'INTERNAL_SERVER_ERROR' && code !== 'SERVICE_UNAVAILABLE') {
    throw new Error(
      'Phase 7 failure status를 retry policy로 분류할 수 없습니다.'
    )
  }

  const surface = phase7ErrorSurfaceByOperation[operation]
  if (surface === 'GET_READ' || surface === 'VALIDATION_WRITE_ZERO') {
    if (!isPreCommitDisposition(disposition)) {
      throw new Error(
        'read/write-zero operation에는 commit disposition을 사용할 수 없습니다.'
      )
    }
    return true
  }
  if (surface === 'REAUTHENTICATION') {
    return false
  }
  return isPreCommitDisposition(disposition)
}

const getWireRetryabilityExpectation = (
  operation: Phase7Operation,
  code: StableErrorCode
): boolean | null => {
  const status = errorStatusByCode[code]
  if (status >= 400 && status < 500) {
    return code === 'RATE_LIMITED'
  }
  const surface = phase7ErrorSurfaceByOperation[operation]
  if (surface === 'GET_READ' || surface === 'VALIDATION_WRITE_ZERO') {
    return true
  }
  if (surface === 'REAUTHENTICATION') {
    return false
  }
  return null
}

export const createPhase7OperationErrorSchema = <
  CodeSchema extends ZodType<string>
>(
  operation: Phase7Operation,
  codeSchema: CodeSchema
) =>
  createApiFailureSchema(codeSchema).superRefine((failure, context) => {
    const candidate = failure as {
      readonly code: unknown
      readonly retryable: boolean
    }
    const code = stableErrorCodeSchema.safeParse(candidate.code)
    if (!code.success) {
      context.addIssue({
        code: 'custom',
        path: ['code'],
        message: 'Phase 7 stable error code가 아닙니다.'
      })
      return
    }

    const expected = getWireRetryabilityExpectation(operation, code.data)
    if (expected !== null && candidate.retryable !== expected) {
      context.addIssue({
        code: 'custom',
        path: ['retryable'],
        message: `이 operation/code의 retryable은 ${String(expected)}여야 합니다.`
      })
    }
  })

export const assertPhase7ErrorPolicyManifest = (): void => {
  const manifestOperations = phase7OperationManifest.map(
    (entry) => entry.operation
  )
  const policyOperations = Object.keys(phase7ErrorSurfaceByOperation)
  if (JSON.stringify(manifestOperations) !== JSON.stringify(policyOperations)) {
    throw new Error(
      'Phase 7 error policy operation 순서는 canonical 28-operation manifest와 같아야 합니다.'
    )
  }

  const counts = Object.values(phase7ErrorSurfaceByOperation).reduce<
    Record<Phase7ErrorSurface, number>
  >(
    (result, surface) => ({
      ...result,
      [surface]: result[surface] + 1
    }),
    {
      GET_READ: 0,
      VALIDATION_WRITE_ZERO: 0,
      APPLY_IMPORT: 0,
      KEYLESS_MUTATION: 0,
      EXPORT: 0,
      REAUTHENTICATION: 0
    }
  )
  if (
    counts.GET_READ !== 10 ||
    counts.VALIDATION_WRITE_ZERO !== 1 ||
    counts.APPLY_IMPORT !== 1 ||
    counts.KEYLESS_MUTATION !== 14 ||
    counts.EXPORT !== 1 ||
    counts.REAUTHENTICATION !== 1
  ) {
    throw new Error(
      'Phase 7 error surface 분류 수가 canonical matrix와 다릅니다.'
    )
  }
}
