import { useQuery } from '@tanstack/react-query'
import { getTodayGoal } from '@api/study/getTodayGoal'

/**
 * #1090 O-r7: today's answers and the daily goal for the result screen, read
 * fresh each time it opens; quiet when the read fails (the line just hides).
 */
export const useTodayGoal = (userId: string) =>
  useQuery({
    queryKey: ['study-goal', userId, 'today'] as const,
    queryFn: getTodayGoal,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    meta: { localErrorUi: true }
  }).data ?? null
