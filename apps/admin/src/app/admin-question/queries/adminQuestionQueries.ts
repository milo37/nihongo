import { createResponseValidationError } from '@nihongo/browser/api/config'
import { mutationOptions, queryOptions } from '@tanstack/react-query'
import { createAdminQuestion } from '@nihongo/browser/api/admin-question/createAdminQuestion/index'
import { deleteAdminQuestion } from '@nihongo/browser/api/admin-question/deleteAdminQuestion/index'
import { getAdminQuestion } from '@nihongo/browser/api/admin-question/getAdminQuestion/index'
import { listAdminQuestion } from '@nihongo/browser/api/admin-question/listAdminQuestion/index'
import { previewQuestionVersion } from '@nihongo/browser/api/admin-question/previewQuestionVersion/index'
import type { ListAdminQuestionRequest } from '@nihongo/browser/api/admin-question/listAdminQuestion/schema'
import type { DeleteAdminQuestionRequest } from '@nihongo/browser/api/admin-question/deleteAdminQuestion/schema'
import { updateAdminQuestion } from '@nihongo/browser/api/admin-question/updateAdminQuestion/index'
import type { UpdateAdminQuestionRequest } from '@nihongo/browser/api/admin-question/updateAdminQuestion/schema'
export interface UpdateAdminQuestionVariables {
  questionId: string
  versionId: string
  input: UpdateAdminQuestionRequest
}
export interface ArchiveAdminQuestionVariables {
  questionId: string
  input: DeleteAdminQuestionRequest
}
export const adminQuestionQueries = {
  allKey: () => ['admin-question'] as const,
  list: (params: ListAdminQuestionRequest) =>
    queryOptions({
      queryKey: [
        ...adminQuestionQueries.allKey(),
        'list-admin-questions',
        params
      ] as const,
      queryFn: () => listAdminQuestion(params),
      staleTime: 15_000
    }),
  detail: (questionId: string) =>
    queryOptions({
      queryKey: [
        ...adminQuestionQueries.allKey(),
        'get-admin-question',
        questionId
      ] as const,
      queryFn: () => getAdminQuestion(questionId),
      enabled: questionId.length > 0
    }),
  preview: (questionId: string, versionId: string, rowVersion: number) =>
    queryOptions({
      queryKey: [
        ...adminQuestionQueries.allKey(),
        'preview',
        questionId,
        versionId,
        rowVersion
      ] as const,
      queryFn: async () => {
        const response = await previewQuestionVersion(versionId)
        if (response.question.id !== questionId)
          throw createResponseValidationError(
            new Error(
              'Preview question ID does not match the selected question.'
            )
          )
        return response
      },
      enabled: versionId.length > 0
    })
} as const
export const adminQuestionMutations = {
  create: () =>
    mutationOptions({
      mutationKey: [
        ...adminQuestionQueries.allKey(),
        'create-admin-question'
      ] as const,
      mutationFn: createAdminQuestion
    }),
  update: () =>
    mutationOptions({
      mutationKey: [
        ...adminQuestionQueries.allKey(),
        'update-admin-question'
      ] as const,
      mutationFn: ({ versionId, input }: UpdateAdminQuestionVariables) =>
        updateAdminQuestion(versionId, input)
    }),
  delete: () =>
    mutationOptions({
      mutationKey: [
        ...adminQuestionQueries.allKey(),
        'archive-admin-question'
      ] as const,
      mutationFn: ({ questionId, input }: ArchiveAdminQuestionVariables) =>
        deleteAdminQuestion(questionId, input)
    })
} as const
