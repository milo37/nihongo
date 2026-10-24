import {
  assertPhase7ErrorPolicyManifest,
  phase7ErrorSurfaceByOperation,
  type Phase7ErrorSurface,
  type Phase7ExecutionDisposition
} from '../admin/phase7-error-policy.js'
import {
  assertPhase7OperationSchemaManifest,
  phase7OperationSchemaManifest
} from '../admin/phase7-operation-schemas.js'
import {
  assertPhase7OperationManifest,
  phase7OperationManifest,
  phase7Slice2ReadOperationManifest,
  type Phase7Operation,
  type Phase7OperationManifestEntry
} from '../admin/phase7-manifest.js'

export const phase7Slice2ExpectedOperations = [
  'listAdminQuestions',
  'getAdminQuestion',
  'listAdminTags',
  'previewQuestionVersion',
  'diffQuestionVersion',
  'listAdminQuestionVersions',
  'listQuestionVersionReviews',
  'listAdminAuditLog'
] as const

export const phase7Slice2ExpectedRoutes = [
  'GET /api/v1/admin/questions',
  'GET /api/v1/admin/questions/:questionId',
  'GET /api/v1/admin/tags',
  'GET /api/v1/admin/question-versions/:versionId/preview',
  'GET /api/v1/admin/question-versions/:versionId/diff',
  'GET /api/v1/admin/questions/:questionId/versions',
  'GET /api/v1/admin/question-versions/:versionId/reviews',
  'GET /api/v1/admin/audit-log'
] as const

export interface Phase7Slice2ReadConformanceEntry
  extends Phase7OperationManifestEntry {
  readonly cacheControl: 'private, no-store'
  readonly requestIdHeader: 'X-Request-Id'
  readonly rateLimitGroup: 'ADMIN_READ'
}

export const phase7Slice2ReadConformanceManifest: readonly Phase7Slice2ReadConformanceEntry[] =
  phase7Slice2ReadOperationManifest.map((entry) => ({
    ...entry,
    cacheControl: 'private, no-store',
    requestIdHeader: 'X-Request-Id',
    rateLimitGroup: 'ADMIN_READ'
  }))

export const phase7DeferredOperationManifest = phase7OperationManifest.filter(
  (entry) => !entry.slice2Route
)

type Phase7TransientRetryabilityByDisposition = Readonly<
  Record<Phase7ExecutionDisposition, boolean | null>
>

const retryableBeforeCommit: Phase7TransientRetryabilityByDisposition = {
  NO_TX: true,
  DEFINITE_ROLLBACK: true,
  COMMIT_CONFIRMED: false,
  COMMIT_UNKNOWN: false
}

const retryableWriteZero: Phase7TransientRetryabilityByDisposition = {
  NO_TX: true,
  DEFINITE_ROLLBACK: true,
  COMMIT_CONFIRMED: null,
  COMMIT_UNKNOWN: null
}

const neverRetryableTransient: Phase7TransientRetryabilityByDisposition = {
  NO_TX: false,
  DEFINITE_ROLLBACK: false,
  COMMIT_CONFIRMED: false,
  COMMIT_UNKNOWN: false
}

const duplicateRaceOperations = new Set([
  'createAdminQuestion',
  'createAdminQuestionVersion',
  'updateQuestionVersion',
  'publishQuestionVersion',
  'applyQuestionImport'
])

const transientRetryabilityBySurface: Readonly<
  Record<Phase7ErrorSurface, Phase7TransientRetryabilityByDisposition>
> = {
  GET_READ: retryableWriteZero,
  VALIDATION_WRITE_ZERO: retryableWriteZero,
  APPLY_IMPORT: retryableBeforeCommit,
  KEYLESS_MUTATION: retryableBeforeCommit,
  EXPORT: retryableBeforeCommit,
  REAUTHENTICATION: neverRetryableTransient
}

export interface Phase7OperationErrorConformanceEntry
  extends Phase7OperationManifestEntry {
  readonly operation: Phase7Operation
  readonly errorSurface: Phase7ErrorSurface
  readonly deterministic4xxRetryable: false
  readonly rateLimitedRetryable: true
  readonly rateLimitedRetryAfterRequired: true
  readonly transientRetryabilityByDisposition: Phase7TransientRetryabilityByDisposition
  readonly duplicateRaceRetryable: false | null
}

export const phase7OperationErrorConformanceManifest: readonly Phase7OperationErrorConformanceEntry[] =
  phase7OperationManifest.map((entry) => {
    const errorSurface = phase7ErrorSurfaceByOperation[entry.operation]
    return {
      ...entry,
      errorSurface,
      deterministic4xxRetryable: false,
      rateLimitedRetryable: true,
      rateLimitedRetryAfterRequired: true,
      transientRetryabilityByDisposition:
        transientRetryabilityBySurface[errorSurface],
      duplicateRaceRetryable: duplicateRaceOperations.has(entry.operation)
        ? false
        : null
    }
  })

export const assertPhase7Slice2ConformanceManifest = (): void => {
  assertPhase7OperationManifest()
  assertPhase7OperationSchemaManifest()
  assertPhase7ErrorPolicyManifest()
  const operations = phase7Slice2ReadConformanceManifest.map(
    (entry) => entry.operation
  )
  const routes = phase7Slice2ReadConformanceManifest.map(
    (entry) => `${entry.method} ${entry.path}`
  )
  if (
    JSON.stringify(operations) !==
    JSON.stringify(phase7Slice2ExpectedOperations)
  ) {
    throw new Error(
      'Slice 2 operation order/set이 canonical expectation과 다릅니다.'
    )
  }
  if (JSON.stringify(routes) !== JSON.stringify(phase7Slice2ExpectedRoutes)) {
    throw new Error(
      'Slice 2 route order/set이 canonical expectation과 다릅니다.'
    )
  }
  if (phase7DeferredOperationManifest.length !== 20) {
    throw new Error('Slice 2에서 deferred operation은 정확히 20개여야 합니다.')
  }
  if (phase7OperationSchemaManifest.length !== 28) {
    throw new Error(
      'Phase 7 schema conformance는 28 operations를 모두 덮어야 합니다.'
    )
  }
  if (
    phase7OperationErrorConformanceManifest.length !== 28 ||
    phase7OperationErrorConformanceManifest.some(
      (entry) =>
        entry.errorSurface !== phase7ErrorSurfaceByOperation[entry.operation] ||
        entry.deterministic4xxRetryable !== false ||
        entry.rateLimitedRetryable !== true ||
        entry.rateLimitedRetryAfterRequired !== true
    )
  ) {
    throw new Error('Phase 7 all-operation error conformance가 닫혀야 합니다.')
  }
  if (
    phase7Slice2ReadConformanceManifest.some(
      (entry) =>
        entry.cacheControl !== 'private, no-store' ||
        entry.requestIdHeader !== 'X-Request-Id' ||
        entry.rateLimitGroup !== 'ADMIN_READ'
    )
  ) {
    throw new Error(
      'Slice 2 read response/rate conformance가 닫혀 있어야 합니다.'
    )
  }
}

export type Phase7Slice2ExpectedOperation =
  (typeof phase7Slice2ExpectedOperations)[number]
