import { useEffect } from 'react'
import type { RefObject } from 'react'
import type { StudyDraftSnapshot } from '@nihongo/contracts/study/study-draft'
import { isStudyDraftDiffEmpty } from '@nihongo/browser/app/practice/draft/studyDraftMerge'
import type { StudyDraftWorkingCopy } from '@nihongo/browser/app/practice/draft/studyDraftWorkingCopy'
import type { StudyQuestionClock } from '@app/practice/draft/studyQuestionClock'
import { isWorkingCopyForScope } from '@app/practice/draft/practiceDraftModel'
import { captureAuthTransitionEpoch } from '@nihongo/browser/libs/authTransitionFence'
import { useAppStore } from '@nihongo/browser/store/index'

type DraftStoreState = ReturnType<typeof useAppStore.getState>

type UseStudyDraftWindowEventsInput = {
  clockRef: RefObject<StudyQuestionClock | null>
  controllerScopeKey: string
  drainPendingRemoteRevision: () => Promise<void>
  enabled: boolean
  flushClockToWorkingCopy: () => StudyDraftWorkingCopy | null
  handleRemoteReconcileFailure: (error: unknown) => void
  isInteractionPaused: boolean
  lastPersistenceFailedRef: RefObject<boolean>
  pendingRemoteRevisionRef: RefObject<{
    revision: number
    scopeKey: string
  } | null>
  principalScope: string
  reconcileFromServer: () => Promise<StudyDraftSnapshot | null>
  refreshSessionBoundary: (actionEpoch: number) => Promise<boolean>
  resumeClockForCurrentRecord: () => void
  saveNowRef: RefObject<() => Promise<StudyDraftSnapshot>>
  sessionId: string
  setDraftConflictPending: DraftStoreState['setDraftConflictPending']
  setDraftSaveState: DraftStoreState['setDraftSaveState']
  usableBootstrapRecord: StudyDraftWorkingCopy | null
}

// Visibility, connectivity, focus, and unload events that pause, flush, or resync the draft.
export const useStudyDraftWindowEvents = ({
  clockRef,
  controllerScopeKey,
  drainPendingRemoteRevision,
  enabled,
  flushClockToWorkingCopy,
  handleRemoteReconcileFailure,
  isInteractionPaused,
  lastPersistenceFailedRef,
  pendingRemoteRevisionRef,
  principalScope,
  reconcileFromServer,
  refreshSessionBoundary,
  resumeClockForCurrentRecord,
  saveNowRef,
  sessionId,
  setDraftConflictPending,
  setDraftSaveState,
  usableBootstrapRecord
}: UseStudyDraftWindowEventsInput): void => {
  useEffect(() => {
    if (!enabled) {
      return
    }

    const handleVisibility = (): void => {
      if (document.visibilityState === 'hidden') {
        flushClockToWorkingCopy()
        clockRef.current?.pause()
      } else {
        const actionEpoch = captureAuthTransitionEpoch()
        void refreshSessionBoundary(actionEpoch).catch(() => undefined)
        resumeClockForCurrentRecord()
      }
    }
    const handleOffline = (): void => {
      flushClockToWorkingCopy()
      if (lastPersistenceFailedRef.current) {
        return
      }
      setDraftSaveState('offline')
    }
    const handleOnline = (): void => {
      const record = useAppStore.getState().draftWorkingCopy
      if (!isWorkingCopyForScope(record, principalScope, sessionId)) {
        return
      }
      if (record.frozenAttempt) {
        void saveNowRef.current().catch(() => undefined)
      } else if (
        !isStudyDraftDiffEmpty(record.localDiff) ||
        !isStudyDraftDiffEmpty(record.postFlightLocalDiff)
      ) {
        setDraftConflictPending(true)
        setDraftSaveState('conflict')
        void reconcileFromServer().catch(handleRemoteReconcileFailure)
      } else if (
        pendingRemoteRevisionRef.current?.scopeKey === controllerScopeKey
      ) {
        void drainPendingRemoteRevision().catch(handleRemoteReconcileFailure)
      } else {
        void reconcileFromServer().catch(handleRemoteReconcileFailure)
      }
      const actionEpoch = captureAuthTransitionEpoch()
      void refreshSessionBoundary(actionEpoch).catch(() => undefined)
      resumeClockForCurrentRecord()
    }
    const handleFocus = (): void => {
      const actionEpoch = captureAuthTransitionEpoch()
      void refreshSessionBoundary(actionEpoch).catch(() => undefined)
    }
    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      const record = flushClockToWorkingCopy() ?? usableBootstrapRecord
      if (
        !record ||
        (!record.frozenAttempt &&
          isStudyDraftDiffEmpty(record.localDiff) &&
          isStudyDraftDiffEmpty(record.postFlightLocalDiff) &&
          !record.pendingConflict &&
          !useAppStore.getState().isDraftConflictPending)
      ) {
        return
      }
      event.preventDefault()
      event.returnValue = ''
    }
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)
    window.addEventListener('focus', handleFocus)
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [
    clockRef,
    controllerScopeKey,
    drainPendingRemoteRevision,
    enabled,
    flushClockToWorkingCopy,
    handleRemoteReconcileFailure,
    isInteractionPaused,
    lastPersistenceFailedRef,
    pendingRemoteRevisionRef,
    principalScope,
    reconcileFromServer,
    refreshSessionBoundary,
    resumeClockForCurrentRecord,
    saveNowRef,
    sessionId,
    setDraftConflictPending,
    setDraftSaveState,
    usableBootstrapRecord
  ])
}
