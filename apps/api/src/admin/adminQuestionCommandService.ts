import type {
  AdminQuestionMutationResult,
  AdminImportValidationResponse,
  AdminReviewRequestBatchResult,
  ApplyQuestionImportRequest,
  ApproveQuestionVersionRequest,
  ArchiveAdminQuestionRequest,
  CreateAdminQuestionRequest,
  CreateAdminQuestionVersionRequest,
  ExportAdminQuestionsRequest,
  PublishQuestionVersionRequest,
  RequestContentReviewRequest,
  RequestQuestionChangesRequest,
  RequestContentReviewBatchRequest,
  ResolveAdminQuestionReportRequest,
  RetireQuestionVersionRequest,
  UpdateQuestionVersionRequest,
  TriageAdminQuestionReportRequest,
  ValidateQuestionImportRequest,
  QuestionReportMutationResult,
  WithdrawQuestionApprovalRequest
} from '@nihongo/contracts/admin/content-operations'
import type {
  ApproveQuestionVersionBatchRequest,
  ApproveQuestionVersionBatchResponse,
  PublishQuestionVersionBatchRequest,
  PublishQuestionVersionBatchResponse,
  RetireQuestionVersionBatchRequest,
  RetireQuestionVersionBatchResponse
} from '@nihongo/contracts/admin/review'
import { ApplicationError } from '../errors/applicationError.js'
import {
  AdminQuestionCommandRepositoryError,
  type AdminCommandAuthority,
  type AdminQuestionCommandRepository,
  type AdminQuestionPublicationCommandRepository
} from './adminQuestionCommandRepository.js'
import type { AdminQuestionWorkflowRepository } from './adminQuestionWorkflowRepository.js'
import type {
  AdminImportApplyRepositoryResult,
  AdminQuestionExportRepositoryResult
} from './adminQuestionWorkflowRepository.js'

export interface AdminQuestionCommandService {
  createQuestion: (
    authority: AdminCommandAuthority,
    request: CreateAdminQuestionRequest
  ) => Promise<AdminQuestionMutationResult>
  createVersion: (
    authority: AdminCommandAuthority,
    questionId: string,
    request: CreateAdminQuestionVersionRequest
  ) => Promise<AdminQuestionMutationResult>
  updateVersion: (
    authority: AdminCommandAuthority,
    versionId: string,
    request: UpdateQuestionVersionRequest
  ) => Promise<AdminQuestionMutationResult>
  requestReview: (
    authority: AdminCommandAuthority,
    versionId: string,
    request: RequestContentReviewRequest
  ) => Promise<AdminQuestionMutationResult>
  requestChanges: (
    authority: AdminCommandAuthority,
    versionId: string,
    request: RequestQuestionChangesRequest
  ) => Promise<AdminQuestionMutationResult>
  approveVersion: (
    authority: AdminCommandAuthority,
    versionId: string,
    request: ApproveQuestionVersionRequest
  ) => Promise<AdminQuestionMutationResult>
  withdrawApproval: (
    authority: AdminCommandAuthority,
    versionId: string,
    request: WithdrawQuestionApprovalRequest
  ) => Promise<AdminQuestionMutationResult>
  /** Approves each item in its own transaction; the batch is not atomic. */
  approveVersionBatch: (
    authority: AdminCommandAuthority,
    request: ApproveQuestionVersionBatchRequest
  ) => Promise<ApproveQuestionVersionBatchResponse>
}

export interface AdminQuestionPublicationCommandService {
  publishVersion: (
    authority: AdminCommandAuthority,
    versionId: string,
    request: PublishQuestionVersionRequest
  ) => Promise<AdminQuestionMutationResult>
  retireVersion: (
    authority: AdminCommandAuthority,
    versionId: string,
    request: RetireQuestionVersionRequest
  ) => Promise<AdminQuestionMutationResult>
  archiveQuestion: (
    authority: AdminCommandAuthority,
    questionId: string,
    request: ArchiveAdminQuestionRequest
  ) => Promise<AdminQuestionMutationResult>
  /** Publishes each item in its own transaction; the batch is not atomic. */
  publishVersionBatch: (
    authority: AdminCommandAuthority,
    request: PublishQuestionVersionBatchRequest
  ) => Promise<PublishQuestionVersionBatchResponse>
  /** One transaction: every item is retired or none is (JLP-816). */
  retireVersionBatch: (
    authority: AdminCommandAuthority,
    request: RetireQuestionVersionBatchRequest
  ) => Promise<RetireQuestionVersionBatchResponse>
}

export interface AdminQuestionWorkflowCommandService {
  requestReviewBatch: (
    authority: AdminCommandAuthority,
    request: RequestContentReviewBatchRequest
  ) => Promise<AdminReviewRequestBatchResult>
  validateImport: (
    request: ValidateQuestionImportRequest
  ) => Promise<AdminImportValidationResponse>
  applyImport: (
    authority: AdminCommandAuthority,
    request: ApplyQuestionImportRequest
  ) => Promise<AdminImportApplyRepositoryResult>
  exportQuestions: (
    authority: AdminCommandAuthority,
    request: ExportAdminQuestionsRequest
  ) => Promise<AdminQuestionExportRepositoryResult>
  triageReport: (
    authority: AdminCommandAuthority,
    reportId: string,
    request: TriageAdminQuestionReportRequest
  ) => Promise<QuestionReportMutationResult>
  resolveReport: (
    authority: AdminCommandAuthority,
    reportId: string,
    request: ResolveAdminQuestionReportRequest
  ) => Promise<QuestionReportMutationResult>
}

const execute = async <Result>(
  operation: () => Promise<Result>
): Promise<Result> => {
  try {
    return await operation()
  } catch (error: unknown) {
    if (error instanceof AdminQuestionCommandRepositoryError) {
      throw new ApplicationError({
        code: error.code,
        message: error.message,
        retryable: false,
        adminDisposition: error.disposition,
        ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
        ...(error.internalReason
          ? { adminInternalReason: error.internalReason }
          : {}),
        ...(error.retryAfterSeconds
          ? { retryAfterSeconds: error.retryAfterSeconds }
          : {}),
        cause: error
      })
    }
    throw error
  }
}

export const createAdminQuestionCommandService = (
  repository: AdminQuestionCommandRepository
): AdminQuestionCommandService => ({
  createQuestion: (authority, request) =>
    execute(() => repository.createQuestion(authority, request)),
  createVersion: (authority, questionId, request) =>
    execute(() => repository.createVersion(authority, questionId, request)),
  updateVersion: (authority, versionId, request) =>
    execute(() => repository.updateVersion(authority, versionId, request)),
  requestReview: (authority, versionId, request) =>
    execute(() =>
      repository.transitionVersion(
        'requestContentReview',
        authority,
        versionId,
        request
      )
    ),
  requestChanges: (authority, versionId, request) =>
    execute(() =>
      repository.transitionVersion(
        'requestQuestionChanges',
        authority,
        versionId,
        request
      )
    ),
  approveVersion: (authority, versionId, request) =>
    execute(() =>
      repository.transitionVersion(
        'approveQuestionVersion',
        authority,
        versionId,
        request
      )
    ),
  withdrawApproval: (authority, versionId, request) =>
    execute(() =>
      repository.transitionVersion(
        'withdrawQuestionApproval',
        authority,
        versionId,
        request
      )
    ),
  approveVersionBatch: (authority, request) =>
    execute(async () => {
      const items: ApproveQuestionVersionBatchResponse['items'][number][] = []
      for (const { questionVersionId, expectedRowVersion } of request.items) {
        items.push(
          await approveBatchItem(
            repository,
            authority,
            questionVersionId,
            expectedRowVersion,
            items.some(({ result }) => result === 'APPROVED')
          )
        )
      }
      return {
        approvedCount: items.filter(({ result }) => result === 'APPROVED')
          .length,
        items
      }
    })
})

const APPROVAL_BATCH_ITEM_RESULTS = {
  RESOURCE_NOT_FOUND: 'NOT_FOUND',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  INVALID_STATE_TRANSITION: 'NOT_IN_REVIEW'
} as const satisfies Partial<
  Record<
    AdminQuestionCommandRepositoryError['code'],
    ApproveQuestionVersionBatchResponse['items'][number]['result']
  >
>

/** Same failure rule as publishBatchItem: throw until something commits. */
const approveBatchItem = async (
  repository: AdminQuestionCommandRepository,
  authority: AdminCommandAuthority,
  questionVersionId: string,
  expectedRowVersion: number,
  anyApproved: boolean
): Promise<ApproveQuestionVersionBatchResponse['items'][number]> => {
  try {
    const approved = await repository.transitionVersion(
      'approveQuestionVersion',
      authority,
      questionVersionId,
      { expectedRowVersion }
    )
    return {
      questionVersionId,
      result: 'APPROVED',
      rowVersion: approved.versionRowVersion
    }
  } catch (error: unknown) {
    if (
      error instanceof AdminQuestionCommandRepositoryError &&
      error.code in APPROVAL_BATCH_ITEM_RESULTS
    ) {
      return {
        questionVersionId,
        result:
          APPROVAL_BATCH_ITEM_RESULTS[
            error.code as keyof typeof APPROVAL_BATCH_ITEM_RESULTS
          ],
        rowVersion: null
      }
    }
    if (!anyApproved) {
      throw error
    }
    return { questionVersionId, result: 'FAILED', rowVersion: null }
  }
}

const BATCH_ITEM_RESULTS = {
  RESOURCE_NOT_FOUND: 'NOT_FOUND',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  INVALID_STATE_TRANSITION: 'NOT_REVIEWED'
} as const satisfies Partial<
  Record<
    AdminQuestionCommandRepositoryError['code'],
    PublishQuestionVersionBatchResponse['items'][number]['result']
  >
>

const isBatchItemFailure = (
  code: AdminQuestionCommandRepositoryError['code']
): code is keyof typeof BATCH_ITEM_RESULTS => code in BATCH_ITEM_RESULTS

/**
 * Item outcomes become results. Other failures throw while nothing is
 * published yet, so an error response never hides a committed item; after the
 * first publish they become FAILED and the batch continues.
 */
const publishBatchItem = async (
  repository: AdminQuestionPublicationCommandRepository,
  authority: AdminCommandAuthority,
  questionVersionId: string,
  expectedRowVersion: number,
  anyPublished: boolean
): Promise<PublishQuestionVersionBatchResponse['items'][number]> => {
  try {
    const target = await repository.readPublicationTarget(questionVersionId)
    if (!target) {
      return { questionVersionId, result: 'NOT_FOUND', rowVersion: null }
    }
    // Only APPROVED versions can be published; the DB rejects the rest late.
    if (target.versionStatus !== 'APPROVED') {
      return { questionVersionId, result: 'NOT_REVIEWED', rowVersion: null }
    }
    const published = await repository.publishVersion(
      authority,
      questionVersionId,
      {
        expectedRowVersion,
        expectedQuestionRowVersion: target.questionRowVersion
      }
    )
    return {
      questionVersionId,
      result: 'PUBLISHED',
      rowVersion: published.versionRowVersion
    }
  } catch (error: unknown) {
    if (
      error instanceof AdminQuestionCommandRepositoryError &&
      isBatchItemFailure(error.code)
    ) {
      return {
        questionVersionId,
        result: BATCH_ITEM_RESULTS[error.code],
        rowVersion: null
      }
    }
    if (!anyPublished) {
      throw error
    }
    return { questionVersionId, result: 'FAILED', rowVersion: null }
  }
}

export const createAdminQuestionPublicationCommandService = (
  repository: AdminQuestionPublicationCommandRepository
): AdminQuestionPublicationCommandService => ({
  publishVersion: (authority, versionId, request) =>
    execute(() => repository.publishVersion(authority, versionId, request)),
  retireVersion: (authority, versionId, request) =>
    execute(() => repository.retireVersion(authority, versionId, request)),
  archiveQuestion: (authority, questionId, request) =>
    execute(() => repository.archiveQuestion(authority, questionId, request)),
  retireVersionBatch: (authority, request) =>
    execute(() => repository.retireVersionBatch(authority, request)),
  publishVersionBatch: (authority, request) =>
    execute(async () => {
      const items: PublishQuestionVersionBatchResponse['items'][number][] = []
      for (const { questionVersionId, expectedRowVersion } of request.items) {
        items.push(
          await publishBatchItem(
            repository,
            authority,
            questionVersionId,
            expectedRowVersion,
            items.some(({ result }) => result === 'PUBLISHED')
          )
        )
      }
      return {
        publishedCount: items.filter(({ result }) => result === 'PUBLISHED')
          .length,
        items
      }
    })
})

export const createAdminQuestionWorkflowCommandService = (
  repository: AdminQuestionWorkflowRepository
): AdminQuestionWorkflowCommandService => ({
  requestReviewBatch: (authority, request) =>
    execute(() => repository.requestReviewBatch(authority, request)),
  validateImport: (request) =>
    execute(() => repository.validateImport(request)),
  applyImport: (authority, request) =>
    execute(() => repository.applyImport(authority, request)),
  exportQuestions: (authority, request) =>
    execute(() => repository.exportQuestions(authority, request)),
  triageReport: (authority, reportId, request) =>
    execute(() => repository.triageReport(authority, reportId, request)),
  resolveReport: (authority, reportId, request) =>
    execute(() => repository.resolveReport(authority, reportId, request))
})
