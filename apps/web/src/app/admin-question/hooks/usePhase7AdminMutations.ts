import { useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  AdminQuestionMutationResult,
  AdminQuestionSummary,
  AdminQuestionVersionSummary,
  ApplyQuestionImportRequest,
  PreviewQuestionVersionResponse,
  QuestionReportMutationResult,
  RequestContentReviewBatchRequest,
  ResolveAdminQuestionReportRequest,
  UpdateQuestionVersionRequest,
  ValidateQuestionImportRequest
} from '@nihongo/contracts/admin/phase7'
import { createAdminQuestionVersionRequestSchema } from '@nihongo/contracts/admin/phase7'
import {
  applyPhase7QuestionImport,
  approvePhase7QuestionVersion,
  archivePhase7AdminQuestion,
  createPhase7AdminQuestion,
  createPhase7AdminQuestionVersion,
  exportPhase7AdminQuestions,
  publishPhase7QuestionVersion,
  requestPhase7ContentReview,
  requestPhase7ContentReviewBatch,
  requestPhase7QuestionChanges,
  resolvePhase7AdminQuestionReport,
  retirePhase7QuestionVersion,
  triagePhase7AdminQuestionReport,
  updatePhase7QuestionVersion,
  validatePhase7QuestionImport,
  withdrawPhase7QuestionApproval
} from '@api/phase7/phase7AdminApi'
import { invalidatePhase7AdminMutation } from '@app/admin-question/queries/phase7AdminInvalidation'
import {
  AuthTransitionSupersededError,
  assertCurrentAuthActorTransitionFence,
  captureAuthActorTransitionFence,
  type AuthActorTransitionFence
} from '@libs/authTransitionFence'
import { useAppStore } from '@store/index'

export interface Phase7UiApiError extends Error {
  readonly code?: string
  readonly fieldErrors?: Record<string, string[]>
  readonly isOffline?: boolean
  readonly requestId?: string
  readonly retryAfterMs?: number
  readonly serverMessage?: string
  readonly status?: number
}

export const isPhase7UiApiError = (error: unknown): error is Phase7UiApiError =>
  error instanceof Error &&
  ('code' in error ||
    'fieldErrors' in error ||
    'isOffline' in error ||
    'requestId' in error ||
    'retryAfterMs' in error ||
    'serverMessage' in error ||
    'status' in error)

const captureAdminMutationFence = (): AuthActorTransitionFence => {
  const actor = useAppStore.getState().currentUser
  if (actor?.role !== 'ADMIN') throw new AuthTransitionSupersededError()
  return captureAuthActorTransitionFence(actor)
}

const assertAdminMutationFence = (
  fence: AuthActorTransitionFence | undefined
): void => {
  if (!fence || fence.role !== 'ADMIN') {
    throw new AuthTransitionSupersededError()
  }
  assertCurrentAuthActorTransitionFence(
    fence,
    useAppStore.getState().currentUser
  )
}

const runCurrentAdminErrorCallback = <Input>(
  fence: AuthActorTransitionFence | undefined,
  callback: ((error: unknown, input: Input) => void) | undefined,
  error: unknown,
  input: Input
): void => {
  try {
    assertAdminMutationFence(fence)
  } catch (fenceError: unknown) {
    if (fenceError instanceof AuthTransitionSupersededError) return
    throw fenceError
  }
  callback?.(error, input)
}

export const useCreatePhase7AdminQuestion = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['phase7-admin', 'create-question'],
    networkMode: 'always',
    mutationFn: createPhase7AdminQuestion,
    onMutate: () => captureAdminMutationFence(),
    onSuccess: async (result, _input, fence) => {
      assertAdminMutationFence(fence)
      await invalidatePhase7AdminMutation(queryClient, {
        kind: 'CONTENT_EDIT',
        questionIds: [result.questionId],
        versionIds: result.questionVersionId ? [result.questionVersionId] : []
      })
      assertAdminMutationFence(fence)
    }
  })
}

export type Phase7AdminQuestionCommand =
  | 'APPROVE'
  | 'ARCHIVE'
  | 'CHANGE_REQUEST'
  | 'CREATE_VERSION'
  | 'PUBLISH'
  | 'REQUEST_REVIEW'
  | 'RETIRE'
  | 'WITHDRAW'

export interface Phase7AdminQuestionCommandInput {
  readonly command: Phase7AdminQuestionCommand
  readonly note: string
  readonly questionId: string
  readonly questionRowVersion: number
  readonly version: AdminQuestionVersionSummary
}

interface Phase7AdminQuestionCommandOptions {
  readonly currentPublishedVersionId: string | null
  readonly openCandidateVersionId: string | null
  readonly openCandidateVersionRowVersion: number | null
  readonly preview?: PreviewQuestionVersionResponse
  readonly onError?: (
    error: unknown,
    input: Phase7AdminQuestionCommandInput
  ) => void
  readonly onSuccess?: (
    result: AdminQuestionMutationResult,
    input: Phase7AdminQuestionCommandInput
  ) => void
}

export const resolvePhase7CommandAffectedVersionIds = (input: {
  readonly command: Phase7AdminQuestionCommand
  readonly currentPublishedVersionId: string | null
  readonly openCandidateVersionId: string | null
  readonly resultQuestionVersionId: string | null
  readonly selectedVersionId: string
}): readonly string[] => {
  const candidates =
    input.command === 'PUBLISH'
      ? [
          input.resultQuestionVersionId ?? input.selectedVersionId,
          input.currentPublishedVersionId
        ]
      : input.command === 'ARCHIVE'
        ? [input.currentPublishedVersionId, input.openCandidateVersionId]
        : [input.resultQuestionVersionId ?? input.selectedVersionId]

  return [...new Set(candidates.filter((id): id is string => id !== null))]
}

export const usePhase7AdminQuestionCommand = (
  options: Phase7AdminQuestionCommandOptions
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['phase7-admin', 'question-command'],
    networkMode: 'always',
    onMutate: () => captureAdminMutationFence(),
    mutationFn: async (
      input: Phase7AdminQuestionCommandInput
    ): Promise<AdminQuestionMutationResult> => {
      const { command, note, questionRowVersion, version } = input
      switch (command) {
        case 'REQUEST_REVIEW':
          return requestPhase7ContentReview(version.questionVersionId, {
            expectedRowVersion: version.rowVersion,
            ...(note.trim() ? { comment: note.trim() } : {})
          })
        case 'CHANGE_REQUEST':
          return requestPhase7QuestionChanges(version.questionVersionId, {
            expectedRowVersion: version.rowVersion,
            reason: note.trim(),
            ...(note.trim() ? { comment: note.trim() } : {})
          })
        case 'APPROVE':
          return approvePhase7QuestionVersion(version.questionVersionId, {
            expectedRowVersion: version.rowVersion,
            ...(note.trim() ? { comment: note.trim() } : {})
          })
        case 'WITHDRAW':
          return withdrawPhase7QuestionApproval(version.questionVersionId, {
            expectedRowVersion: version.rowVersion,
            reason: note.trim(),
            ...(note.trim() ? { comment: note.trim() } : {})
          })
        case 'PUBLISH':
          return publishPhase7QuestionVersion(version.questionVersionId, {
            expectedRowVersion: version.rowVersion,
            expectedQuestionRowVersion: questionRowVersion
          })
        case 'RETIRE':
          return retirePhase7QuestionVersion(version.questionVersionId, {
            expectedRowVersion: version.rowVersion,
            expectedQuestionRowVersion: questionRowVersion
          })
        case 'ARCHIVE':
          return archivePhase7AdminQuestion(input.questionId, {
            expectedQuestionRowVersion: questionRowVersion,
            expectedOpenCandidateVersionId: options.openCandidateVersionId,
            expectedOpenCandidateRowVersion:
              options.openCandidateVersionRowVersion
          })
        case 'CREATE_VERSION': {
          if (!options.preview) {
            throw new Error('SOURCE_VERSION_PREVIEW_UNAVAILABLE')
          }
          const optionKeyById = new Map(
            options.preview.question.options.map((option, index) => [
              option.id,
              `option-${index + 1}`
            ])
          )
          return createPhase7AdminQuestionVersion(
            input.questionId,
            createAdminQuestionVersionRequestSchema.parse({
              expectedQuestionRowVersion: questionRowVersion,
              level: options.preview.question.level,
              subject: options.preview.question.subject,
              questionType: options.preview.question.questionType,
              difficulty: options.preview.question.difficulty,
              questionText: options.preview.question.questionText,
              passage: options.preview.question.passage,
              explanationKo: options.preview.adminAnswer.explanationKo,
              explanationJa: options.preview.adminAnswer.explanationJa,
              tagNames: options.preview.question.tags.map((tag) => tag.label),
              options: options.preview.question.options.map((option) => ({
                clientOptionKey: optionKeyById.get(option.id),
                text: option.text
              })),
              correctOptionKey: optionKeyById.get(
                options.preview.adminAnswer.correctOptionId
              )
            })
          )
        }
      }
    },
    onSuccess: async (result, input, fence) => {
      assertAdminMutationFence(fence)
      const kind =
        input.command === 'PUBLISH' ||
        input.command === 'RETIRE' ||
        input.command === 'ARCHIVE'
          ? 'PUBLICATION'
          : input.command === 'CREATE_VERSION'
            ? 'CONTENT_EDIT'
            : 'REVIEW'
      await invalidatePhase7AdminMutation(queryClient, {
        kind,
        questionIds: [input.questionId],
        versionIds: resolvePhase7CommandAffectedVersionIds({
          command: input.command,
          currentPublishedVersionId: options.currentPublishedVersionId,
          openCandidateVersionId: options.openCandidateVersionId,
          resultQuestionVersionId: result.questionVersionId,
          selectedVersionId: input.version.questionVersionId
        })
      })
      assertAdminMutationFence(fence)
      options.onSuccess?.(result, input)
    },
    onError: (error, input, fence) =>
      runCurrentAdminErrorCallback(fence, options.onError, error, input)
  })
}

export const useUpdatePhase7AdminQuestionVersion = (
  questionId: string,
  versionId: string,
  onSuccess?: (result: AdminQuestionMutationResult) => void
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['phase7-admin', 'update-version', versionId],
    networkMode: 'always',
    mutationFn: (body: UpdateQuestionVersionRequest) =>
      updatePhase7QuestionVersion(versionId, body),
    onMutate: () => captureAdminMutationFence(),
    onSuccess: async (result, _body, fence) => {
      assertAdminMutationFence(fence)
      await invalidatePhase7AdminMutation(queryClient, {
        kind: 'CONTENT_EDIT',
        questionIds: [questionId],
        versionIds: result.questionVersionId ? [result.questionVersionId] : []
      })
      assertAdminMutationFence(fence)
      onSuccess?.(result)
    }
  })
}

export interface Phase7ContentReviewBatchInput {
  readonly request: RequestContentReviewBatchRequest
  readonly targets: readonly AdminQuestionSummary[]
}

export const usePhase7ContentReviewBatch = (
  onSuccess?: (count: number) => void,
  onError?: (error: unknown, input: Phase7ContentReviewBatchInput) => void
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['phase7-admin', 'request-review-batch'],
    networkMode: 'always',
    mutationFn: (input: Phase7ContentReviewBatchInput) =>
      requestPhase7ContentReviewBatch(input.request),
    onMutate: () => captureAdminMutationFence(),
    onSuccess: async (result, input, fence) => {
      assertAdminMutationFence(fence)
      await invalidatePhase7AdminMutation(queryClient, {
        kind: 'BATCH_REVIEW',
        questionIds: input.targets.map((item) => item.questionId),
        versionIds: input.targets.map((item) => item.selectedVersionId)
      })
      assertAdminMutationFence(fence)
      onSuccess?.(result.items.length)
    },
    onError: (error, input, fence) =>
      runCurrentAdminErrorCallback(fence, onError, error, input)
  })
}

export const usePhase7AdminExport = (
  onSuccess?: (
    result: Awaited<ReturnType<typeof exportPhase7AdminQuestions>>
  ) => void,
  onError?: (error: unknown, questionIds: readonly string[]) => void
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['phase7-admin', 'export'],
    networkMode: 'always',
    mutationFn: (questionIds: readonly string[]) =>
      exportPhase7AdminQuestions({
        questionIds: [...questionIds]
      }),
    onMutate: () => captureAdminMutationFence(),
    onSuccess: async (result, _questionIds, fence) => {
      assertAdminMutationFence(fence)
      await invalidatePhase7AdminMutation(queryClient, { kind: 'EXPORT' })
      assertAdminMutationFence(fence)
      onSuccess?.(result)
    },
    onError: (error, questionIds, fence) =>
      runCurrentAdminErrorCallback(fence, onError, error, questionIds)
  })
}

export const useValidatePhase7QuestionImport = () =>
  useMutation({
    mutationKey: ['phase7-admin', 'import-validation'],
    networkMode: 'always',
    mutationFn: (request: ValidateQuestionImportRequest) =>
      validatePhase7QuestionImport(request),
    onMutate: () => captureAdminMutationFence(),
    onSuccess: (_result, _request, fence) => {
      assertAdminMutationFence(fence)
    }
  })

export const useApplyPhase7QuestionImport = (
  onSuccess?: (createdCount: number) => void,
  onError?: (error: unknown) => void
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['phase7-admin', 'import-apply'],
    networkMode: 'always',
    mutationFn: (request: ApplyQuestionImportRequest) =>
      applyPhase7QuestionImport(request),
    onMutate: () => captureAdminMutationFence(),
    onSuccess: async (result, _request, fence) => {
      assertAdminMutationFence(fence)
      await invalidatePhase7AdminMutation(queryClient, {
        kind: 'IMPORT_APPLY',
        questionIds: result.items.map((item) => item.questionId),
        versionIds: result.items.map((item) => item.questionVersionId)
      })
      assertAdminMutationFence(fence)
      onSuccess?.(result.createdCount)
    },
    onError: (error, request, fence) =>
      runCurrentAdminErrorCallback(
        fence,
        onError ? (callbackError) => onError(callbackError) : undefined,
        error,
        request
      )
  })
}

export const useTriagePhase7AdminQuestionReport = (
  reportId: string,
  onSuccess?: (status: QuestionReportMutationResult['status']) => void
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['phase7-admin', 'report-triage', reportId],
    networkMode: 'always',
    mutationFn: (expectedRowVersion: number) =>
      triagePhase7AdminQuestionReport(reportId, { expectedRowVersion }),
    onMutate: () => captureAdminMutationFence(),
    onSuccess: async (result, _expectedRowVersion, fence) => {
      assertAdminMutationFence(fence)
      await invalidatePhase7AdminMutation(queryClient, {
        kind: 'REPORT_TRIAGE',
        reportId
      })
      assertAdminMutationFence(fence)
      onSuccess?.(result.status)
    }
  })
}

export const useResolvePhase7AdminQuestionReport = (
  reportId: string,
  onSuccess?: (status: QuestionReportMutationResult['status']) => void,
  onError?: (error: unknown) => void
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['phase7-admin', 'report-resolution', reportId],
    networkMode: 'always',
    mutationFn: (request: ResolveAdminQuestionReportRequest) =>
      resolvePhase7AdminQuestionReport(reportId, request),
    onMutate: () => captureAdminMutationFence(),
    onSuccess: async (result, _request, fence) => {
      assertAdminMutationFence(fence)
      await invalidatePhase7AdminMutation(queryClient, {
        kind: 'REPORT_RESOLVE',
        questionIds: [result.questionId],
        reportId
      })
      assertAdminMutationFence(fence)
      onSuccess?.(result.status)
    },
    onError: (error, request, fence) =>
      runCurrentAdminErrorCallback(
        fence,
        onError ? (callbackError) => onError(callbackError) : undefined,
        error,
        request
      )
  })
}
