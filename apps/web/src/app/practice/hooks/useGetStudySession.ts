import { useQuery } from '@tanstack/react-query'
import { studySessionQueries } from '@app/practice/queries/studySessionQueries'

export const useGetStudySession = (sessionId: string) => {
  return useQuery(studySessionQueries.session(sessionId))
}
