import { useEffect } from 'react'
import type { RefObject } from 'react'
import type { StudyDraftSnapshot } from '@nihongo/contracts/study/study-draft'
import {
  STUDY_DRAFT_AUTOSAVE_DELAY_MS,
  STUDY_DRAFT_AUTOSAVE_MAX_WAIT_MS,
  STUDY_DRAFT_SAVE_MIN_GAP_MS,
  type StudyDraftSaveTiming
} from '@app/practice/draft/practiceDraftModel'
import type { useAppStore } from '@nihongo/browser/store/index'

type DraftStoreState = ReturnType<typeof useAppStore.getState>

type UseStudyDraftAutosaveTimerInput = {
  controllerScopeKey: string
  deferredRemoteRevisionScope: string | null
  draftConflict: DraftStoreState['draftConflict']
  draftSaveState: DraftStoreState['draftSaveState']
  draftWorkingCopy: DraftStoreState['draftWorkingCopy']
  enabled: boolean
  saveNowRef: RefObject<() => Promise<StudyDraftSnapshot>>
  saveTimingRef: RefObject<StudyDraftSaveTiming>
}

// Schedules the debounced autosave within the edit delay, max wait, server gap, and cooldown.
export const useStudyDraftAutosaveTimer = ({
  controllerScopeKey,
  deferredRemoteRevisionScope,
  draftConflict,
  draftSaveState,
  draftWorkingCopy,
  enabled,
  saveNowRef,
  saveTimingRef
}: UseStudyDraftAutosaveTimerInput): void => {
  useEffect(() => {
    if (
      !enabled ||
      draftSaveState !== 'dirty' ||
      draftConflict ||
      deferredRemoteRevisionScope === controllerScopeKey ||
      navigator.onLine === false
    ) {
      return
    }

    const timing = saveTimingRef.current
    if (!timing.active || timing.firstUnsentAt === null) return
    const dueAt = Math.max(
      Math.min(
        timing.lastEditAt + STUDY_DRAFT_AUTOSAVE_DELAY_MS,
        timing.firstUnsentAt + STUDY_DRAFT_AUTOSAVE_MAX_WAIT_MS
      ),
      timing.lastPutStartedAt + STUDY_DRAFT_SAVE_MIN_GAP_MS,
      timing.cooldownUntil
    )
    const timerId = window.setTimeout(
      () => {
        void saveNowRef.current().catch(() => undefined)
      },
      Math.max(0, dueAt - Date.now())
    )
    return () => window.clearTimeout(timerId)
  }, [
    controllerScopeKey,
    deferredRemoteRevisionScope,
    draftConflict,
    draftSaveState,
    draftWorkingCopy,
    enabled,
    saveNowRef,
    saveTimingRef
  ])
}
