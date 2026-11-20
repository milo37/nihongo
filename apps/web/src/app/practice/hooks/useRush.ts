import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { JlptLevel } from '@nihongo/contracts/common/enum'
import { getRushBest, getRushPairs, submitRushScore } from '@api/study/rush'
import type { RushBests } from '@api/study/rush/schema'

const bestKey = (userId: string) => ['rush-best', userId] as const

/** #1043: the member's best rush score for one level (null: none yet). */
export const useRushBest = (userId: string, level: JlptLevel) =>
  useQuery({
    queryKey: bestKey(userId),
    queryFn: getRushBest,
    staleTime: 60_000,
    retry: false,
    meta: { localErrorUi: true },
    select: (data: RushBests) =>
      data.bests.find(
        (row) => row.mode === 'KANJI_RUSH_30S' && row.level === level
      )?.best ?? null
  }).data ?? null

export const useRushPairs = (level: JlptLevel) =>
  useQuery({
    queryKey: ['rush-pairs', level] as const,
    queryFn: () => getRushPairs(level),
    staleTime: 300_000,
    meta: { localErrorUi: true }
  })

/** Sends a finished round; the server keeps it only when it is higher. */
export const useSubmitRushScore = (userId: string, level: JlptLevel) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (score: number) => submitRushScore(level, score),
    meta: { localErrorUi: true },
    onSuccess: ({ best }) =>
      queryClient.setQueryData<RushBests>(bestKey(userId), (old) => ({
        bests: [
          ...(old?.bests ?? []).filter(
            (row) => row.mode !== best.mode || row.level !== level
          ),
          best
        ]
      }))
  })
}
