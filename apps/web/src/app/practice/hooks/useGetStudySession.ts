import { useQuery } from '@tanstack/react-query'
import { studySessionQueries } from '@app/practice/queries/studySessionQueries'

export const useGetStudySession = (
  sessionId: string,
  requireFreshOwnerProbe = false,
  enabled = true
) => {
  const options = studySessionQueries.session(sessionId)
  return useQuery({
    ...options,
    enabled: enabled && options.enabled,
    refetchOnMount: requireFreshOwnerProbe ? 'always' : undefined
  })
}
