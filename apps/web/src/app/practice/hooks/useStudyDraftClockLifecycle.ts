import { useEffect } from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { StudyDraftWorkingCopy } from '@nihongo/browser/app/practice/draft/studyDraftWorkingCopy'
import type { StudyQuestionClock } from '@app/practice/draft/studyQuestionClock'
import { isWorkingCopyForScope } from '@app/practice/draft/practiceDraftModel'
import { useAppStore } from '@nihongo/browser/store/index'

type UseStudyDraftClockLifecycleInput = {
  clockRef: RefObject<StudyQuestionClock | null>
  enabled: boolean
  flushClockToWorkingCopy: () => StudyDraftWorkingCopy | null
  isInteractionPaused: boolean
  principalScope: string
  resumeClockForCurrentRecord: () => void
  sessionId: string
  setElapsedSeconds: Dispatch<SetStateAction<number>>
}

// Pauses the per-question clock while interaction is blocked and ticks the elapsed display.
export const useStudyDraftClockLifecycle = ({
  clockRef,
  enabled,
  flushClockToWorkingCopy,
  isInteractionPaused,
  principalScope,
  resumeClockForCurrentRecord,
  sessionId,
  setElapsedSeconds
}: UseStudyDraftClockLifecycleInput): void => {
  useEffect(() => {
    const clock = clockRef.current
    const record = useAppStore.getState().draftWorkingCopy
    if (
      !enabled ||
      !clock ||
      !isWorkingCopyForScope(record, principalScope, sessionId)
    ) {
      return
    }

    if (isInteractionPaused || document.visibilityState !== 'visible') {
      flushClockToWorkingCopy()
      clock.pause()
      return
    }

    resumeClockForCurrentRecord()
  }, [
    clockRef,
    enabled,
    flushClockToWorkingCopy,
    isInteractionPaused,
    principalScope,
    resumeClockForCurrentRecord,
    sessionId
  ])

  useEffect(() => {
    if (!enabled) {
      return
    }

    const timerId = window.setInterval(() => {
      clockRef.current?.flush()
      setElapsedSeconds(clockRef.current?.totalSeconds() ?? 0)
    }, 1_000)
    return () => window.clearInterval(timerId)
  }, [clockRef, enabled, setElapsedSeconds])
}
