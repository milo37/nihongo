import { useQuery } from '@tanstack/react-query'
import { adminQuestionQueries } from '@app/admin-question/queries/adminQuestionQueries'

export const useGetAdminQuestion = (questionId: string) => {
  return useQuery(adminQuestionQueries.detail(questionId))
}
