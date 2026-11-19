import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { StudyGoal } from '@nihongo/contracts/auth/study-goal'
import { refreshCanonicalAuthAfterMutation } from '@nihongo/browser/app/login/authSession'
import { useAppNavigate } from '@nihongo/browser/libs/appNavigation'
import { skipStudyGoal, updateStudyGoal } from '@api/auth/studyGoal'
import { takeOnboardingCheck } from '@app/login/onboardingMarker'
import { studyGoalQueries } from '@app/login/queries/studyGoalQueries'

/** My page opens the page to change an answered goal. */
export const EDIT_RETURN_PATH = '/account'

/**
 * #1090 O-1·O-3: the study goal page. A member who never answered gets
 * [시작하기]/[나중에 할게요]; one who did (from My page) gets [저장]/[취소].
 * Either way the page hands back to `redirect`; a failed read hands back too.
 */
export const useStudyGoalPage = (userId: string, redirect: string) => {
  const navigate = useAppNavigate()
  const queryClient = useQueryClient()
  const goal = useQuery(studyGoalQueries.goal(userId))
  // The page is what the sign-in check would open, so reaching it answers
  // that check: no second read of the goal after handing back (#1110 CI,
  // where the leftover check read again whenever the page's answer had
  // left the cache).
  useEffect(() => {
    takeOnboardingCheck()
  }, [])
  const leave = async (): Promise<void> => {
    await navigate(redirect, { replace: true })
  }
  const keep = (next: StudyGoal): void => {
    queryClient.setQueryData(studyGoalQueries.goal(userId).queryKey, next)
  }
  const save = useMutation({
    retry: false,
    meta: { localErrorUi: true },
    mutationFn: updateStudyGoal,
    onSuccess: async (next) => {
      keep(next)
      // The target level lives on /me too (home and practice start there).
      await refreshCanonicalAuthAfterMutation(queryClient, {
        expectedIdentity: 'AUTHENTICATED'
      })
      await leave()
    }
  })
  const skip = useMutation({
    retry: false,
    meta: { localErrorUi: true },
    mutationFn: skipStudyGoal,
    onSuccess: async (next) => {
      keep(next)
      await leave()
    }
  })

  // Only My page reopens an answered page; a sign-in or sign-up return goes
  // straight on (O-1: never asked twice).
  const answered =
    goal.data !== undefined &&
    !goal.data.onboardingRequired &&
    redirect !== EDIT_RETURN_PATH
  const handBack = goal.isError || answered
  useEffect(() => {
    if (handBack) void leave()
    // leave only navigates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handBack])

  const busy = save.isPending || skip.isPending
  return {
    goal: handBack ? null : (goal.data ?? null),
    busy,
    isSaving: save.isPending,
    failed: save.isError || skip.isError,
    onSave: (body: Parameters<typeof updateStudyGoal>[0]): void => {
      if (busy) return
      skip.reset()
      save.mutate(body)
    },
    onSkip: (): void => {
      if (busy) return
      save.reset()
      skip.mutate()
    },
    onCancel: (): void => void leave()
  }
}
