import {
  type AdminQuestionDetail,
  type AdminQuestionVersionSummary,
  type PreviewQuestionVersionResponse,
  type UpdateQuestionVersionRequest,
  createAdminQuestionVersionRequestSchema,
  archiveAdminQuestionRequestSchema,
  requestContentReviewRequestSchema,
  requestQuestionChangesRequestSchema,
  approveQuestionVersionRequestSchema,
  withdrawQuestionApprovalRequestSchema,
  publishQuestionVersionRequestSchema,
  retireQuestionVersionRequestSchema
} from '@nihongo/contracts/admin/content-operations'
import type { ContentOperationRequest } from '@nihongo/browser/api/content-operations/requestContentOperation'

export const questionCommands = [
  'REQUEST_REVIEW',
  'CHANGE_REQUEST',
  'APPROVE',
  'WITHDRAW',
  'PUBLISH',
  'RETIRE',
  'CREATE_VERSION',
  'ARCHIVE'
] as const
export type QuestionCommand = (typeof questionCommands)[number]
export type QuestionWrite = {
  [K in
    | 'updateQuestionVersion'
    | 'createAdminQuestionVersion'
    | 'archiveAdminQuestion'
    | 'requestContentReview'
    | 'requestQuestionChanges'
    | 'approveQuestionVersion'
    | 'withdrawQuestionApproval'
    | 'publishQuestionVersion'
    | 'retireQuestionVersion']: ContentOperationRequest<K>
}[
  | 'updateQuestionVersion'
  | 'createAdminQuestionVersion'
  | 'archiveAdminQuestion'
  | 'requestContentReview'
  | 'requestQuestionChanges'
  | 'approveQuestionVersion'
  | 'withdrawQuestionApproval'
  | 'publishQuestionVersion'
  | 'retireQuestionVersion']

export const editorInput = (
  preview: PreviewQuestionVersionResponse,
  rowVersion: number
): UpdateQuestionVersionRequest => ({
  level: preview.question.level,
  subject: preview.question.subject,
  questionType: preview.question.questionType,
  difficulty: preview.question.difficulty,
  questionText: preview.question.questionText,
  passage: preview.question.passage,
  explanationKo: preview.adminAnswer.explanationKo,
  explanationJa: preview.adminAnswer.explanationJa,
  tagNames: preview.question.tags.map((tag) => tag.label),
  options: preview.question.options.map((option, index) => ({
    id: option.id,
    ordinal: index + 1,
    text: option.text
  })),
  correctOptionId: preview.adminAnswer.correctOptionId,
  expectedRowVersion: rowVersion
})
export const editableVersion = (
  detail: AdminQuestionDetail,
  version: AdminQuestionVersionSummary,
  actorId: string
): boolean =>
  detail.question.lifecycleStatus === 'ACTIVE' &&
  detail.question.openCandidateVersionId === version.questionVersionId &&
  version.author?.actorId === actorId &&
  ['DRAFT', 'CHANGES_REQUESTED'].includes(version.versionStatus)
export const allowedCommands = (
  detail: AdminQuestionDetail,
  version: AdminQuestionVersionSummary,
  actorId: string,
  candidate?: AdminQuestionVersionSummary
): QuestionCommand[] => {
  if (detail.question.lifecycleStatus !== 'ACTIVE') return []
  const commands: QuestionCommand[] = []
  if (!detail.question.openCandidateVersionId) commands.push('CREATE_VERSION')
  if (!detail.question.openCandidateVersionId || candidate)
    commands.push('ARCHIVE')
  const isCandidate =
    detail.question.openCandidateVersionId === version.questionVersionId
  if (editableVersion(detail, version, actorId)) commands.push('REQUEST_REVIEW')
  if (isCandidate && version.author && version.author.actorId !== actorId) {
    if (version.versionStatus === 'IN_REVIEW')
      commands.push('CHANGE_REQUEST', 'APPROVE')
    if (version.versionStatus === 'APPROVED') commands.push('WITHDRAW')
  }
  if (
    isCandidate &&
    version.versionStatus === 'APPROVED' &&
    version.author &&
    version.latestReviewer &&
    version.author.actorId !== version.latestReviewer.actorId
  )
    commands.push('PUBLISH')
  if (
    version.versionStatus === 'PUBLISHED' &&
    detail.question.currentPublishedVersionId === version.questionVersionId
  )
    commands.push('RETIRE')
  return commands
}
export const buildQuestionCommand = (
  command: QuestionCommand,
  detail: AdminQuestionDetail,
  version: AdminQuestionVersionSummary,
  preview: PreviewQuestionVersionResponse,
  note: string,
  candidate?: AdminQuestionVersionSummary
): QuestionWrite => {
  const params = { versionId: version.questionVersionId }
  const body = { expectedRowVersion: version.rowVersion }
  switch (command) {
    case 'REQUEST_REVIEW':
      return {
        operation: 'requestContentReview',
        params,
        query: {},
        body: requestContentReviewRequestSchema.parse({
          ...body,
          ...(note.trim() ? { comment: note } : {})
        })
      }
    case 'CHANGE_REQUEST':
      return {
        operation: 'requestQuestionChanges',
        params,
        query: {},
        body: requestQuestionChangesRequestSchema.parse({
          ...body,
          reason: note
        })
      }
    case 'APPROVE':
      return {
        operation: 'approveQuestionVersion',
        params,
        query: {},
        body: approveQuestionVersionRequestSchema.parse({
          ...body,
          ...(note.trim() ? { comment: note } : {})
        })
      }
    case 'WITHDRAW':
      return {
        operation: 'withdrawQuestionApproval',
        params,
        query: {},
        body: withdrawQuestionApprovalRequestSchema.parse({
          ...body,
          reason: note
        })
      }
    case 'PUBLISH':
      return {
        operation: 'publishQuestionVersion',
        params,
        query: {},
        body: publishQuestionVersionRequestSchema.parse({
          ...body,
          expectedQuestionRowVersion: detail.question.rowVersion
        })
      }
    case 'RETIRE':
      return {
        operation: 'retireQuestionVersion',
        params,
        query: {},
        body: retireQuestionVersionRequestSchema.parse({
          ...body,
          expectedQuestionRowVersion: detail.question.rowVersion
        })
      }
    case 'ARCHIVE':
      return {
        operation: 'archiveAdminQuestion',
        params: { questionId: detail.question.questionId },
        query: {},
        body: archiveAdminQuestionRequestSchema.parse({
          expectedQuestionRowVersion: detail.question.rowVersion,
          expectedOpenCandidateVersionId:
            detail.question.openCandidateVersionId,
          expectedOpenCandidateRowVersion: candidate?.rowVersion ?? null
        })
      }
    case 'CREATE_VERSION': {
      const {
        expectedRowVersion: _row,
        options,
        correctOptionId,
        ...content
      } = editorInput(preview, version.rowVersion)
      return {
        operation: 'createAdminQuestionVersion',
        params: { questionId: detail.question.questionId },
        query: {},
        body: createAdminQuestionVersionRequestSchema.parse({
          ...content,
          expectedQuestionRowVersion: detail.question.rowVersion,
          options: options.map((option, index) => ({
            clientOptionKey: `option-${index + 1}`,
            text: option.text
          })),
          correctOptionKey: `option-${options.findIndex((option) => option.id === correctOptionId) + 1}`
        })
      }
    }
  }
}
export const questionErrorCode = (error: unknown): string | null =>
  error &&
  typeof error === 'object' &&
  'code' in error &&
  typeof error.code === 'string'
    ? error.code
    : null
export const questionFieldErrors = (
  error: unknown
): Readonly<Record<string, readonly string[]>> => {
  if (
    !error ||
    typeof error !== 'object' ||
    !('fieldErrors' in error) ||
    !error.fieldErrors ||
    typeof error.fieldErrors !== 'object'
  )
    return {}
  return Object.fromEntries(
    Object.entries(error.fieldErrors).filter(
      (entry): entry is [string, string[]] =>
        Array.isArray(entry[1]) &&
        entry[1].every((value) => typeof value === 'string')
    )
  )
}
