import { useCallback } from 'react'
import { skipToken } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import {
  STUDY_DRAFT_SAVE_MIN_GAP_MS,
  isWorkingCopyForScope,
  savePacingQueryKey,
  type StudyDraftSavePacing,
  type StudyDraftSaveTiming
} from '@app/practice/draft/practiceDraftModel'
import { isCurrentAuthTransitionEpoch } from '@nihongo/browser/libs/authTransitionFence'
import { useAppStore } from '@nihongo/browser/store/index'

type UseStudyDraftSavePacingInput = {
  principalScope: string
  queryClient: QueryClient
  sessionId: string
}

// Keeps the server save gap and rate-limit cooldown across remounts of the same draft scope.
export const useStudyDraftSavePacing = ({
  principalScope,
  queryClient,
  sessionId
}: UseStudyDraftSavePacingInput) => {
  // Keep this extracted controller piece uncompiled, like usePracticeDraftController itself.
  'use no memo'

  const restoreSavePacing = useCallback(
    (timing: StudyDraftSaveTiming, authEpoch: number): void => {
      const cached =
        queryClient.getQueryData<StudyDraftSavePacing>(savePacingQueryKey)
      if (
        cached?.scopeKey !== timing.scopeKey ||
        cached.authEpoch !== authEpoch
      )
        return
      timing.lastPutStartedAt = Math.max(
        timing.lastPutStartedAt,
        cached.lastPutStartedAt
      )
      if (cached.cooldownUntil > timing.cooldownUntil) {
        timing.cooldownUntil = cached.cooldownUntil
        timing.rateLimitFailure = cached.rateLimitFailure
      }
    },
    [queryClient]
  )

  const rememberSavePacing = useCallback(
    (timing: StudyDraftSaveTiming, authEpoch: number): void => {
      if (
        !isCurrentAuthTransitionEpoch(authEpoch) ||
        !isWorkingCopyForScope(
          useAppStore.getState().draftWorkingCopy,
          principalScope,
          sessionId
        )
      )
        return
      const gcTime =
        Math.max(
          timing.lastPutStartedAt + STUDY_DRAFT_SAVE_MIN_GAP_MS,
          timing.cooldownUntil
        ) - Date.now()
      if (gcTime <= 0) return
      // Retain one scoped gate only until its last server pacing deadline.
      queryClient.removeQueries({ queryKey: savePacingQueryKey, exact: true })
      queryClient
        .getQueryCache()
        .build<StudyDraftSavePacing>(queryClient, {
          queryKey: savePacingQueryKey,
          queryFn: skipToken,
          gcTime
        })
        .setData({
          scopeKey: timing.scopeKey,
          authEpoch,
          lastPutStartedAt: timing.lastPutStartedAt,
          cooldownUntil: timing.cooldownUntil,
          rateLimitFailure: timing.rateLimitFailure
        })
    },
    [principalScope, queryClient, sessionId]
  )

  return { rememberSavePacing, restoreSavePacing }
}
