import { useQuery } from '@tanstack/react-query'
import { studyQueries } from '@app/practice/queries/studyQueries'

export const useGetStudySession = (sessionId: string) => {
  return useQuery(studyQueries.session(sessionId))
}
