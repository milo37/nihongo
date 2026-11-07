type HttpMethod = 'GET' | 'PATCH' | 'POST'
type ResponseBodyKind = 'JSON' | 'ATTACHMENT'

export interface OperationManifestEntry {
  readonly operation: string
  readonly operationId: string
  readonly method: HttpMethod
  readonly path: string
  readonly successStatus: 200 | 201
  readonly responseBodyKind: ResponseBodyKind
  readonly requiresFreshAssurance: boolean
  readonly slice2Route: boolean
}

export const operationManifest = [
  {
    operation: 'listAdminQuestions',
    operationId: 'admin.listAdminQuestions',
    method: 'GET',
    path: '/api/v1/admin/questions',
    successStatus: 200,
    responseBodyKind: 'JSON',
    requiresFreshAssurance: false,
    slice2Route: true
  },
  {
    operation: 'createAdminQuestion',
    operationId: 'admin.createAdminQuestion',
    method: 'POST',
    path: '/api/v1/admin/questions',
    successStatus: 201,
    responseBodyKind: 'JSON',
    requiresFreshAssurance: false,
    slice2Route: false
  },
  {
    operation: 'getAdminQuestion',
    operationId: 'admin.getAdminQuestion',
    method: 'GET',
    path: '/api/v1/admin/questions/:questionId',
    successStatus: 200,
    responseBodyKind: 'JSON',
    requiresFreshAssurance: false,
    slice2Route: true
  },
  {
    operation: 'listAdminTags',
    operationId: 'admin.listAdminTags',
    method: 'GET',
    path: '/api/v1/admin/tags',
    successStatus: 200,
    responseBodyKind: 'JSON',
    requiresFreshAssurance: false,
    slice2Route: true
  },
  {
    operation: 'createAdminQuestionVersion',
    operationId: 'admin.createAdminQuestionVersion',
    method: 'POST',
    path: '/api/v1/admin/questions/:questionId/versions',
    successStatus: 201,
    responseBodyKind: 'JSON',
    requiresFreshAssurance: false,
    slice2Route: false
  },
  {
    operation: 'archiveAdminQuestion',
    operationId: 'admin.archiveAdminQuestion',
    method: 'POST',
    path: '/api/v1/admin/questions/:questionId/archive',
    successStatus: 200,
    responseBodyKind: 'JSON',
    requiresFreshAssurance: true,
    slice2Route: false
  },
  {
    operation: 'previewQuestionVersion',
    operationId: 'admin.previewQuestionVersion',
    method: 'GET',
    path: '/api/v1/admin/question-versions/:versionId/preview',
    successStatus: 200,
    responseBodyKind: 'JSON',
    requiresFreshAssurance: false,
    slice2Route: true
  },
  {
    operation: 'diffQuestionVersion',
    operationId: 'admin.diffQuestionVersion',
    method: 'GET',
    path: '/api/v1/admin/question-versions/:versionId/diff',
    successStatus: 200,
    responseBodyKind: 'JSON',
    requiresFreshAssurance: false,
    slice2Route: true
  },
  {
    operation: 'listAdminQuestionVersions',
    operationId: 'admin.listAdminQuestionVersions',
    method: 'GET',
    path: '/api/v1/admin/questions/:questionId/versions',
    successStatus: 200,
    responseBodyKind: 'JSON',
    requiresFreshAssurance: false,
    slice2Route: true
  },
  {
    operation: 'listQuestionVersionReviews',
    operationId: 'admin.listQuestionVersionReviews',
    method: 'GET',
    path: '/api/v1/admin/question-versions/:versionId/reviews',
    successStatus: 200,
    responseBodyKind: 'JSON',
    requiresFreshAssurance: false,
    slice2Route: true
  },
  {
    operation: 'updateQuestionVersion',
    operationId: 'admin.updateQuestionVersion',
    method: 'PATCH',
    path: '/api/v1/admin/question-versions/:versionId',
    successStatus: 200,
    responseBodyKind: 'JSON',
    requiresFreshAssurance: false,
    slice2Route: false
  },
  {
    operation: 'requestContentReview',
    operationId: 'admin.requestContentReview',
    method: 'POST',
    path: '/api/v1/admin/question-versions/:versionId/review-request',
    successStatus: 200,
    responseBodyKind: 'JSON',
    requiresFreshAssurance: false,
    slice2Route: false
  },
  {
    operation: 'requestQuestionChanges',
    operationId: 'admin.requestQuestionChanges',
    method: 'POST',
    path: '/api/v1/admin/question-versions/:versionId/change-request',
    successStatus: 200,
    responseBodyKind: 'JSON',
    requiresFreshAssurance: false,
    slice2Route: false
  },
  {
    operation: 'approveQuestionVersion',
    operationId: 'admin.approveQuestionVersion',
    method: 'POST',
    path: '/api/v1/admin/question-versions/:versionId/approval',
    successStatus: 200,
    responseBodyKind: 'JSON',
    requiresFreshAssurance: true,
    slice2Route: false
  },
  {
    operation: 'withdrawQuestionApproval',
    operationId: 'admin.withdrawQuestionApproval',
    method: 'POST',
    path: '/api/v1/admin/question-versions/:versionId/approval-withdrawal',
    successStatus: 200,
    responseBodyKind: 'JSON',
    requiresFreshAssurance: true,
    slice2Route: false
  },
  {
    operation: 'publishQuestionVersion',
    operationId: 'admin.publishQuestionVersion',
    method: 'POST',
    path: '/api/v1/admin/question-versions/:versionId/publication',
    successStatus: 200,
    responseBodyKind: 'JSON',
    requiresFreshAssurance: true,
    slice2Route: false
  },
  {
    operation: 'retireQuestionVersion',
    operationId: 'admin.retireQuestionVersion',
    method: 'POST',
    path: '/api/v1/admin/question-versions/:versionId/retirement',
    successStatus: 200,
    responseBodyKind: 'JSON',
    requiresFreshAssurance: true,
    slice2Route: false
  },
  {
    operation: 'requestContentReviewBatch',
    operationId: 'admin.requestContentReviewBatch',
    method: 'POST',
    path: '/api/v1/admin/question-versions/review-request-batch',
    successStatus: 200,
    responseBodyKind: 'JSON',
    requiresFreshAssurance: true,
    slice2Route: false
  },
  {
    operation: 'publishQuestionVersionBatch',
    operationId: 'admin.publishQuestionVersionBatch',
    method: 'POST',
    path: '/api/v1/admin/question-versions/publication-batch',
    successStatus: 200,
    responseBodyKind: 'JSON',
    requiresFreshAssurance: true,
    slice2Route: false
  },
  {
    operation: 'approveQuestionVersionBatch',
    operationId: 'admin.approveQuestionVersionBatch',
    method: 'POST',
    path: '/api/v1/admin/question-versions/approval-batch',
    successStatus: 200,
    responseBodyKind: 'JSON',
    requiresFreshAssurance: true,
    slice2Route: false
  },
  {
    operation: 'validateQuestionImport',
    operationId: 'admin.validateQuestionImport',
    method: 'POST',
    path: '/api/v1/admin/questions/import-validation',
    successStatus: 200,
    responseBodyKind: 'JSON',
    requiresFreshAssurance: false,
    slice2Route: false
  },
  {
    operation: 'applyQuestionImport',
    operationId: 'admin.applyQuestionImport',
    method: 'POST',
    path: '/api/v1/admin/questions/import-application',
    successStatus: 201,
    responseBodyKind: 'JSON',
    requiresFreshAssurance: true,
    slice2Route: false
  },
  {
    operation: 'exportAdminQuestions',
    operationId: 'admin.exportAdminQuestions',
    method: 'POST',
    path: '/api/v1/admin/questions/export',
    successStatus: 200,
    responseBodyKind: 'ATTACHMENT',
    requiresFreshAssurance: true,
    slice2Route: false
  },
  {
    operation: 'listAdminAuditLog',
    operationId: 'admin.listAdminAuditLog',
    method: 'GET',
    path: '/api/v1/admin/audit-log',
    successStatus: 200,
    responseBodyKind: 'JSON',
    requiresFreshAssurance: false,
    slice2Route: true
  },
  {
    operation: 'reauthenticateAdmin',
    operationId: 'admin.reauthenticateAdmin',
    method: 'POST',
    path: '/api/v1/admin/reauthentication',
    successStatus: 200,
    responseBodyKind: 'JSON',
    requiresFreshAssurance: false,
    slice2Route: false
  },
  {
    operation: 'createQuestionReport',
    operationId: 'report.createQuestionReport',
    method: 'POST',
    path: '/api/v1/question-reports',
    successStatus: 201,
    responseBodyKind: 'JSON',
    requiresFreshAssurance: false,
    slice2Route: false
  },
  {
    operation: 'listAdminQuestionReports',
    operationId: 'admin.listAdminQuestionReports',
    method: 'GET',
    path: '/api/v1/admin/question-reports',
    successStatus: 200,
    responseBodyKind: 'JSON',
    requiresFreshAssurance: false,
    slice2Route: false
  },
  {
    operation: 'getAdminQuestionReport',
    operationId: 'admin.getAdminQuestionReport',
    method: 'GET',
    path: '/api/v1/admin/question-reports/:reportId',
    successStatus: 200,
    responseBodyKind: 'JSON',
    requiresFreshAssurance: false,
    slice2Route: false
  },
  {
    operation: 'triageAdminQuestionReport',
    operationId: 'admin.triageAdminQuestionReport',
    method: 'POST',
    path: '/api/v1/admin/question-reports/:reportId/triage',
    successStatus: 200,
    responseBodyKind: 'JSON',
    requiresFreshAssurance: false,
    slice2Route: false
  },
  {
    operation: 'resolveAdminQuestionReport',
    operationId: 'admin.resolveAdminQuestionReport',
    method: 'POST',
    path: '/api/v1/admin/question-reports/:reportId/resolution',
    successStatus: 200,
    responseBodyKind: 'JSON',
    requiresFreshAssurance: true,
    slice2Route: false
  }
] as const satisfies readonly OperationManifestEntry[]

export const slice2ReadOperationManifest = operationManifest.filter(
  (entry) => entry.slice2Route
)

const ADMIN_SLICE_3A_COMMAND_OPERATIONS = new Set<AdminOperation>([
  'createAdminQuestion',
  'createAdminQuestionVersion',
  'updateQuestionVersion',
  'requestContentReview',
  'requestQuestionChanges'
])

const ADMIN_SLICE_3R_REMEDIATION_OPERATIONS = new Set<AdminOperation>([
  'reauthenticateAdmin',
  'approveQuestionVersion',
  'withdrawQuestionApproval'
])

const ADMIN_SLICE_3R_A1_OPERATIONS = new Set<AdminOperation>([
  'reauthenticateAdmin'
])

const ADMIN_SLICE_3R_A2_OPERATIONS = new Set<AdminOperation>([
  'approveQuestionVersion',
  'withdrawQuestionApproval'
])

const ADMIN_SLICE_4_OPERATIONS = new Set<AdminOperation>([
  'archiveAdminQuestion',
  'publishQuestionVersion',
  'retireQuestionVersion'
])

const ADMIN_SLICE_5_OPERATIONS = new Set<AdminOperation>([
  'requestContentReviewBatch',
  'publishQuestionVersionBatch',
  'approveQuestionVersionBatch',
  'validateQuestionImport',
  'applyQuestionImport',
  'exportAdminQuestions',
  'createQuestionReport',
  'listAdminQuestionReports',
  'getAdminQuestionReport',
  'triageAdminQuestionReport',
  'resolveAdminQuestionReport'
])

export const slice4CacheInvalidationTargets = [
  'adminQuestions.allLists',
  'adminQuestions.detail',
  'adminQuestionVersions.history',
  'adminQuestionVersions.reviews',
  'adminAuditLog.allLists',
  'publicQuestions.allLists',
  'publicQuestions.detail',
  'practiceCandidates',
  'bookmarks.allLists',
  'bookmarks.detailAvailability',
  'wrongNotes.allLists',
  'wrongNotes.detail',
  'wrongNotes.reviewQueue',
  'dashboard'
] as const

const slice4CacheInvalidationContract = {
  timing: 'POST_COMMIT',
  dispatch: 'PARALLEL',
  settlement: 'AWAIT_ALL',
  failureAction: 'NONE',
  staleActorAction: 'NONE',
  targets: slice4CacheInvalidationTargets
} as const

export const slice4CacheInvalidationContractByOperation = {
  publishQuestionVersion: slice4CacheInvalidationContract,
  publishQuestionVersionBatch: slice4CacheInvalidationContract,
  retireQuestionVersion: slice4CacheInvalidationContract,
  archiveAdminQuestion: slice4CacheInvalidationContract
} as const satisfies Readonly<
  Record<
    | 'publishQuestionVersion'
    | 'publishQuestionVersionBatch'
    | 'retireQuestionVersion'
    | 'archiveAdminQuestion',
    typeof slice4CacheInvalidationContract
  >
>

export const slice3ACommandOperationManifest = operationManifest.filter(
  (entry) => ADMIN_SLICE_3A_COMMAND_OPERATIONS.has(entry.operation)
)

export const slice3RRemediationOperationManifest = operationManifest.filter(
  (entry) => ADMIN_SLICE_3R_REMEDIATION_OPERATIONS.has(entry.operation)
)

export const activeThroughSlice3AOperationManifest = operationManifest.filter(
  (entry) =>
    entry.slice2Route || ADMIN_SLICE_3A_COMMAND_OPERATIONS.has(entry.operation)
)

export const dormantAfterSlice3AOperationManifest = operationManifest.filter(
  (entry) =>
    !entry.slice2Route &&
    !ADMIN_SLICE_3A_COMMAND_OPERATIONS.has(entry.operation)
)

export const activeThroughSlice3RA1OperationManifest = operationManifest.filter(
  (entry) =>
    entry.slice2Route ||
    ADMIN_SLICE_3A_COMMAND_OPERATIONS.has(entry.operation) ||
    ADMIN_SLICE_3R_A1_OPERATIONS.has(entry.operation)
)

export const dormantAfterSlice3RA1OperationManifest = operationManifest.filter(
  (entry) =>
    !entry.slice2Route &&
    !ADMIN_SLICE_3A_COMMAND_OPERATIONS.has(entry.operation) &&
    !ADMIN_SLICE_3R_A1_OPERATIONS.has(entry.operation)
)

export const activeThroughSlice3RA2OperationManifest = operationManifest.filter(
  (entry) =>
    entry.slice2Route ||
    ADMIN_SLICE_3A_COMMAND_OPERATIONS.has(entry.operation) ||
    ADMIN_SLICE_3R_A1_OPERATIONS.has(entry.operation) ||
    ADMIN_SLICE_3R_A2_OPERATIONS.has(entry.operation)
)

export const dormantAfterSlice3RA2OperationManifest = operationManifest.filter(
  (entry) =>
    !entry.slice2Route &&
    !ADMIN_SLICE_3A_COMMAND_OPERATIONS.has(entry.operation) &&
    !ADMIN_SLICE_3R_A1_OPERATIONS.has(entry.operation) &&
    !ADMIN_SLICE_3R_A2_OPERATIONS.has(entry.operation)
)

export const slice4OperationManifest = operationManifest.filter((entry) =>
  ADMIN_SLICE_4_OPERATIONS.has(entry.operation)
)

export const activeThroughSlice4OperationManifest = operationManifest.filter(
  (entry) =>
    entry.slice2Route ||
    ADMIN_SLICE_3A_COMMAND_OPERATIONS.has(entry.operation) ||
    ADMIN_SLICE_3R_A1_OPERATIONS.has(entry.operation) ||
    ADMIN_SLICE_3R_A2_OPERATIONS.has(entry.operation) ||
    ADMIN_SLICE_4_OPERATIONS.has(entry.operation)
)

export const dormantAfterSlice4OperationManifest = operationManifest.filter(
  (entry) =>
    !entry.slice2Route &&
    !ADMIN_SLICE_3A_COMMAND_OPERATIONS.has(entry.operation) &&
    !ADMIN_SLICE_3R_A1_OPERATIONS.has(entry.operation) &&
    !ADMIN_SLICE_3R_A2_OPERATIONS.has(entry.operation) &&
    !ADMIN_SLICE_4_OPERATIONS.has(entry.operation)
)

export const slice5OperationManifest = operationManifest.filter((entry) =>
  ADMIN_SLICE_5_OPERATIONS.has(entry.operation)
)

export const activeThroughSlice5OperationManifest = operationManifest.filter(
  (entry) =>
    entry.slice2Route ||
    ADMIN_SLICE_3A_COMMAND_OPERATIONS.has(entry.operation) ||
    ADMIN_SLICE_3R_A1_OPERATIONS.has(entry.operation) ||
    ADMIN_SLICE_3R_A2_OPERATIONS.has(entry.operation) ||
    ADMIN_SLICE_4_OPERATIONS.has(entry.operation) ||
    ADMIN_SLICE_5_OPERATIONS.has(entry.operation)
)

export const dormantAfterSlice5OperationManifest = operationManifest.filter(
  (entry) =>
    !entry.slice2Route &&
    !ADMIN_SLICE_3A_COMMAND_OPERATIONS.has(entry.operation) &&
    !ADMIN_SLICE_3R_A1_OPERATIONS.has(entry.operation) &&
    !ADMIN_SLICE_3R_A2_OPERATIONS.has(entry.operation) &&
    !ADMIN_SLICE_4_OPERATIONS.has(entry.operation) &&
    !ADMIN_SLICE_5_OPERATIONS.has(entry.operation)
)

export const assertOperationManifest = (): void => {
  if (operationManifest.length !== 30) {
    throw new Error('operation manifest는 정확히 30개여야 합니다.')
  }
  if (slice2ReadOperationManifest.length !== 8) {
    throw new Error('Route manifest는 정확히 8개여야 합니다.')
  }
  if (
    slice3ACommandOperationManifest.length !== 5 ||
    slice3RRemediationOperationManifest.length !== 3 ||
    activeThroughSlice3AOperationManifest.length !== 13 ||
    dormantAfterSlice3AOperationManifest.length !== 17 ||
    activeThroughSlice3RA1OperationManifest.length !== 14 ||
    dormantAfterSlice3RA1OperationManifest.length !== 16 ||
    activeThroughSlice3RA2OperationManifest.length !== 16 ||
    dormantAfterSlice3RA2OperationManifest.length !== 14 ||
    slice4OperationManifest.length !== 3 ||
    activeThroughSlice4OperationManifest.length !== 19 ||
    dormantAfterSlice4OperationManifest.length !== 11 ||
    slice5OperationManifest.length !== 11 ||
    activeThroughSlice5OperationManifest.length !== 30 ||
    dormantAfterSlice5OperationManifest.length !== 0
  ) {
    throw new Error(
      'Manifest는 Slice 3A historical 13/17, Slice 3R-A1 14/16, Slice 3R-A2 16/14, Slice 4 19/11, Slice 5 30/0 경계를 유지해야 합니다.'
    )
  }
  const operations = new Set(operationManifest.map((entry) => entry.operation))
  const operationIds = new Set(
    operationManifest.map((entry) => entry.operationId)
  )
  if (operations.size !== 30 || operationIds.size !== 30) {
    throw new Error('operation/operationId는 각각 고유해야 합니다.')
  }
  if (slice2ReadOperationManifest.some((entry) => entry.method !== 'GET')) {
    throw new Error('Slice 2 manifest에는 GET read만 등록할 수 있습니다.')
  }
  if (
    new Set(slice4CacheInvalidationTargets).size !== 14 ||
    Object.keys(slice4CacheInvalidationContractByOperation).length !== 4
  ) {
    throw new Error(
      'Slice 4 cache invalidation 계약은 네 operation과 중복 없는 14개 target이어야 합니다.'
    )
  }
}

export type AdminOperation = (typeof operationManifest)[number]['operation']
