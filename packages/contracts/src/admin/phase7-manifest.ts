export type Phase7HttpMethod = 'GET' | 'PATCH' | 'POST'
export type Phase7ResponseBodyKind = 'JSON' | 'ATTACHMENT'

export interface Phase7OperationManifestEntry {
  readonly operation: string
  readonly operationId: string
  readonly method: Phase7HttpMethod
  readonly path: string
  readonly successStatus: 200 | 201
  readonly responseBodyKind: Phase7ResponseBodyKind
  readonly requiresFreshAssurance: boolean
  readonly slice2Route: boolean
}

export const phase7OperationManifest = [
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
] as const satisfies readonly Phase7OperationManifestEntry[]

export const phase7Slice2ReadOperationManifest = phase7OperationManifest.filter(
  (entry) => entry.slice2Route
)

const PHASE_7_SLICE_3A_COMMAND_OPERATIONS = new Set<Phase7Operation>([
  'createAdminQuestion',
  'createAdminQuestionVersion',
  'updateQuestionVersion',
  'requestContentReview',
  'requestQuestionChanges'
])

const PHASE_7_SLICE_3R_REMEDIATION_OPERATIONS = new Set<Phase7Operation>([
  'reauthenticateAdmin',
  'approveQuestionVersion',
  'withdrawQuestionApproval'
])

const PHASE_7_SLICE_3R_A1_OPERATIONS = new Set<Phase7Operation>([
  'reauthenticateAdmin'
])

const PHASE_7_SLICE_3R_A2_OPERATIONS = new Set<Phase7Operation>([
  'approveQuestionVersion',
  'withdrawQuestionApproval'
])

const PHASE_7_SLICE_4_OPERATIONS = new Set<Phase7Operation>([
  'archiveAdminQuestion',
  'publishQuestionVersion',
  'retireQuestionVersion'
])

export const phase7Slice4CacheInvalidationTargets = [
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
  targets: phase7Slice4CacheInvalidationTargets
} as const

export const phase7Slice4CacheInvalidationContractByOperation = {
  publishQuestionVersion: slice4CacheInvalidationContract,
  retireQuestionVersion: slice4CacheInvalidationContract,
  archiveAdminQuestion: slice4CacheInvalidationContract
} as const satisfies Readonly<
  Record<
    'publishQuestionVersion' | 'retireQuestionVersion' | 'archiveAdminQuestion',
    typeof slice4CacheInvalidationContract
  >
>

export const phase7Slice3ACommandOperationManifest =
  phase7OperationManifest.filter((entry) =>
    PHASE_7_SLICE_3A_COMMAND_OPERATIONS.has(entry.operation)
  )

export const phase7Slice3RRemediationOperationManifest =
  phase7OperationManifest.filter((entry) =>
    PHASE_7_SLICE_3R_REMEDIATION_OPERATIONS.has(entry.operation)
  )

export const phase7ActiveThroughSlice3AOperationManifest =
  phase7OperationManifest.filter(
    (entry) =>
      entry.slice2Route ||
      PHASE_7_SLICE_3A_COMMAND_OPERATIONS.has(entry.operation)
  )

export const phase7DormantAfterSlice3AOperationManifest =
  phase7OperationManifest.filter(
    (entry) =>
      !entry.slice2Route &&
      !PHASE_7_SLICE_3A_COMMAND_OPERATIONS.has(entry.operation)
  )

export const phase7ActiveThroughSlice3RA1OperationManifest =
  phase7OperationManifest.filter(
    (entry) =>
      entry.slice2Route ||
      PHASE_7_SLICE_3A_COMMAND_OPERATIONS.has(entry.operation) ||
      PHASE_7_SLICE_3R_A1_OPERATIONS.has(entry.operation)
  )

export const phase7DormantAfterSlice3RA1OperationManifest =
  phase7OperationManifest.filter(
    (entry) =>
      !entry.slice2Route &&
      !PHASE_7_SLICE_3A_COMMAND_OPERATIONS.has(entry.operation) &&
      !PHASE_7_SLICE_3R_A1_OPERATIONS.has(entry.operation)
  )

export const phase7ActiveThroughSlice3RA2OperationManifest =
  phase7OperationManifest.filter(
    (entry) =>
      entry.slice2Route ||
      PHASE_7_SLICE_3A_COMMAND_OPERATIONS.has(entry.operation) ||
      PHASE_7_SLICE_3R_A1_OPERATIONS.has(entry.operation) ||
      PHASE_7_SLICE_3R_A2_OPERATIONS.has(entry.operation)
  )

export const phase7DormantAfterSlice3RA2OperationManifest =
  phase7OperationManifest.filter(
    (entry) =>
      !entry.slice2Route &&
      !PHASE_7_SLICE_3A_COMMAND_OPERATIONS.has(entry.operation) &&
      !PHASE_7_SLICE_3R_A1_OPERATIONS.has(entry.operation) &&
      !PHASE_7_SLICE_3R_A2_OPERATIONS.has(entry.operation)
  )

export const phase7Slice4OperationManifest = phase7OperationManifest.filter(
  (entry) => PHASE_7_SLICE_4_OPERATIONS.has(entry.operation)
)

export const phase7ActiveThroughSlice4OperationManifest =
  phase7OperationManifest.filter(
    (entry) =>
      entry.slice2Route ||
      PHASE_7_SLICE_3A_COMMAND_OPERATIONS.has(entry.operation) ||
      PHASE_7_SLICE_3R_A1_OPERATIONS.has(entry.operation) ||
      PHASE_7_SLICE_3R_A2_OPERATIONS.has(entry.operation) ||
      PHASE_7_SLICE_4_OPERATIONS.has(entry.operation)
  )

export const phase7DormantAfterSlice4OperationManifest =
  phase7OperationManifest.filter(
    (entry) =>
      !entry.slice2Route &&
      !PHASE_7_SLICE_3A_COMMAND_OPERATIONS.has(entry.operation) &&
      !PHASE_7_SLICE_3R_A1_OPERATIONS.has(entry.operation) &&
      !PHASE_7_SLICE_3R_A2_OPERATIONS.has(entry.operation) &&
      !PHASE_7_SLICE_4_OPERATIONS.has(entry.operation)
  )

export const assertPhase7OperationManifest = (): void => {
  if (phase7OperationManifest.length !== 28) {
    throw new Error('Phase 7 operation manifest는 정확히 28개여야 합니다.')
  }
  if (phase7Slice2ReadOperationManifest.length !== 8) {
    throw new Error('Phase 7 Slice 2 route manifest는 정확히 8개여야 합니다.')
  }
  if (
    phase7Slice3ACommandOperationManifest.length !== 5 ||
    phase7Slice3RRemediationOperationManifest.length !== 3 ||
    phase7ActiveThroughSlice3AOperationManifest.length !== 13 ||
    phase7DormantAfterSlice3AOperationManifest.length !== 15 ||
    phase7ActiveThroughSlice3RA1OperationManifest.length !== 14 ||
    phase7DormantAfterSlice3RA1OperationManifest.length !== 14 ||
    phase7ActiveThroughSlice3RA2OperationManifest.length !== 16 ||
    phase7DormantAfterSlice3RA2OperationManifest.length !== 12 ||
    phase7Slice4OperationManifest.length !== 3 ||
    phase7ActiveThroughSlice4OperationManifest.length !== 19 ||
    phase7DormantAfterSlice4OperationManifest.length !== 9
  ) {
    throw new Error(
      'Phase 7 manifest는 Slice 3A historical 13/15, Slice 3R-A1 14/14, Slice 3R-A2 16/12, Slice 4 19/9 경계를 유지해야 합니다.'
    )
  }
  const operations = new Set(
    phase7OperationManifest.map((entry) => entry.operation)
  )
  const operationIds = new Set(
    phase7OperationManifest.map((entry) => entry.operationId)
  )
  if (operations.size !== 28 || operationIds.size !== 28) {
    throw new Error('Phase 7 operation/operationId는 각각 고유해야 합니다.')
  }
  if (
    phase7Slice2ReadOperationManifest.some((entry) => entry.method !== 'GET')
  ) {
    throw new Error('Slice 2 manifest에는 GET read만 등록할 수 있습니다.')
  }
  if (
    new Set(phase7Slice4CacheInvalidationTargets).size !== 14 ||
    Object.keys(phase7Slice4CacheInvalidationContractByOperation).length !== 3
  ) {
    throw new Error(
      'Slice 4 cache invalidation 계약은 세 operation과 중복 없는 14개 target이어야 합니다.'
    )
  }
}

export type Phase7Operation =
  (typeof phase7OperationManifest)[number]['operation']
export type Phase7OperationId =
  (typeof phase7OperationManifest)[number]['operationId']
