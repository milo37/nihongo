import { createResponseValidationError } from '@nihongo/browser/api/config'
import type { QuestionWrite } from '@app/admin-question/detail/questionWorkflow'
import {
  mutationOptions,
  queryOptions,
  infiniteQueryOptions
} from '@tanstack/react-query'
import { requestContentOperation } from '@nihongo/browser/api/content-operations/requestContentOperation'
import { serverStateQueryKeys } from '@nihongo/browser/libs/serverStateQueryKeys'
export const questionWorkflowQueries = {
  allKey: serverStateQueryKeys.phase7AdminQuestion.all,
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
    })
}
