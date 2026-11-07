import { createResponseValidationError } from '@nihongo/browser/api/config'
import {
  questionErrorCode,
  type QuestionWrite
} from '@app/admin-question/detail/questionWorkflow'
import {
  mutationOptions,
  queryOptions,
  infiniteQueryOptions
} from '@tanstack/react-query'
import {
  requestContentOperation,
  type ContentOperationBody,
  type ContentOperationResult
} from '@nihongo/browser/api/content-operations/requestContentOperation'
import { serverStateQueryKeys } from '@nihongo/browser/libs/serverStateQueryKeys'
/** Why a review request item was not sent; a failed chunk fails all its items. */
export type ReviewRequestFailure =
  | 'VERSION_CONFLICT'
  | 'NOT_DRAFT'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'FAILED'

/** Why a batch item was not done, for any batch action. */
export type BatchFailure =
  | ReviewRequestFailure
  | Exclude<
      ContentOperationResult<'publishQuestionVersionBatch'>['items'][number]['result'],
      'PUBLISHED'
    >
  | Exclude<
      ContentOperationResult<'approveQuestionVersionBatch'>['items'][number]['result'],
      'APPROVED'
    >

type BatchResponse<Failure extends BatchFailure = BatchFailure> = {
  readonly succeeded: number
  readonly items: ReadonlyArray<{
    readonly questionVersionId: string
    readonly failure: Failure | null
  }>
}

export const REVIEW_REQUEST_CHUNK = 20

const chunkFailure: Readonly<Record<string, ReviewRequestFailure>> = {
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  INVALID_STATE_TRANSITION: 'NOT_DRAFT',
  RESOURCE_NOT_FOUND: 'NOT_FOUND'
}

/**
 * Sends review requests 20 at a time, in order. A chunk the server refuses
 * for its items is marked and the next chunk still goes; any other refusal
 * stops sending. Before anything succeeded the error is thrown so the dialog
 * can show it (sign-in, fresh assurance, rate limit).
 */
const requestReviewInChunks = async (
  items: ContentOperationBody<'publishQuestionVersionBatch'>['items']
): Promise<BatchResponse<ReviewRequestFailure>> => {
  const results: Array<{
    questionVersionId: string
    failure: ReviewRequestFailure | null
  }> = []
  let succeeded = 0
  for (let start = 0; start < items.length; start += REVIEW_REQUEST_CHUNK) {
    const chunk = items.slice(start, start + REVIEW_REQUEST_CHUNK)
    try {
      await requestContentOperation({
        operation: 'requestContentReviewBatch',
        params: {},
        query: {},
        body: {
          items: chunk.map(({ questionVersionId, expectedRowVersion }) => ({
            versionId: questionVersionId,
            expectedRowVersion
          }))
        }
      })
      succeeded += chunk.length
      results.push(
        ...chunk.map(({ questionVersionId }) => ({
          questionVersionId,
          failure: null
        }))
      )
    } catch (error) {
      const code = questionErrorCode(error)
      const itemFailure = code ? chunkFailure[code] : undefined
      if (itemFailure) {
        results.push(
          ...chunk.map(({ questionVersionId }) => ({
            questionVersionId,
            failure: itemFailure
          }))
        )
        continue
      }
      if (results.length === 0) throw error
      const failure: ReviewRequestFailure =
        code === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'FAILED'
      results.push(
        ...items.slice(start).map(({ questionVersionId }) => ({
          questionVersionId,
          failure
        }))
      )
      break
    }
  }
  return { succeeded, items: results }
}

export const questionWorkflowQueries = {
  allKey: serverStateQueryKeys.adminQuestion.all,
  detail: (actor: string | null, epoch: number, questionId: string) =>
    queryOptions({
      queryKey: [
        ...questionWorkflowQueries.allKey(),
        'workflow',
        actor,
        epoch,
        questionId
      ] as const,
      queryFn: () =>
        requestContentOperation({
          operation: 'getAdminQuestion',
          params: { questionId },
          query: {},
          body: undefined
        }),
      staleTime: 15_000,
      retry: false
    }),
  versions: (
    actor: string | null,
    epoch: number,
    questionId: string,
    rowVersion: number
  ) =>
    infiniteQueryOptions({
      queryKey: [
        ...questionWorkflowQueries.allKey(),
        'versions',
        actor,
        epoch,
        questionId,
        rowVersion
      ] as const,
      initialPageParam: undefined as string | undefined,
      queryFn: ({ pageParam }) =>
        requestContentOperation({
          operation: 'listAdminQuestionVersions',
          params: { questionId },
          query: { limit: 20, ...(pageParam ? { cursor: pageParam } : {}) },
          body: undefined
        }),
      getNextPageParam: (page) => page.nextCursor ?? undefined,
      staleTime: 15_000,
      retry: false
    }),
  preview: (
    actor: string | null,
    epoch: number,
    questionId: string,
    versionId: string,
    rowVersion: number
  ) =>
    queryOptions({
      queryKey: [
        ...questionWorkflowQueries.allKey(),
        'preview',
        actor,
        epoch,
        questionId,
        versionId,
        rowVersion
      ] as const,
      queryFn: async () => {
        const result = await requestContentOperation({
          operation: 'previewQuestionVersion',
          params: { versionId },
          query: {},
          body: undefined
        })
        if (result.question.id !== questionId)
          throw createResponseValidationError(
            'Question preview does not match selected question'
          )
        return result
      },
      staleTime: 15_000,
      retry: false
    }),
  diff: (
    actor: string | null,
    epoch: number,
    versionId: string,
    rowVersion: number,
    baseVersionId: string
  ) =>
    queryOptions({
      queryKey: [
        ...questionWorkflowQueries.allKey(),
        'diff',
        actor,
        epoch,
        versionId,
        rowVersion,
        baseVersionId
      ] as const,
      queryFn: () =>
        requestContentOperation({
          operation: 'diffQuestionVersion',
          params: { versionId },
          query: { baseVersionId },
          body: undefined
        }),
      staleTime: 15_000,
      retry: false
    }),
  reviews: (
    actor: string | null,
    epoch: number,
    versionId: string,
    rowVersion: number
  ) =>
    infiniteQueryOptions({
      queryKey: [
        ...questionWorkflowQueries.allKey(),
        'reviews',
        actor,
        epoch,
        versionId,
        rowVersion
      ] as const,
      initialPageParam: undefined as string | undefined,
      queryFn: ({ pageParam }) =>
        requestContentOperation({
          operation: 'listQuestionVersionReviews',
          params: { versionId },
          query: { limit: 20, ...(pageParam ? { cursor: pageParam } : {}) },
          body: undefined
        }),
      getNextPageParam: (page) => page.nextCursor ?? undefined,
      staleTime: 15_000,
      retry: false
    })
}

export const questionWorkflowMutations = {
  command: () =>
    mutationOptions({
      mutationKey: [...questionWorkflowQueries.allKey(), 'command'],
      mutationFn: (request: QuestionWrite) => {
        switch (request.operation) {
          case 'updateQuestionVersion':
            return requestContentOperation(request)
          case 'createAdminQuestionVersion':
            return requestContentOperation(request)
          case 'archiveAdminQuestion':
            return requestContentOperation(request)
          case 'requestContentReview':
            return requestContentOperation(request)
          case 'requestQuestionChanges':
            return requestContentOperation(request)
          case 'approveQuestionVersion':
            return requestContentOperation(request)
          case 'withdrawQuestionApproval':
            return requestContentOperation(request)
          case 'publishQuestionVersion':
            return requestContentOperation(request)
          case 'retireQuestionVersion':
            return requestContentOperation(request)
        }
      }
    }),
  /**
   * Batch review request, approve or publish; per-item failures, success as
   * null. Review requests go out 20 at a time, the server's batch limit.
   */
  batch: () =>
    mutationOptions({
      mutationKey: [
        ...questionWorkflowQueries.allKey(),
        'question-version-batch'
      ],
      mutationFn: async ({
        action,
        items
      }: {
        readonly action: 'request' | 'approve' | 'publish'
        readonly items: ContentOperationBody<'publishQuestionVersionBatch'>['items']
      }): Promise<BatchResponse> => {
        if (action === 'request') return requestReviewInChunks(items)
        if (action === 'approve') {
          const response = await requestContentOperation({
            operation: 'approveQuestionVersionBatch',
            params: {},
            query: {},
            body: { items }
          })
          return {
            succeeded: response.approvedCount,
            items: response.items.map(({ questionVersionId, result }) => ({
              questionVersionId,
              failure: result === 'APPROVED' ? null : result
            }))
          }
        }
        const response = await requestContentOperation({
          operation: 'publishQuestionVersionBatch',
          params: {},
          query: {},
          body: { items }
        })
        return {
          succeeded: response.publishedCount,
          items: response.items.map(({ questionVersionId, result }) => ({
            questionVersionId,
            failure: result === 'PUBLISHED' ? null : result
          }))
        }
      }
    })
}
