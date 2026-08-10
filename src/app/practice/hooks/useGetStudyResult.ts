import { useQuery } from '@tanstack/react-query'
import { studyQueries } from '@app/practice/queries/studyQueries'

export const useGetStudyResult = (sessionId: string) => {
  return useQuery(studyQueries.result(sessionId))
}
