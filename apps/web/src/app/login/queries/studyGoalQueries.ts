import { queryOptions, useQuery } from '@tanstack/react-query'
import type { JlptLevel } from '@nihongo/browser/common/types/domain'
import { LEVELS } from '@nihongo/browser/common/types/domain'
import { cachedStorage } from '@nihongo/browser/libs/storage'
import { getStudyGoal } from '@api/auth/studyGoal'

// #1090: what the study goal page (login chunk) and My page share, in one
// module so both ride in the chunk they already share (the nickname field).

/** The study goal page; `redirect` is where it hands back. */
export const ONBOARDING_PATH = '/onboarding'

export const onboardingPath = (redirect: string): string =>
  `${ONBOARDING_PATH}?redirect=${encodeURIComponent(redirect)}`

// The practice screen's last level on this device (lastPracticeChoice.ts
// owns the key); read here so the practice chunk stays its own.
const LAST_PRACTICE_KEY = 'harumaru:last-practice:v1'

export const readLastPracticeLevel = (): JlptLevel | null => {
  try {
    const raw: unknown = JSON.parse(
      cachedStorage.getItem(LAST_PRACTICE_KEY) ?? 'null'
    )
    const level: unknown =
      raw !== null && typeof raw === 'object' ? Reflect.get(raw, 'level') : null
    return LEVELS.find((known) => known === level) ?? null
  } catch {
    return null
  }
}

// One member's goal; today's count changes with every submitted set, so
// screens read it again when they open. Every screen stays quiet when the
// read fails (no banner): the page hands back, the row just does not show.
export const studyGoalQueries = {
  allKey: () => ['study-goal'] as const,
  goal: (userId: string) =>
    queryOptions({
      queryKey: ['study-goal', userId] as const,
      queryFn: getStudyGoal,
      staleTime: 0,
      retry: false,
      refetchOnWindowFocus: false,
      meta: { localErrorUi: true }
    })
} as const

/** The member's goal and today's count, or null while it loads or fails. */
export const useStudyGoal = (userId: string) =>
  useQuery(studyGoalQueries.goal(userId)).data ?? null
