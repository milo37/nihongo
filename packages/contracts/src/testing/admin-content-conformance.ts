import {
  assertErrorPolicyManifest,
  contentErrorSurfaceByOperation,
  type ErrorSurface,
  type AdminExecutionDisposition
} from '../admin/content-error-policy.js'
import {
  assertOperationSchemaManifest,
  operationSchemaManifest
} from '../admin/content-operation-schemas.js'
import {
  assertOperationManifest,
  operationManifest,
  slice2ReadOperationManifest,
  type AdminOperation,
  type OperationManifestEntry
} from '../admin/content-manifest.js'

export const slice2ExpectedOperations = [
  'listAdminQuestions',
  'getAdminQuestion',
  'listAdminTags',
  'previewQuestionVersion',
  'diffQuestionVersion',
  'listAdminQuestionVersions',
  'listQuestionVersionReviews',
  'listAdminAuditLog'
] as const

const slice2ExpectedRoutes = [
  'GET /api/v1/admin/questions',
  'GET /api/v1/admin/questions/:questionId',
  'GET /api/v1/admin/tags',
  'GET /api/v1/admin/question-versions/:versionId/preview',
  'GET /api/v1/admin/question-versions/:versionId/diff',
  'GET /api/v1/admin/questions/:questionId/versions',
  'GET /api/v1/admin/question-versions/:versionId/reviews',
  'GET /api/v1/admin/audit-log'
] as const

interface Slice2ReadConformanceEntry extends OperationManifestEntry {
  readonly cacheControl: 'private, no-store'
  readonly requestIdHeader: 'X-Request-Id'
  readonly rateLimitGroup: 'ADMIN_READ'
}

export const slice2ReadConformanceManifest: readonly Slice2ReadConformanceEntry[] =
  slice2ReadOperationManifest.map((entry) => ({
    ...entry,
    cacheControl: 'private, no-store',
    requestIdHeader: 'X-Request-Id',
    rateLimitGroup: 'ADMIN_READ'
  }))

export const deferredOperationManifest = operationManifest.filter(
  (entry) => !entry.slice2Route
)

type TransientRetryabilityByDisposition = Readonly<
  Record<AdminExecutionDisposition, boolean | null>
>

const retryableBeforeCommit: TransientRetryabilityByDisposition = {
  NO_TX: true,
  DEFINITE_ROLLBACK: true,
  COMMIT_CONFIRMED: false,
  COMMIT_UNKNOWN: false
}

const retryableWriteZero: TransientRetryabilityByDisposition = {
  NO_TX: true,
  DEFINITE_ROLLBACK: true,
  COMMIT_CONFIRMED: null,
  COMMIT_UNKNOWN: null
}

const neverRetryableTransient: TransientRetryabilityByDisposition = {
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
  Record<ErrorSurface, TransientRetryabilityByDisposition>
> = {
  GET_READ: retryableWriteZero,
  VALIDATION_WRITE_ZERO: retryableWriteZero,
  APPLY_IMPORT: retryableBeforeCommit,
  KEYLESS_MUTATION: retryableBeforeCommit,
  EXPORT: retryableBeforeCommit,
  REAUTHENTICATION: neverRetryableTransient
}

interface OperationErrorConformanceEntry extends OperationManifestEntry {
  readonly operation: AdminOperation
  readonly errorSurface: ErrorSurface
  readonly deterministic4xxRetryable: false
  readonly rateLimitedRetryable: true
  readonly rateLimitedRetryAfterRequired: true
  readonly transientRetryabilityByDisposition: TransientRetryabilityByDisposition
  readonly duplicateRaceRetryable: false | null
}

export const operationErrorConformanceManifest: readonly OperationErrorConformanceEntry[] =
  operationManifest.map((entry) => {
    const errorSurface = contentErrorSurfaceByOperation[entry.operation]
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

export const assertSlice2ConformanceManifest = (): void => {
  assertOperationManifest()
  assertOperationSchemaManifest()
  assertErrorPolicyManifest()
  const operations = slice2ReadConformanceManifest.map(
    (entry) => entry.operation
  )
  const routes = slice2ReadConformanceManifest.map(
    (entry) => `${entry.method} ${entry.path}`
  )
  if (JSON.stringify(operations) !== JSON.stringify(slice2ExpectedOperations)) {
    throw new Error(
      'Slice 2 operation order/set이 canonical expectation과 다릅니다.'
    )
  }
  if (JSON.stringify(routes) !== JSON.stringify(slice2ExpectedRoutes)) {
    throw new Error(
      'Slice 2 route order/set이 canonical expectation과 다릅니다.'
    )
  }
  if (deferredOperationManifest.length !== 23) {
    throw new Error('Slice 2에서 deferred operation은 정확히 23개여야 합니다.')
  }
  if (operationSchemaManifest.length !== 31) {
    throw new Error('Schema conformance는 31 operations를 모두 덮어야 합니다.')
  }
  if (
    operationErrorConformanceManifest.length !== 31 ||
    operationErrorConformanceManifest.some(
      (entry) =>
        entry.errorSurface !==
          contentErrorSurfaceByOperation[entry.operation] ||
        entry.deterministic4xxRetryable !== false ||
        entry.rateLimitedRetryable !== true ||
        entry.rateLimitedRetryAfterRequired !== true
    )
  ) {
    throw new Error('All-operation error conformance가 닫혀야 합니다.')
  }
  if (
    slice2ReadConformanceManifest.some(
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
