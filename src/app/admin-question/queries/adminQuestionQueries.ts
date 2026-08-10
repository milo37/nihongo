import { mutationOptions, queryOptions } from '@tanstack/react-query'
import { createAdminQuestion } from '@api/admin-question/createAdminQuestion'
import { deleteAdminQuestion } from '@api/admin-question/deleteAdminQuestion'
import { getAdminQuestion } from '@api/admin-question/getAdminQuestion'
import { listAdminQuestion } from '@api/admin-question/listAdminQuestion'
import type { ListAdminQuestionRequest } from '@api/admin-question/listAdminQuestion/schema'
import { updateAdminQuestion } from '@api/admin-question/updateAdminQuestion'
import type { UpdateAdminQuestionRequest } from '@api/admin-question/updateAdminQuestion/schema'

export interface UpdateAdminQuestionVariables {
  questionId: string
  input: UpdateAdminQuestionRequest
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
      mutationFn: ({ questionId, input }: UpdateAdminQuestionVariables) =>
        updateAdminQuestion(questionId, input)
    }),
  delete: () =>
    mutationOptions({
      mutationKey: [
        ...adminQuestionQueries.allKey(),
        'delete-admin-question'
      ] as const,
      mutationFn: deleteAdminQuestion
    })
} as const
