import type {
  ApplyQuestionImportRequest,
  ApproveQuestionVersionRequest,
  ArchiveAdminQuestionRequest,
  CreateAdminQuestionRequest,
  CreateAdminQuestionVersionRequest,
  CreateQuestionReportRequest,
  DiffQuestionVersionQuery,
  ExportAdminQuestionsRequest,
  ListAdminAuditLogQuery,
  ListAdminQuestionReportsQuery,
  ListAdminQuestionsQuery,
  ListAdminQuestionVersionsQuery,
  ListAdminTagsQuery,
  ListQuestionVersionReviewsQuery,
  PublishQuestionVersionRequest,
  ReauthenticateAdminRequest,
  RequestContentReviewBatchRequest,
  RequestContentReviewRequest,
  RequestQuestionChangesRequest,
  ResolveAdminQuestionReportRequest,
  RetireQuestionVersionRequest,
  TriageAdminQuestionReportRequest,
  UpdateQuestionVersionRequest,
  ValidateQuestionImportRequest,
  WithdrawQuestionApprovalRequest
} from '@nihongo/contracts/admin/phase7'
import { requestPhase7Export } from '@api/phase7/requestPhase7Export'
import { requestPhase7Operation } from '@api/phase7/requestPhase7Operation'

export const listPhase7AdminQuestions = (query: ListAdminQuestionsQuery) =>
  requestPhase7Operation({
    operation: 'listAdminQuestions',
    params: {},
    query,
    body: undefined
  })

export const createPhase7AdminQuestion = (body: CreateAdminQuestionRequest) =>
  requestPhase7Operation({
    operation: 'createAdminQuestion',
    params: {},
    query: {},
    body
  })

export const getPhase7AdminQuestion = (questionId: string) =>
  requestPhase7Operation({
    operation: 'getAdminQuestion',
    params: { questionId },
    query: {},
    body: undefined
  })

export const listPhase7AdminTags = (query: ListAdminTagsQuery) =>
  requestPhase7Operation({
    operation: 'listAdminTags',
    params: {},
    query,
    body: undefined
  })

export const createPhase7AdminQuestionVersion = (
  questionId: string,
  body: CreateAdminQuestionVersionRequest
) =>
  requestPhase7Operation({
    operation: 'createAdminQuestionVersion',
    params: { questionId },
    query: {},
    body
  })

export const archivePhase7AdminQuestion = (
  questionId: string,
  body: ArchiveAdminQuestionRequest
) =>
  requestPhase7Operation({
    operation: 'archiveAdminQuestion',
    params: { questionId },
    query: {},
    body
  })

export const previewPhase7QuestionVersion = (versionId: string) =>
  requestPhase7Operation({
    operation: 'previewQuestionVersion',
    params: { versionId },
    query: {},
    body: undefined
  })

export const diffPhase7QuestionVersion = (
  versionId: string,
  query: DiffQuestionVersionQuery
) =>
  requestPhase7Operation({
    operation: 'diffQuestionVersion',
    params: { versionId },
    query,
    body: undefined
  })

export const listPhase7AdminQuestionVersions = (
  questionId: string,
  query: ListAdminQuestionVersionsQuery
) =>
  requestPhase7Operation({
    operation: 'listAdminQuestionVersions',
    params: { questionId },
    query,
    body: undefined
  })

export const listPhase7QuestionVersionReviews = (
  versionId: string,
  query: ListQuestionVersionReviewsQuery
) =>
  requestPhase7Operation({
    operation: 'listQuestionVersionReviews',
    params: { versionId },
    query,
    body: undefined
  })

export const updatePhase7QuestionVersion = (
  versionId: string,
  body: UpdateQuestionVersionRequest
) =>
  requestPhase7Operation({
    operation: 'updateQuestionVersion',
    params: { versionId },
    query: {},
    body
  })

export const requestPhase7ContentReview = (
  versionId: string,
  body: RequestContentReviewRequest
) =>
  requestPhase7Operation({
    operation: 'requestContentReview',
    params: { versionId },
    query: {},
    body
  })

export const requestPhase7QuestionChanges = (
  versionId: string,
  body: RequestQuestionChangesRequest
) =>
  requestPhase7Operation({
    operation: 'requestQuestionChanges',
    params: { versionId },
    query: {},
    body
  })

export const approvePhase7QuestionVersion = (
  versionId: string,
  body: ApproveQuestionVersionRequest
) =>
  requestPhase7Operation({
    operation: 'approveQuestionVersion',
    params: { versionId },
    query: {},
    body
  })

export const withdrawPhase7QuestionApproval = (
  versionId: string,
  body: WithdrawQuestionApprovalRequest
) =>
  requestPhase7Operation({
    operation: 'withdrawQuestionApproval',
    params: { versionId },
    query: {},
    body
  })

export const publishPhase7QuestionVersion = (
  versionId: string,
  body: PublishQuestionVersionRequest
) =>
  requestPhase7Operation({
    operation: 'publishQuestionVersion',
    params: { versionId },
    query: {},
    body
  })

export const retirePhase7QuestionVersion = (
  versionId: string,
  body: RetireQuestionVersionRequest
) =>
  requestPhase7Operation({
    operation: 'retireQuestionVersion',
    params: { versionId },
    query: {},
    body
  })

export const requestPhase7ContentReviewBatch = (
  body: RequestContentReviewBatchRequest
) =>
  requestPhase7Operation({
    operation: 'requestContentReviewBatch',
    params: {},
    query: {},
    body
  })

export const validatePhase7QuestionImport = (
  body: ValidateQuestionImportRequest
) =>
  requestPhase7Operation({
    operation: 'validateQuestionImport',
    params: {},
    query: {},
    body
  })

export const applyPhase7QuestionImport = (body: ApplyQuestionImportRequest) =>
  requestPhase7Operation({
    operation: 'applyQuestionImport',
    params: {},
    query: {},
    body
  })

export const exportPhase7AdminQuestions = (
  body: ExportAdminQuestionsRequest,
  signal?: AbortSignal
) => requestPhase7Export(body, { signal })

export const listPhase7AdminAuditLog = (query: ListAdminAuditLogQuery) =>
  requestPhase7Operation({
    operation: 'listAdminAuditLog',
    params: {},
    query,
    body: undefined
  })

export const reauthenticatePhase7Admin = (body: ReauthenticateAdminRequest) =>
  requestPhase7Operation({
    operation: 'reauthenticateAdmin',
    params: {},
    query: {},
    body
  })

export const createPhase7QuestionReport = (body: CreateQuestionReportRequest) =>
  requestPhase7Operation({
    operation: 'createQuestionReport',
    params: {},
    query: {},
    body
  })

export const listPhase7AdminQuestionReports = (
  query: ListAdminQuestionReportsQuery
) =>
  requestPhase7Operation({
    operation: 'listAdminQuestionReports',
    params: {},
    query,
    body: undefined
  })

export const getPhase7AdminQuestionReport = (reportId: string) =>
  requestPhase7Operation({
    operation: 'getAdminQuestionReport',
    params: { reportId },
    query: {},
    body: undefined
  })

export const triagePhase7AdminQuestionReport = (
  reportId: string,
  body: TriageAdminQuestionReportRequest
) =>
  requestPhase7Operation({
    operation: 'triageAdminQuestionReport',
    params: { reportId },
    query: {},
    body
  })

export const resolvePhase7AdminQuestionReport = (
  reportId: string,
  body: ResolveAdminQuestionReportRequest
) =>
  requestPhase7Operation({
    operation: 'resolveAdminQuestionReport',
    params: { reportId },
    query: {},
    body
  })
