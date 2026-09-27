import type {
  AdminQuestionMutationResult,
  ApproveQuestionVersionRequest,
  ArchiveAdminQuestionRequest,
  CreateAdminQuestionRequest,
  CreateAdminQuestionVersionRequest,
  PublishQuestionVersionRequest,
  RequestContentReviewRequest,
  RequestQuestionChangesRequest,
  RetireQuestionVersionRequest,
  UpdateQuestionVersionRequest,
  WithdrawQuestionApprovalRequest
} from '@nihongo/contracts/admin/phase7'
import { ApplicationError } from '../errors/applicationError.js'
import {
  AdminQuestionCommandRepositoryError,
  type AdminCommandAuthority,
  type AdminQuestionCommandRepository,
  type AdminQuestionPublicationCommandRepository
} from './adminQuestionCommandRepository.js'

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
        phase7Disposition: error.disposition,
        ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
        ...(error.internalReason
          ? { phase7InternalReason: error.internalReason }
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
    )
})

export const createAdminQuestionPublicationCommandService = (
  repository: AdminQuestionPublicationCommandRepository
): AdminQuestionPublicationCommandService => ({
  publishVersion: (authority, versionId, request) =>
    execute(() => repository.publishVersion(authority, versionId, request)),
  retireVersion: (authority, versionId, request) =>
    execute(() => repository.retireVersion(authority, versionId, request)),
  archiveQuestion: (authority, questionId, request) =>
    execute(() => repository.archiveQuestion(authority, questionId, request))
})
