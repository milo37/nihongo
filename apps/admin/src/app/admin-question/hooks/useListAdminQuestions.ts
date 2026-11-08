import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { ListAdminQuestionRequest } from '@api/admin-question/listAdminQuestion/schema'
import { adminQuestionQueries } from '@app/admin-question/queries/adminQuestionQueries'

export const useListAdminQuestions = (params: ListAdminQuestionRequest) => {
  // The previous page stays on screen while the next one loads.
  return useQuery({
    ...adminQuestionQueries.list(params),
    placeholderData: keepPreviousData
  })
}
