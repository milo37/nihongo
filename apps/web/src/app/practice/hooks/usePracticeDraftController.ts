import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { AuthenticatedUser } from '@nihongo/contracts/auth/get-current-principal'
import type { StudyDraftSnapshot } from '@nihongo/contracts/study/study-draft'
import { isApiError } from '@api/config'
import { useLatest } from '@common/hooks/useLatest'
import {
  applySaveStudyDraftBody,
  applyStudyDraftDiff,
  createEmptyStudyDraftDiff,
  diffStudyDraftSnapshots,
  isStudyDraftDiffEmpty,
  mergeStudyDraftSnapshots,
  toSaveStudyDraftBody,
  type StudyDraftLocalDiff
} from '@app/practice/draft/studyDraftMerge'
import { getStudyDraftPrincipalScope } from '@app/practice/draft/studyDraftPrincipalScope'
import { StudyQuestionClock } from '@app/practice/draft/studyQuestionClock'
import {
  createFrozenStudyDraftAttempt,
  createStudyDraftBaseDigest,
  createStudyDraftWorkingCopy,
  type StudyDraftWorkingCopy
} from '@app/practice/draft/studyDraftWorkingCopy'
import {
  clearStudyDraftWorkingCopy,
  readStudyDraftWorkingCopy,
  writeStudyDraftWorkingCopy
} from '@app/practice/draft/studyDraftWorkingCopyStorage'
import { useStudyDraftRevisionSync } from '@app/practice/draft/useStudyDraftRevisionSync'
import { useGetStudyDraft } from '@app/practice/hooks/useGetStudyDraft'
import { useSaveStudyDraft } from '@app/practice/hooks/useSaveStudyDraft'
import { fetchStudyDraftSnapshot } from '@app/practice/queries/studyDraftQueries'
import { studySessionQueries } from '@app/practice/queries/studySessionQueries'
import { serverStateQueryKeys } from '@app/serverStateQueryKeys'
import {
  assertCurrentAuthTransitionEpoch,
  captureAuthTransitionEpoch,
  isAuthTransitionSupersededError
} from '@libs/authTransitionFence'
import { emitApiError } from '@libs/errorBus'
import { useAppStore } from '@store/index'
import { isNotFoundApiError } from '@util/apiError'

export const STUDY_DRAFT_AUTOSAVE_DELAY_MS = 750

interface UsePracticeDraftControllerOptions {
  enabled: boolean
  expectedSessionQuestionIds: readonly string[]
  isInteractionPaused: boolean
  sessionId: string
  user: AuthenticatedUser | null
}

export interface PreparedStudyDraftSubmission {
  answers: StudyDraftSnapshot['answers']
  durationSec: number
  expectedDraftRevision: number
}

export interface PracticeDraftController {
  conflictCount: number
  currentOrdinal: number
  draftQuery: ReturnType<typeof useGetStudyDraft>
  elapsedSeconds: number
  flush: () => Promise<StudyDraftSnapshot>
  hasUnsavedWork: boolean
  isReady: boolean
  moveToOrdinal: (ordinal: number) => void
  prepareSubmission: () => Promise<PreparedStudyDraftSubmission>
  retrySave: () => Promise<void>
  resolveConflictWithLocal: () => void
  resolveConflictWithServer: () => void
  saveState: ReturnType<typeof useAppStore.getState>['draftSaveState']
  selectOption: (sessionQuestionId: string, optionId: string) => void
  snapshot: StudyDraftSnapshot | null
  statusMessage: string
}

const snapshotElapsedById = (
  snapshot: StudyDraftSnapshot
): Record<string, number> =>
  Object.fromEntries(
    snapshot.answers.map(({ studySessionQuestionId, elapsedSec }) => [
      studySessionQuestionId,
      elapsedSec
    ])
  )

const orderedQuestionIds = (snapshot: StudyDraftSnapshot): string[] =>
  snapshot.answers.map(({ studySessionQuestionId }) => studySessionQuestionId)

const hasExpectedSessionQuestionBoundary = (
  snapshot: StudyDraftSnapshot,
  sessionId: string,
  expectedQuestionBoundary: string | null
): boolean =>
  snapshot.studySessionId === sessionId &&
  expectedQuestionBoundary !== null &&
  JSON.stringify(orderedQuestionIds(snapshot)) === expectedQuestionBoundary

class DraftIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DraftIntegrityError'
  }
}

const hasSameQuestionBoundary = (
  expected: StudyDraftSnapshot,
  actual: StudyDraftSnapshot
): boolean =>
  expected.studySessionId === actual.studySessionId &&
  JSON.stringify(orderedQuestionIds(expected)) ===
    JSON.stringify(orderedQuestionIds(actual))

const assertSameQuestionBoundary = (
  expected: StudyDraftSnapshot,
  actual: StudyDraftSnapshot
): void => {
  if (!hasSameQuestionBoundary(expected, actual)) {
    throw new DraftIntegrityError(
      'draft 응답의 세션 문제 경계가 일치하지 않습니다.'
    )
  }
}

const areStudyDraftSnapshotsEqual = (
  first: StudyDraftSnapshot,
  second: StudyDraftSnapshot
): boolean => JSON.stringify(first) === JSON.stringify(second)

const hasValidCanonicalProgression = (
  confirmed: StudyDraftSnapshot,
  canonical: StudyDraftSnapshot
): boolean =>
  hasSameQuestionBoundary(confirmed, canonical) &&
  canonical.revision >= confirmed.revision &&
  (canonical.revision !== confirmed.revision ||
    areStudyDraftSnapshotsEqual(confirmed, canonical))

const assertCanonicalProgression = (
  confirmed: StudyDraftSnapshot,
  canonical: StudyDraftSnapshot
): void => {
  if (!hasValidCanonicalProgression(confirmed, canonical)) {
    throw new DraftIntegrityError(
      'canonical draft의 revision 또는 내용이 일치하지 않습니다.'
    )
  }
}

const getVisibleSnapshot = (
  workingCopy: StudyDraftWorkingCopy
): StudyDraftSnapshot => {
  if (!workingCopy.frozenAttempt) {
    return applyStudyDraftDiff(workingCopy.confirmedBase, workingCopy.localDiff)
  }

  const frozen = applySaveStudyDraftBody(
    workingCopy.confirmedBase,
    workingCopy.frozenAttempt.exactParsedBody
  )
  return applyStudyDraftDiff(frozen, workingCopy.postFlightLocalDiff)
}

const isWorkingCopyForScope = (
  record: StudyDraftWorkingCopy | null,
  principalScope: string,
  sessionId: string
): record is StudyDraftWorkingCopy =>
  Boolean(
    record?.principalScope === principalScope && record.sessionId === sessionId
  )

const withConfirmedBase = (
  record: StudyDraftWorkingCopy,
  confirmedBase: StudyDraftSnapshot,
  localDiff: StudyDraftLocalDiff
): StudyDraftWorkingCopy => ({
  ...record,
  confirmedBase,
  confirmedBaseDigest: createStudyDraftBaseDigest(confirmedBase),
  frozenAttempt: null,
  localDiff,
  pendingConflict: null,
  postFlightLocalDiff: createEmptyStudyDraftDiff()
})

const getStatusMessage = (
  saveState: ReturnType<typeof useAppStore.getState>['draftSaveState'],
  savedAt: string | null,
  conflictPending: boolean,
  deferredRemoteRevision: boolean
): string => {
  if (deferredRemoteRevision) {
    return '다른 탭의 최신 저장을 감지했습니다. 현재 저장 응답을 확인한 뒤 안전하게 병합합니다.'
  }

  if (conflictPending) {
    return '다른 탭의 저장을 감지했습니다. 로컬 작업을 보존한 채 충돌을 확인합니다.'
  }

  switch (saveState) {
    case 'dirty':
      return '변경 내용을 이 탭에 임시 보관했습니다.'
    case 'saving':
      return '변경 내용을 서버에 저장하고 있습니다.'
    case 'saved':
      return savedAt
        ? `서버에 저장했습니다. 마지막 저장 ${new Date(savedAt).toLocaleTimeString('ko-KR')}`
        : '서버와 동기화했습니다.'
    case 'offline':
      return '오프라인입니다. 변경 내용은 이 기기에만 임시 보관되며 연결 후 다시 저장합니다.'
    case 'conflict':
      return '다른 기기의 변경과 충돌했습니다. 서버 또는 로컬 기록을 선택해 주세요.'
    case 'error':
      return '저장하지 못했습니다. 선택한 답은 유지되며 다시 시도할 수 있습니다.'
    default:
      return '서버 작업본과 동기화되어 있습니다.'
  }
}

export const usePracticeDraftController = ({
  enabled,
  expectedSessionQuestionIds,
  isInteractionPaused,
  sessionId,
  user
}: UsePracticeDraftControllerOptions): PracticeDraftController => {
  const principalScope = getStudyDraftPrincipalScope(user)
  const controllerScopeKey = `${principalScope}:${sessionId}`
  const expectedQuestionBoundary =
    expectedSessionQuestionIds.length > 0
      ? JSON.stringify(expectedSessionQuestionIds)
      : null
  const queryClient = useQueryClient()
  const bootstrapRecord = useMemo(
    () =>
      enabled ? readStudyDraftWorkingCopy(principalScope, sessionId) : null,
    [enabled, principalScope, sessionId]
  )
  const hasValidBootstrapBoundary = Boolean(
    !bootstrapRecord ||
      hasExpectedSessionQuestionBoundary(
        bootstrapRecord.confirmedBase,
        sessionId,
        expectedQuestionBoundary
      )
  )
  const usableBootstrapRecord = hasValidBootstrapBoundary
    ? bootstrapRecord
    : null
  const [recoveredBootstrapAttemptKey, setRecoveredBootstrapAttemptKey] =
    useState<string | null>(null)
  const [deferredRemoteRevisionScope, setDeferredRemoteRevisionScope] =
    useState<string | null>(null)
  const mustReplayBeforeCanonicalGet = Boolean(
    usableBootstrapRecord?.frozenAttempt &&
      usableBootstrapRecord.frozenAttempt.idempotencyKey !==
        recoveredBootstrapAttemptKey
  )
  const draftWorkingCopy = useAppStore((state) => state.draftWorkingCopy)
  const hasScopedFrozenAttempt = Boolean(
    isWorkingCopyForScope(draftWorkingCopy, principalScope, sessionId) &&
      draftWorkingCopy.frozenAttempt
  )
  const hasScopedBlockingWork = Boolean(
    isWorkingCopyForScope(draftWorkingCopy, principalScope, sessionId) &&
      (draftWorkingCopy.frozenAttempt ||
        draftWorkingCopy.pendingConflict ||
        !isStudyDraftDiffEmpty(draftWorkingCopy.localDiff) ||
        !isStudyDraftDiffEmpty(draftWorkingCopy.postFlightLocalDiff))
  )
  const draftQuery = useGetStudyDraft(
    sessionId,
    enabled && !mustReplayBeforeCanonicalGet && !hasScopedBlockingWork
  )
  const saveMutation = useSaveStudyDraft(sessionId)
  const draftSaveState = useAppStore((state) => state.draftSaveState)
  const draftConflict = useAppStore((state) => state.draftConflict)
  const isDraftConflictPending = useAppStore(
    (state) => state.isDraftConflictPending
  )
  const setDraftWorkingCopy = useAppStore((state) => state.setDraftWorkingCopy)
  const setDraftSaveState = useAppStore((state) => state.setDraftSaveState)
  const setDraftConflict = useAppStore((state) => state.setDraftConflict)
  const setDraftConflictPending = useAppStore(
    (state) => state.setDraftConflictPending
  )
  const clockRef = useRef<StudyQuestionClock | null>(null)
  const clockScopeRef = useRef<string | null>(null)
  const interactionPausedRef = useLatest(isInteractionPaused)
  const isDrainActiveRef = useRef(false)
  const savePromiseRef = useRef<Promise<StudyDraftSnapshot> | null>(null)
  const lastPersistenceFailedRef = useRef(false)
  const pendingRemoteRevisionRef = useRef<{
    revision: number
    scopeKey: string
  } | null>(null)
  const remoteReconcilePromiseRef = useRef<{
    promise: Promise<void>
    scopeKey: string
  } | null>(null)
  const validatedCanonicalRef = useRef<{
    scopeKey: string
    snapshot: StudyDraftSnapshot
  } | null>(null)
  const integrityBlockScopeRef = useRef<string | null>(null)
  const recoveryKeyRef = useRef<string | null>(null)
  const saveNowRef = useRef<() => Promise<StudyDraftSnapshot>>(async () => {
    throw new Error('draft controller가 아직 준비되지 않았습니다.')
  })
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  useEffect(() => {
    integrityBlockScopeRef.current = null
  }, [controllerScopeKey])

  const setMemoryAndDurableRecord = useCallback(
    (record: StudyDraftWorkingCopy, state: typeof draftSaveState): boolean => {
      setDraftWorkingCopy(record)
      try {
        writeStudyDraftWorkingCopy(record)
        lastPersistenceFailedRef.current = false
        setDraftSaveState(state)
        return true
      } catch {
        lastPersistenceFailedRef.current = true
        setDraftSaveState('error')
        return false
      }
    },
    [setDraftSaveState, setDraftWorkingCopy]
  )

  const clearDurableRecordWhenClean = useCallback(
    (record: StudyDraftWorkingCopy, state: typeof draftSaveState): void => {
      setDraftWorkingCopy(record)
      clearStudyDraftWorkingCopy(record.principalScope, record.sessionId)
      lastPersistenceFailedRef.current = false
      setDraftSaveState(state)
    },
    [setDraftSaveState, setDraftWorkingCopy]
  )

  const resetClock = useCallback(
    (
      snapshot: StudyDraftSnapshot,
      previousBaseline?: StudyDraftSnapshot
    ): void => {
      const nextScope = `${principalScope}:${sessionId}`
      const currentClock = clockRef.current
      const clock =
        currentClock && clockScopeRef.current === nextScope
          ? currentClock.rebase(
              snapshotElapsedById(snapshot),
              previousBaseline
                ? snapshotElapsedById(previousBaseline)
                : undefined
            )
          : new StudyQuestionClock(snapshotElapsedById(snapshot))
      clockRef.current = clock
      clockScopeRef.current = nextScope
      if (
        enabled &&
        !isDrainActiveRef.current &&
        !interactionPausedRef.current &&
        document.visibilityState === 'visible'
      ) {
        const active = snapshot.answers[snapshot.currentOrdinal - 1]
        if (active) {
          clock.resume(active.studySessionQuestionId)
        }
      }
    },
    [enabled, interactionPausedRef, principalScope, sessionId]
  )

  const reconcile = useCallback(
    (
      record: StudyDraftWorkingCopy,
      base: StudyDraftSnapshot,
      local: StudyDraftSnapshot,
      remote: StudyDraftSnapshot,
      clockBaseline?: StudyDraftSnapshot
    ): StudyDraftWorkingCopy => {
      const merged = mergeStudyDraftSnapshots(base, local, remote)
      const chosen =
        merged.conflicts.length > 0 ? merged.localPreferred : merged.autoMerged
      const localDiff = diffStudyDraftSnapshots(remote, chosen)
      const next = withConfirmedBase(record, remote, localDiff)

      setDraftConflictPending(false)
      if (merged.conflicts.length > 0) {
        const pendingConflict = {
          base,
          conflicts: merged.conflicts,
          local,
          localPreferred: merged.localPreferred,
          remote
        }
        const nextWithConflict: StudyDraftWorkingCopy = {
          ...next,
          pendingConflict
        }
        setDraftConflict(pendingConflict)
        setMemoryAndDurableRecord(nextWithConflict, 'conflict')
        resetClock(chosen, clockBaseline)
        return nextWithConflict
      } else {
        setDraftConflict(null)
        if (isStudyDraftDiffEmpty(localDiff)) {
          clearDurableRecordWhenClean(next, 'saved')
        } else {
          setMemoryAndDurableRecord(next, 'dirty')
        }
      }
      resetClock(chosen, clockBaseline)
      return next
    },
    [
      clearDurableRecordWhenClean,
      resetClock,
      setDraftConflict,
      setDraftConflictPending,
      setMemoryAndDurableRecord
    ]
  )

  const flushClockToWorkingCopy =
    useCallback((): StudyDraftWorkingCopy | null => {
      const record = useAppStore.getState().draftWorkingCopy
      const clock = clockRef.current
      if (!isWorkingCopyForScope(record, principalScope, sessionId)) {
        return null
      }
      if (!clock) {
        return record
      }

      const elapsedById = clock.flush()
      setElapsedSeconds(clock.totalSeconds())
      const visible = getVisibleSnapshot(record)
      const answers = visible.answers.map((answer) => ({
        ...answer,
        elapsedSec:
          elapsedById[answer.studySessionQuestionId] ?? answer.elapsedSec
      }))
      const target = { ...visible, answers }

      if (areStudyDraftSnapshotsEqual(visible, target)) {
        return record
      }

      if (record.frozenAttempt) {
        const frozen = applySaveStudyDraftBody(
          record.confirmedBase,
          record.frozenAttempt.exactParsedBody
        )
        const next = {
          ...record,
          postFlightLocalDiff: diffStudyDraftSnapshots(frozen, target)
        }
        setMemoryAndDurableRecord(
          next,
          navigator.onLine === false
            ? 'offline'
            : savePromiseRef.current
              ? 'saving'
              : 'dirty'
        )
        return next
      }

      const localDiff = diffStudyDraftSnapshots(record.confirmedBase, target)
      const next = { ...record, localDiff }
      if (isStudyDraftDiffEmpty(localDiff)) {
        clearDurableRecordWhenClean(next, 'idle')
      } else {
        setMemoryAndDurableRecord(
          next,
          navigator.onLine === false ? 'offline' : 'dirty'
        )
      }
      return next
    }, [
      clearDurableRecordWhenClean,
      principalScope,
      sessionId,
      setMemoryAndDurableRecord
    ])

  const resumeClockForCurrentRecord = useCallback((): void => {
    const record = useAppStore.getState().draftWorkingCopy
    if (
      !enabled ||
      isDrainActiveRef.current ||
      interactionPausedRef.current ||
      document.visibilityState !== 'visible' ||
      !isWorkingCopyForScope(record, principalScope, sessionId)
    ) {
      return
    }

    const snapshot = getVisibleSnapshot(record)
    const active = snapshot.answers[snapshot.currentOrdinal - 1]
    if (active) {
      clockRef.current?.resume(active.studySessionQuestionId)
    }
  }, [enabled, interactionPausedRef, principalScope, sessionId])

  const withObservedClockElapsed = useCallback(
    (snapshot: StudyDraftSnapshot): StudyDraftSnapshot => {
      const clock = clockRef.current
      if (!clock) {
        return snapshot
      }
      const elapsedById = clock.flush()
      setElapsedSeconds(clock.totalSeconds())
      return {
        ...snapshot,
        answers: snapshot.answers.map((answer) => ({
          ...answer,
          elapsedSec:
            elapsedById[answer.studySessionQuestionId] ?? answer.elapsedSec
        }))
      }
    },
    []
  )

  const fetchCanonicalDraft = useCallback(
    async (
      expectedBoundary?: StudyDraftSnapshot
    ): Promise<StudyDraftSnapshot> => {
      const fetchEpoch = captureAuthTransitionEpoch()
      await queryClient.cancelQueries({
        queryKey: serverStateQueryKeys.study.draft(sessionId),
        exact: true
      })
      let canonical: StudyDraftSnapshot
      try {
        canonical = await fetchStudyDraftSnapshot(sessionId)
      } catch (error: unknown) {
        assertCurrentAuthTransitionEpoch(fetchEpoch)
        emitApiError(error)
        throw error
      }
      if (canonical.studySessionId !== sessionId) {
        throw new DraftIntegrityError(
          'canonical draft의 세션 경계가 일치하지 않습니다.'
        )
      }
      if (
        !hasExpectedSessionQuestionBoundary(
          canonical,
          sessionId,
          expectedQuestionBoundary
        )
      ) {
        throw new DraftIntegrityError(
          'canonical draft의 세션 문제 경계가 일치하지 않습니다.'
        )
      }
      if (expectedBoundary) {
        assertCanonicalProgression(expectedBoundary, canonical)
      }
      assertCurrentAuthTransitionEpoch(fetchEpoch)
      const queryKey = serverStateQueryKeys.study.draft(sessionId)
      const trusted = validatedCanonicalRef.current
      if (trusted?.scopeKey === controllerScopeKey) {
        assertSameQuestionBoundary(canonical, trusted.snapshot)
        if (
          trusted.snapshot.revision === canonical.revision &&
          !areStudyDraftSnapshotsEqual(trusted.snapshot, canonical)
        ) {
          throw new DraftIntegrityError(
            '동일 revision의 canonical draft 내용이 일치하지 않습니다.'
          )
        }
        if (trusted.snapshot.revision > canonical.revision) {
          if (expectedBoundary) {
            assertCanonicalProgression(expectedBoundary, trusted.snapshot)
          }
          integrityBlockScopeRef.current = null
          return trusted.snapshot
        }
      }
      integrityBlockScopeRef.current = null
      validatedCanonicalRef.current = {
        scopeKey: controllerScopeKey,
        snapshot: canonical
      }
      queryClient.setQueryData(queryKey, canonical)
      return canonical
    },
    [controllerScopeKey, expectedQuestionBoundary, queryClient, sessionId]
  )

  const reconcileFromServer =
    useCallback(async (): Promise<StudyDraftSnapshot | null> => {
      const actionEpoch = captureAuthTransitionEpoch()
      flushClockToWorkingCopy()
      const boundaryRecord = useAppStore.getState().draftWorkingCopy
      if (!isWorkingCopyForScope(boundaryRecord, principalScope, sessionId)) {
        return null
      }
      const remote = await fetchCanonicalDraft(boundaryRecord.confirmedBase)
      assertCurrentAuthTransitionEpoch(actionEpoch)
      flushClockToWorkingCopy()
      const record = useAppStore.getState().draftWorkingCopy
      if (!isWorkingCopyForScope(record, principalScope, sessionId)) {
        return null
      }
      assertCanonicalProgression(record.confirmedBase, remote)
      if (record.frozenAttempt) {
        const pending = pendingRemoteRevisionRef.current
        pendingRemoteRevisionRef.current = {
          revision:
            pending?.scopeKey === controllerScopeKey
              ? Math.max(pending.revision, remote.revision)
              : remote.revision,
          scopeKey: controllerScopeKey
        }
        setDeferredRemoteRevisionScope(controllerScopeKey)
        return null
      }
      if (record.pendingConflict) {
        const pending = pendingRemoteRevisionRef.current
        pendingRemoteRevisionRef.current = {
          revision:
            pending?.scopeKey === controllerScopeKey
              ? Math.max(pending.revision, remote.revision)
              : remote.revision,
          scopeKey: controllerScopeKey
        }
        setDeferredRemoteRevisionScope(controllerScopeKey)
        return null
      }
      if (integrityBlockScopeRef.current === controllerScopeKey) {
        integrityBlockScopeRef.current = null
      }
      reconcile(
        record,
        record.confirmedBase,
        getVisibleSnapshot(record),
        remote
      )
      return remote
    }, [
      controllerScopeKey,
      fetchCanonicalDraft,
      flushClockToWorkingCopy,
      principalScope,
      reconcile,
      sessionId,
      setDeferredRemoteRevisionScope
    ])

  const rememberRemoteRevision = useCallback(
    (revision: number): void => {
      const pending = pendingRemoteRevisionRef.current
      pendingRemoteRevisionRef.current = {
        revision:
          pending?.scopeKey === controllerScopeKey
            ? Math.max(pending.revision, revision)
            : revision,
        scopeKey: controllerScopeKey
      }
    },
    [controllerScopeKey]
  )

  const drainPendingRemoteRevision = useCallback((): Promise<void> => {
    const activeTask = remoteReconcilePromiseRef.current
    if (activeTask?.scopeKey === controllerScopeKey) {
      return activeTask.promise
    }

    const task = (async (): Promise<void> => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const pending = pendingRemoteRevisionRef.current
        if (!pending || pending.scopeKey !== controllerScopeKey) {
          return
        }
        const targetRevision = pending.revision

        const record = useAppStore.getState().draftWorkingCopy
        if (
          !isWorkingCopyForScope(record, principalScope, sessionId) ||
          record.frozenAttempt ||
          record.pendingConflict
        ) {
          return
        }
        if (record.confirmedBase.revision >= targetRevision) {
          pendingRemoteRevisionRef.current = null
          setDeferredRemoteRevisionScope(null)
          return
        }

        const remote = await reconcileFromServer()
        if (!remote) {
          return
        }
        if (remote.revision >= targetRevision) {
          if (
            pendingRemoteRevisionRef.current?.scopeKey === controllerScopeKey &&
            pendingRemoteRevisionRef.current.revision <= remote.revision
          ) {
            pendingRemoteRevisionRef.current = null
            setDeferredRemoteRevisionScope(null)
          }
          continue
        }
      }

      throw new Error('다른 탭의 최신 revision을 확인하지 못했습니다.')
    })()
    remoteReconcilePromiseRef.current = {
      promise: task,
      scopeKey: controllerScopeKey
    }
    const clearTask = (): void => {
      if (remoteReconcilePromiseRef.current?.promise === task) {
        remoteReconcilePromiseRef.current = null
      }
    }
    void task.then(clearTask, clearTask)
    return task
  }, [
    controllerScopeKey,
    principalScope,
    reconcileFromServer,
    sessionId,
    setDeferredRemoteRevisionScope
  ])

  const clearScopedWorkingCopy = useCallback((): void => {
    const current = useAppStore.getState().draftWorkingCopy
    if (!isWorkingCopyForScope(current, principalScope, sessionId)) {
      return
    }

    clearStudyDraftWorkingCopy(principalScope, sessionId)
    setDraftWorkingCopy(null)
    setDraftConflict(null)
    setDraftConflictPending(false)
    setDraftSaveState('idle')
    lastPersistenceFailedRef.current = false
    if (pendingRemoteRevisionRef.current?.scopeKey === controllerScopeKey) {
      pendingRemoteRevisionRef.current = null
    }
    queryClient.removeQueries({
      queryKey: serverStateQueryKeys.study.draft(sessionId),
      exact: true
    })
  }, [
    controllerScopeKey,
    principalScope,
    queryClient,
    sessionId,
    setDraftConflict,
    setDraftConflictPending,
    setDraftSaveState,
    setDraftWorkingCopy
  ])

  const refreshSessionBoundary = useCallback(
    async (actionEpoch: number): Promise<boolean> => {
      await queryClient.cancelQueries({
        queryKey: serverStateQueryKeys.study.session(sessionId),
        exact: true
      })
      try {
        const session = await queryClient.fetchQuery({
          ...studySessionQueries.session(sessionId),
          staleTime: 0
        })
        assertCurrentAuthTransitionEpoch(actionEpoch)
        if (session.session.status === 'IN_PROGRESS') {
          return false
        }
        clearScopedWorkingCopy()
        return true
      } catch (sessionError: unknown) {
        assertCurrentAuthTransitionEpoch(actionEpoch)
        if (isNotFoundApiError(sessionError)) {
          clearScopedWorkingCopy()
          return true
        }
        throw sessionError
      }
    },
    [clearScopedWorkingCopy, queryClient, sessionId]
  )

  const settleTerminalSession = useCallback(
    async (error: unknown, actionEpoch: number): Promise<boolean> => {
      if (!isApiError(error)) {
        return false
      }
      const code = error.code
      if (
        code !== 'RESOURCE_NOT_FOUND' &&
        code !== 'STUDY_SESSION_NOT_EDITABLE'
      ) {
        return false
      }

      try {
        return await refreshSessionBoundary(actionEpoch)
      } catch {
        return false
      }
    },
    [refreshSessionBoundary]
  )

  const handleRemoteReconcileFailure = useCallback(
    (error: unknown): void => {
      const actionEpoch = captureAuthTransitionEpoch()
      void (async (): Promise<void> => {
        if (isAuthTransitionSupersededError(error)) {
          return
        }
        if (await settleTerminalSession(error, actionEpoch)) {
          return
        }
        const current = useAppStore.getState().draftWorkingCopy
        if (!isWorkingCopyForScope(current, principalScope, sessionId)) {
          return
        }
        if (error instanceof DraftIntegrityError) {
          integrityBlockScopeRef.current = controllerScopeKey
        }
        setDraftConflictPending(
          error instanceof DraftIntegrityError ||
            integrityBlockScopeRef.current === controllerScopeKey
        )
        setDraftSaveState(
          isApiError(error) && (error.isOffline || error.isNetworkError)
            ? 'offline'
            : 'error'
        )
      })()
    },
    [
      controllerScopeKey,
      principalScope,
      sessionId,
      setDraftConflictPending,
      setDraftSaveState,
      settleTerminalSession
    ]
  )

  const hasWorkingCopyWork = Boolean(
    isWorkingCopyForScope(draftWorkingCopy, principalScope, sessionId) &&
      (draftWorkingCopy.frozenAttempt ||
        !isStudyDraftDiffEmpty(draftWorkingCopy.localDiff) ||
        !isStudyDraftDiffEmpty(draftWorkingCopy.postFlightLocalDiff) ||
        Boolean(draftWorkingCopy.pendingConflict))
  )

  const publishRevision = useStudyDraftRevisionSync({
    enabled,
    isDirty:
      hasWorkingCopyWork || Boolean(draftConflict) || isDraftConflictPending,
    onCleanSignal: (signal) => {
      rememberRemoteRevision(signal.revision)
      const record = useAppStore.getState().draftWorkingCopy
      if (
        !isWorkingCopyForScope(record, principalScope, sessionId) ||
        record.confirmedBase.revision >= signal.revision
      ) {
        return
      }
      if (record.frozenAttempt) {
        setDeferredRemoteRevisionScope(controllerScopeKey)
        return
      }
      if (record.pendingConflict) {
        setDeferredRemoteRevisionScope(controllerScopeKey)
        return
      }
      void drainPendingRemoteRevision().catch(handleRemoteReconcileFailure)
    },
    onDirtySignal: (signal) => {
      rememberRemoteRevision(signal.revision)
      const record = useAppStore.getState().draftWorkingCopy
      if (
        !isWorkingCopyForScope(record, principalScope, sessionId) ||
        record.confirmedBase.revision >= signal.revision
      ) {
        return
      }
      if (record.frozenAttempt) {
        setDeferredRemoteRevisionScope(controllerScopeKey)
        return
      }
      if (record.pendingConflict) {
        setDeferredRemoteRevisionScope(controllerScopeKey)
        return
      }
      setDraftConflictPending(true)
      setDraftSaveState('conflict')
      void drainPendingRemoteRevision().catch(handleRemoteReconcileFailure)
    },
    onFallbackRefresh: () => {
      const record = useAppStore.getState().draftWorkingCopy
      if (!isWorkingCopyForScope(record, principalScope, sessionId)) {
        const actionEpoch = captureAuthTransitionEpoch()
        void refreshSessionBoundary(actionEpoch).catch(() => undefined)
        return
      }
      if (record.frozenAttempt) {
        void saveNowRef.current().catch(handleRemoteReconcileFailure)
        return
      }
      if (record.pendingConflict) {
        return
      }
      if (isStudyDraftDiffEmpty(record.localDiff) && !record.frozenAttempt) {
        void reconcileFromServer().catch(handleRemoteReconcileFailure)
      } else {
        setDraftConflictPending(true)
        setDraftSaveState('conflict')
        void reconcileFromServer().catch(handleRemoteReconcileFailure)
      }
    },
    principalScope,
    sessionId
  })

  const completeSave = useCallback(
    async (
      record: StudyDraftWorkingCopy,
      actionEpoch: number
    ): Promise<StudyDraftSnapshot> => {
      const frozen = record.frozenAttempt
      if (!frozen) {
        return record.confirmedBase
      }

      const acknowledgement = await saveMutation.mutateAsync({
        body: frozen.exactParsedBody,
        idempotencyKey: frozen.idempotencyKey
      })
      assertCurrentAuthTransitionEpoch(actionEpoch)
      const expectedAcknowledgement = applySaveStudyDraftBody(
        record.confirmedBase,
        frozen.exactParsedBody
      )
      if (
        acknowledgement.data.revision !==
          frozen.exactParsedBody.expectedRevision + 1 ||
        acknowledgement.data.currentOrdinal !==
          frozen.exactParsedBody.currentOrdinal ||
        JSON.stringify(acknowledgement.data.answers) !==
          JSON.stringify(frozen.exactParsedBody.answers)
      ) {
        throw new DraftIntegrityError(
          'draft 저장 acknowledgement가 frozen 요청과 다릅니다.'
        )
      }
      assertSameQuestionBoundary(expectedAcknowledgement, acknowledgement.data)
      const canonical = await fetchCanonicalDraft(acknowledgement.data)
      assertCurrentAuthTransitionEpoch(actionEpoch)

      const latestRecord = useAppStore.getState().draftWorkingCopy
      if (
        !isWorkingCopyForScope(latestRecord, principalScope, sessionId) ||
        latestRecord.frozenAttempt?.idempotencyKey !== frozen.idempotencyKey
      ) {
        throw new Error('저장 중 작업본 경계가 바뀌었습니다.')
      }

      const explicitLocal = applyStudyDraftDiff(
        acknowledgement.data,
        latestRecord.postFlightLocalDiff
      )
      const observedLocal = withObservedClockElapsed(explicitLocal)
      const observedMerge = mergeStudyDraftSnapshots(
        acknowledgement.data,
        observedLocal,
        canonical
      )
      const local =
        observedMerge.conflicts.length > 0 ? observedLocal : explicitLocal
      const next = reconcile(
        latestRecord,
        acknowledgement.data,
        local,
        canonical,
        local
      )
      setRecoveredBootstrapAttemptKey(frozen.idempotencyKey)
      publishRevision(canonical.revision)
      return getVisibleSnapshot(next)
    },
    [
      fetchCanonicalDraft,
      principalScope,
      publishRevision,
      reconcile,
      saveMutation,
      sessionId,
      withObservedClockElapsed
    ]
  )

  const performSave = useCallback(async (): Promise<StudyDraftSnapshot> => {
    if (savePromiseRef.current) {
      return savePromiseRef.current
    }

    const task = (async (): Promise<StudyDraftSnapshot> => {
      let record = flushClockToWorkingCopy()
      if (!record) {
        throw new Error('저장할 작업본이 없습니다.')
      }
      const pendingRemoteRevision = pendingRemoteRevisionRef.current
      if (
        !record.frozenAttempt &&
        pendingRemoteRevision?.scopeKey === controllerScopeKey &&
        pendingRemoteRevision.revision > record.confirmedBase.revision
      ) {
        await drainPendingRemoteRevision()
        record = flushClockToWorkingCopy()
        if (!record) {
          throw new Error('원격 revision 확인 중 작업본 경계가 바뀌었습니다.')
        }
      }
      const currentState = useAppStore.getState()
      if (
        record.pendingConflict ||
        currentState.draftConflict ||
        currentState.isDraftConflictPending
      ) {
        throw new Error('충돌을 해결한 뒤 저장해 주세요.')
      }

      const actionEpoch = captureAuthTransitionEpoch()
      assertCurrentAuthTransitionEpoch(actionEpoch)

      if (!record.frozenAttempt) {
        if (isStudyDraftDiffEmpty(record.localDiff)) {
          return record.confirmedBase
        }

        if (navigator.onLine === false) {
          setMemoryAndDurableRecord(record, 'offline')
          throw new Error(
            '오프라인에서는 서버 작업본을 저장할 수 없습니다. 연결 후 다시 시도해 주세요.'
          )
        }

        const body = toSaveStudyDraftBody(
          record.confirmedBase,
          record.localDiff
        )
        const frozenAttempt = createFrozenStudyDraftAttempt({
          body,
          idempotencyKey: crypto.randomUUID(),
          sessionId
        })
        const frozenRecord: StudyDraftWorkingCopy = {
          ...record,
          frozenAttempt,
          localDiff: createEmptyStudyDraftDiff(),
          postFlightLocalDiff: createEmptyStudyDraftDiff()
        }
        if (!setMemoryAndDurableRecord(frozenRecord, 'saving')) {
          throw new Error(
            '작업본을 보존하지 못해 서버 요청을 보내지 않았습니다.'
          )
        }
        assertCurrentAuthTransitionEpoch(actionEpoch)
        record = frozenRecord
      } else {
        setDraftSaveState('saving')
      }

      try {
        writeStudyDraftWorkingCopy(record)
        lastPersistenceFailedRef.current = false
      } catch {
        lastPersistenceFailedRef.current = true
        setDraftSaveState('error')
        throw new Error('작업본을 보존하지 못해 서버 요청을 보내지 않았습니다.')
      }

      try {
        return await completeSave(record, actionEpoch)
      } catch (error: unknown) {
        if (isAuthTransitionSupersededError(error)) {
          throw error
        }
        let failure = error
        if (isApiError(error) && error.code === 'DRAFT_VERSION_CONFLICT') {
          try {
            flushClockToWorkingCopy()
            const boundaryRecord = useAppStore.getState().draftWorkingCopy
            if (
              !isWorkingCopyForScope(boundaryRecord, principalScope, sessionId)
            ) {
              throw error
            }
            const remote = await fetchCanonicalDraft(
              boundaryRecord.confirmedBase
            )
            if (remote.revision <= boundaryRecord.confirmedBase.revision) {
              throw new DraftIntegrityError(
                '충돌 뒤 canonical draft revision이 앞으로 이동하지 않았습니다.'
              )
            }
            assertCurrentAuthTransitionEpoch(actionEpoch)
            flushClockToWorkingCopy()
            const latest = useAppStore.getState().draftWorkingCopy
            if (!isWorkingCopyForScope(latest, principalScope, sessionId)) {
              throw error
            }
            const attemptedKey = latest.frozenAttempt?.idempotencyKey
            if (!attemptedKey) {
              throw error
            }
            const local = getVisibleSnapshot(latest)
            const reconciled = reconcile(
              latest,
              latest.confirmedBase,
              local,
              remote,
              local
            )
            setRecoveredBootstrapAttemptKey(attemptedKey)
            return getVisibleSnapshot(reconciled)
          } catch (reconcileError: unknown) {
            failure = reconcileError
          }
        }

        if (isAuthTransitionSupersededError(failure)) {
          throw failure
        }
        if (await settleTerminalSession(failure, actionEpoch)) {
          throw failure
        }

        if (useAppStore.getState().draftConflict) {
          throw failure
        }
        const current = useAppStore.getState().draftWorkingCopy
        if (isWorkingCopyForScope(current, principalScope, sessionId)) {
          if (failure instanceof DraftIntegrityError) {
            integrityBlockScopeRef.current = controllerScopeKey
          }
          setDraftConflictPending(
            failure instanceof DraftIntegrityError ||
              integrityBlockScopeRef.current === controllerScopeKey
          )
          setDraftSaveState(
            isApiError(failure) && (failure.isOffline || failure.isNetworkError)
              ? 'offline'
              : 'error'
          )
        }
        throw failure
      }
    })()

    savePromiseRef.current = task
    try {
      return await task
    } finally {
      savePromiseRef.current = null
    }
  }, [
    completeSave,
    controllerScopeKey,
    drainPendingRemoteRevision,
    fetchCanonicalDraft,
    flushClockToWorkingCopy,
    principalScope,
    reconcile,
    sessionId,
    settleTerminalSession,
    setDraftSaveState,
    setDraftConflictPending,
    setMemoryAndDurableRecord
  ])

  useEffect(() => {
    saveNowRef.current = performSave
  }, [performSave])

  useEffect(() => {
    if (!enabled || !usableBootstrapRecord?.frozenAttempt) {
      return
    }

    const current = useAppStore.getState().draftWorkingCopy
    if (!isWorkingCopyForScope(current, principalScope, sessionId)) {
      setDraftWorkingCopy(usableBootstrapRecord)
      setDraftSaveState('saving')
      resetClock(getVisibleSnapshot(usableBootstrapRecord))
    }
    const recoveryKey = `${sessionId}:${usableBootstrapRecord.frozenAttempt.idempotencyKey}`
    if (recoveryKeyRef.current !== recoveryKey) {
      recoveryKeyRef.current = recoveryKey
      void saveNowRef.current().catch(() => undefined)
    }
  }, [
    enabled,
    principalScope,
    resetClock,
    sessionId,
    setDraftSaveState,
    setDraftWorkingCopy,
    usableBootstrapRecord
  ])

  useEffect(() => {
    if (!enabled || !bootstrapRecord || hasValidBootstrapBoundary) {
      return
    }
    clearStudyDraftWorkingCopy(principalScope, sessionId)
  }, [
    bootstrapRecord,
    enabled,
    hasValidBootstrapBoundary,
    principalScope,
    sessionId
  ])

  useEffect(() => {
    if (
      !enabled ||
      hasScopedFrozenAttempt ||
      pendingRemoteRevisionRef.current?.scopeKey !== controllerScopeKey ||
      !isWorkingCopyForScope(draftWorkingCopy, principalScope, sessionId)
    ) {
      return
    }

    void drainPendingRemoteRevision().catch(handleRemoteReconcileFailure)
  }, [
    draftWorkingCopy,
    controllerScopeKey,
    drainPendingRemoteRevision,
    enabled,
    handleRemoteReconcileFailure,
    hasScopedFrozenAttempt,
    principalScope,
    sessionId
  ])

  useEffect(() => {
    if (!enabled || !draftQuery.data || mustReplayBeforeCanonicalGet) {
      return
    }

    if (
      !hasExpectedSessionQuestionBoundary(
        draftQuery.data,
        sessionId,
        expectedQuestionBoundary
      )
    ) {
      integrityBlockScopeRef.current = controllerScopeKey
      setDraftConflictPending(true)
      setDraftSaveState('error')
      return
    }

    const currentRecord = isWorkingCopyForScope(
      draftWorkingCopy,
      principalScope,
      sessionId
    )
      ? flushClockToWorkingCopy()
      : null

    if (currentRecord) {
      if (currentRecord.frozenAttempt) {
        return
      }
      if (currentRecord.pendingConflict) {
        setDraftConflict(currentRecord.pendingConflict)
        setDraftConflictPending(false)
        setDraftSaveState('conflict')
        resetClock(getVisibleSnapshot(currentRecord))
        return
      }
      if (
        !hasValidCanonicalProgression(
          currentRecord.confirmedBase,
          draftQuery.data
        )
      ) {
        integrityBlockScopeRef.current = controllerScopeKey
        setDraftConflictPending(true)
        setDraftSaveState('error')
        return
      }
      const clockScope = `${principalScope}:${sessionId}`
      if (!clockRef.current || clockScopeRef.current !== clockScope) {
        resetClock(getVisibleSnapshot(currentRecord))
      }
      if (currentRecord.confirmedBase.revision !== draftQuery.data.revision) {
        reconcile(
          currentRecord,
          currentRecord.confirmedBase,
          getVisibleSnapshot(currentRecord),
          draftQuery.data
        )
      }
      return
    }

    const stored = usableBootstrapRecord
    if (!stored) {
      const record = createStudyDraftWorkingCopy({
        confirmedBase: draftQuery.data,
        principalScope,
        sessionId
      })
      integrityBlockScopeRef.current = null
      setDraftWorkingCopy(record)
      setDraftConflict(null)
      setDraftConflictPending(false)
      setDraftSaveState('idle')
      resetClock(draftQuery.data)
      return
    }

    setDraftWorkingCopy(stored)
    resetClock(getVisibleSnapshot(stored))
    if (!hasValidCanonicalProgression(stored.confirmedBase, draftQuery.data)) {
      integrityBlockScopeRef.current = controllerScopeKey
      setDraftConflictPending(true)
      setDraftSaveState('error')
      return
    }
    integrityBlockScopeRef.current = null
    if (stored.pendingConflict) {
      setDraftConflict(stored.pendingConflict)
      setDraftConflictPending(false)
      setDraftSaveState('conflict')
      return
    }
    const local = applyStudyDraftDiff(stored.confirmedBase, stored.localDiff)
    reconcile(stored, stored.confirmedBase, local, draftQuery.data)
  }, [
    controllerScopeKey,
    draftQuery.data,
    draftWorkingCopy,
    enabled,
    expectedQuestionBoundary,
    flushClockToWorkingCopy,
    mustReplayBeforeCanonicalGet,
    principalScope,
    reconcile,
    resetClock,
    sessionId,
    setDraftSaveState,
    setDraftConflict,
    setDraftConflictPending,
    setDraftWorkingCopy,
    usableBootstrapRecord
  ])

  useEffect(() => {
    if (!enabled || !draftQuery.isError || !draftQuery.error) {
      return
    }
    const current = useAppStore.getState().draftWorkingCopy
    if (!isWorkingCopyForScope(current, principalScope, sessionId)) {
      return
    }
    const actionEpoch = captureAuthTransitionEpoch()
    void (async (): Promise<void> => {
      if (await settleTerminalSession(draftQuery.error, actionEpoch)) {
        return
      }
      const latest = useAppStore.getState().draftWorkingCopy
      if (!isWorkingCopyForScope(latest, principalScope, sessionId)) {
        return
      }
      setDraftSaveState(
        isApiError(draftQuery.error) &&
          (draftQuery.error.isOffline || draftQuery.error.isNetworkError)
          ? 'offline'
          : 'error'
      )
    })()
  }, [
    draftQuery.error,
    draftQuery.isError,
    enabled,
    principalScope,
    sessionId,
    setDraftSaveState,
    settleTerminalSession
  ])

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

    const timerId = window.setTimeout(() => {
      void saveNowRef.current().catch(() => undefined)
    }, STUDY_DRAFT_AUTOSAVE_DELAY_MS)
    return () => window.clearTimeout(timerId)
  }, [
    controllerScopeKey,
    deferredRemoteRevisionScope,
    draftConflict,
    draftSaveState,
    draftWorkingCopy,
    enabled
  ])

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
    controllerScopeKey,
    drainPendingRemoteRevision,
    enabled,
    flushClockToWorkingCopy,
    handleRemoteReconcileFailure,
    isInteractionPaused,
    principalScope,
    reconcileFromServer,
    refreshSessionBoundary,
    resumeClockForCurrentRecord,
    sessionId,
    setDraftConflictPending,
    setDraftSaveState,
    usableBootstrapRecord
  ])

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
  }, [enabled])

  const updateVisibleSnapshot = (
    update: (snapshot: StudyDraftSnapshot) => StudyDraftSnapshot
  ): void => {
    const record = flushClockToWorkingCopy()
    if (
      !record ||
      record.pendingConflict ||
      draftConflict ||
      isDraftConflictPending
    ) {
      return
    }

    const visible = getVisibleSnapshot(record)
    const target = update(visible)
    if (record.frozenAttempt) {
      const frozen = applySaveStudyDraftBody(
        record.confirmedBase,
        record.frozenAttempt.exactParsedBody
      )
      setMemoryAndDurableRecord(
        {
          ...record,
          postFlightLocalDiff: diffStudyDraftSnapshots(frozen, target)
        },
        navigator.onLine === false
          ? 'offline'
          : savePromiseRef.current
            ? 'saving'
            : 'dirty'
      )
      return
    }

    const localDiff = diffStudyDraftSnapshots(record.confirmedBase, target)
    const next = { ...record, localDiff }
    if (isStudyDraftDiffEmpty(localDiff)) {
      clearDurableRecordWhenClean(next, 'idle')
    } else {
      setMemoryAndDurableRecord(
        next,
        navigator.onLine === false ? 'offline' : 'dirty'
      )
    }
  }

  const resolveConflictWithServer = (): void => {
    const conflict = useAppStore.getState().draftConflict
    const record = useAppStore.getState().draftWorkingCopy
    if (
      !conflict ||
      !isWorkingCopyForScope(record, principalScope, sessionId)
    ) {
      return
    }
    const next = withConfirmedBase(
      record,
      conflict.remote,
      createEmptyStudyDraftDiff()
    )
    setDraftConflict(null)
    setDraftConflictPending(false)
    clearDurableRecordWhenClean(next, 'saved')
    resetClock(conflict.remote)
  }

  const resolveConflictWithLocal = (): void => {
    const conflict = useAppStore.getState().draftConflict
    const record = useAppStore.getState().draftWorkingCopy
    if (
      !conflict ||
      !isWorkingCopyForScope(record, principalScope, sessionId)
    ) {
      return
    }
    const localDiff = diffStudyDraftSnapshots(
      conflict.remote,
      conflict.localPreferred
    )
    const next = withConfirmedBase(record, conflict.remote, localDiff)
    setDraftConflict(null)
    setDraftConflictPending(false)
    if (isStudyDraftDiffEmpty(localDiff)) {
      clearDurableRecordWhenClean(next, 'saved')
    } else {
      setMemoryAndDurableRecord(next, 'dirty')
    }
    resetClock(conflict.localPreferred)
  }

  const flush = async (): Promise<StudyDraftSnapshot> => {
    isDrainActiveRef.current = true
    clockRef.current?.pause()
    try {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const record = flushClockToWorkingCopy()
        if (!record) {
          throw new Error('학습 draft가 준비되지 않았습니다.')
        }
        const currentState = useAppStore.getState()
        if (
          record.pendingConflict ||
          currentState.draftConflict ||
          currentState.isDraftConflictPending
        ) {
          throw new Error('다른 기기의 변경 충돌을 해결한 뒤 저장해 주세요.')
        }
        const needsSave = Boolean(
          record.frozenAttempt ||
            !isStudyDraftDiffEmpty(record.localDiff) ||
            !isStudyDraftDiffEmpty(record.postFlightLocalDiff)
        )
        if (!needsSave) {
          await drainPendingRemoteRevision()
          const latest = useAppStore.getState()
          if (
            latest.draftWorkingCopy?.pendingConflict ||
            latest.draftConflict ||
            latest.isDraftConflictPending
          ) {
            throw new Error('다른 기기의 변경 충돌을 해결한 뒤 저장해 주세요.')
          }
          const refreshed = latest.draftWorkingCopy
          if (!isWorkingCopyForScope(refreshed, principalScope, sessionId)) {
            throw new Error('학습 draft 경계가 바뀌었습니다.')
          }
          if (
            refreshed.frozenAttempt ||
            refreshed.pendingConflict ||
            !isStudyDraftDiffEmpty(refreshed.localDiff) ||
            !isStudyDraftDiffEmpty(refreshed.postFlightLocalDiff)
          ) {
            continue
          }
          return refreshed.confirmedBase
        }
        await saveNowRef.current()
      }
      throw new Error(
        '연속 편집 저장을 완료하지 못했습니다. 다시 시도해 주세요.'
      )
    } finally {
      isDrainActiveRef.current = false
      resumeClockForCurrentRecord()
    }
  }

  const prepareSubmission = async (): Promise<PreparedStudyDraftSubmission> => {
    const snapshot = await flush()
    const currentState = useAppStore.getState()
    if (
      currentState.draftWorkingCopy?.pendingConflict ||
      currentState.draftConflict ||
      currentState.isDraftConflictPending
    ) {
      throw new Error('다른 기기의 변경 충돌을 해결한 뒤 제출해 주세요.')
    }
    return {
      answers: snapshot.answers,
      durationSec: snapshot.answers.reduce(
        (total, answer) => total + answer.elapsedSec,
        0
      ),
      expectedDraftRevision: snapshot.revision
    }
  }

  const scopedWorkingCopy = isWorkingCopyForScope(
    draftWorkingCopy,
    principalScope,
    sessionId
  )
    ? draftWorkingCopy
    : null
  const snapshot = scopedWorkingCopy
    ? getVisibleSnapshot(scopedWorkingCopy)
    : null
  const hasUnsavedWork = Boolean(
    hasWorkingCopyWork || draftConflict || isDraftConflictPending
  )

  return {
    conflictCount: draftConflict?.conflicts.length ?? 0,
    currentOrdinal: snapshot?.currentOrdinal ?? 1,
    draftQuery,
    elapsedSeconds,
    flush,
    hasUnsavedWork,
    isReady: !enabled || Boolean(snapshot),
    moveToOrdinal: (ordinal) => {
      updateVisibleSnapshot((current) => ({
        ...current,
        currentOrdinal: Math.max(1, Math.min(current.answers.length, ordinal))
      }))
      resumeClockForCurrentRecord()
    },
    prepareSubmission,
    retrySave: async () => {
      const currentState = useAppStore.getState()
      const current = currentState.draftWorkingCopy
      if (!isWorkingCopyForScope(current, principalScope, sessionId)) {
        try {
          const canonical = await fetchCanonicalDraft()
          const record = createStudyDraftWorkingCopy({
            confirmedBase: canonical,
            principalScope,
            sessionId
          })
          integrityBlockScopeRef.current = null
          setDraftConflict(null)
          setDraftConflictPending(false)
          setDraftWorkingCopy(record)
          setDraftSaveState('idle')
          resetClock(canonical)
        } catch (error: unknown) {
          handleRemoteReconcileFailure(error)
          throw error
        }
        return
      }
      if (
        !current.frozenAttempt &&
        !current.pendingConflict &&
        (currentState.isDraftConflictPending ||
          (isStudyDraftDiffEmpty(current.localDiff) &&
            isStudyDraftDiffEmpty(current.postFlightLocalDiff)))
      ) {
        setDraftConflictPending(true)
        setDraftSaveState('conflict')
        try {
          await reconcileFromServer()
        } catch (error: unknown) {
          handleRemoteReconcileFailure(error)
          throw error
        }
        return
      }
      await flush()
    },
    resolveConflictWithLocal,
    resolveConflictWithServer,
    saveState: draftSaveState,
    selectOption: (sessionQuestionId, optionId) => {
      updateVisibleSnapshot((current) => ({
        ...current,
        answers: current.answers.map((answer) =>
          answer.studySessionQuestionId === sessionQuestionId
            ? { ...answer, selectedOptionId: optionId }
            : answer
        )
      }))
    },
    snapshot,
    statusMessage: getStatusMessage(
      draftSaveState,
      scopedWorkingCopy?.confirmedBase.savedAt ?? null,
      isDraftConflictPending,
      deferredRemoteRevisionScope === controllerScopeKey
    )
  }
}
