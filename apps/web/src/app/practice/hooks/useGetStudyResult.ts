import { useQuery } from '@tanstack/react-query'
import { studyResultQueries } from '@app/practice/queries/studyResultQueries'

export const useGetStudyResult = (sessionId: string) => {
  return useQuery(studyResultQueries.result(sessionId))
}
