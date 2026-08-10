import { useQuery } from '@tanstack/react-query'
import type { ListAdminQuestionRequest } from '@api/admin-question/listAdminQuestion/schema'
import { adminQuestionQueries } from '@app/admin-question/queries/adminQuestionQueries'

export const useListAdminQuestions = (params: ListAdminQuestionRequest) => {
  return useQuery(adminQuestionQueries.list(params))
}
