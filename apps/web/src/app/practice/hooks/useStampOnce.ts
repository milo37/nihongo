import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { serverStateQueryKeys } from '@nihongo/browser/libs/serverStateQueryKeys'
import type { StudyResultView } from '@app/practice/adapters/studyResultView'

/**
 * #1094 M-2a: the stamp shows once, on the result screen the earning
 * submission opened. The cached result forgets it right away, so opening the
 * same result again in the app shows the plain goal line (as a reload does).
 */
export const useStampOnce = (sessionId: string, earned: boolean): boolean => {
  const queryClient = useQueryClient()
  const [stamp] = useState(earned)
  useEffect(() => {
    if (!earned) return
    queryClient.setQueryData<StudyResultView>(
      serverStateQueryKeys.study.result(sessionId),
      (cached) => (cached ? { ...cached, stampEarned: false } : cached)
    )
  }, [earned, queryClient, sessionId])
  return stamp
}
