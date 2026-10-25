import { useQuery } from '@tanstack/react-query'
import { studyResultQueries } from '@app/practice/queries/studyResultQueries'

export const useGetStudyResult = (
  sessionId: string,
  requireFreshOwnerProbe = false,
  enabled = true
) => {
  const options = studyResultQueries.result(sessionId)
  return useQuery({
    ...options,
    enabled: enabled && options.enabled,
    refetchOnMount: requireFreshOwnerProbe ? 'always' : undefined
  })
}
