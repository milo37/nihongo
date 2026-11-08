import type { StudyDraftSnapshot } from '@nihongo/contracts/study/study-draft'
import {
  applySaveStudyDraftBody,
  applyStudyDraftDiff,
  createEmptyStudyDraftDiff,
  type StudyDraftLocalDiff
} from '@nihongo/browser/app/practice/draft/studyDraftMerge'
import {
  createStudyDraftBaseDigest,
  type StudyDraftWorkingCopy
} from '@nihongo/browser/app/practice/draft/studyDraftWorkingCopy'
import type { useAppStore } from '@nihongo/browser/store/index'

// Pure draft-controller rules shared by usePracticeDraftController and its effect hooks.
export const STUDY_DRAFT_AUTOSAVE_DELAY_MS = 2_000
export const STUDY_DRAFT_AUTOSAVE_MAX_WAIT_MS = 10_000
export const STUDY_DRAFT_SAVE_MIN_GAP_MS = 5_000

export interface StudyDraftSaveTiming {
  scopeKey: string
  active: boolean
  firstUnsentAt: number | null
  lastEditAt: number
  lastPutStartedAt: number
  unsentSignature: string
  cooldownUntil: number
  rateLimitFailure: unknown
  resumeDelay: (() => void) | null
}

export type StudyDraftSavePacing = Pick<
  StudyDraftSaveTiming,
  'scopeKey' | 'lastPutStartedAt' | 'cooldownUntil' | 'rateLimitFailure'
> & { authEpoch: number }

export const savePacingQueryKey = ['study', 'draft-save-pacing'] as const

export interface PreparedStudyDraftSubmission {
  answers: StudyDraftSnapshot['answers']
  durationSec: number
}

export type PracticeDraftStatusCode =
  | 'remoteDeferred'
  | 'reconciled'
  | 'conflictPending'
  | 'dirty'
  | 'saving'
  | 'savedAt'
  | 'saved'
  | 'offline'
  | 'conflict'
  | 'error'
  | 'synced'

export interface PracticeDraftStatus {
  readonly code: PracticeDraftStatusCode
  readonly savedAt?: string
}

export const snapshotElapsedById = (
  snapshot: StudyDraftSnapshot
): Record<string, number> =>
  Object.fromEntries(
    snapshot.answers.map(({ studySessionQuestionId, elapsedSec }) => [
      studySessionQuestionId,
      elapsedSec
    ])
  )

export const orderedQuestionIds = (snapshot: StudyDraftSnapshot): string[] =>
  snapshot.answers.map(({ studySessionQuestionId }) => studySessionQuestionId)

export const hasExpectedSessionQuestionBoundary = (
  snapshot: StudyDraftSnapshot,
  sessionId: string,
  expectedQuestionBoundary: string | null
): boolean =>
  snapshot.studySessionId === sessionId &&
  expectedQuestionBoundary !== null &&
  JSON.stringify(orderedQuestionIds(snapshot)) === expectedQuestionBoundary

export class DraftIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DraftIntegrityError'
  }
}

export const hasSameQuestionBoundary = (
  expected: StudyDraftSnapshot,
  actual: StudyDraftSnapshot
): boolean =>
  expected.studySessionId === actual.studySessionId &&
  JSON.stringify(orderedQuestionIds(expected)) ===
    JSON.stringify(orderedQuestionIds(actual))

export const assertSameQuestionBoundary = (
  expected: StudyDraftSnapshot,
  actual: StudyDraftSnapshot
): void => {
  if (!hasSameQuestionBoundary(expected, actual)) {
    throw new DraftIntegrityError(
      'draft 응답의 세션 문제 경계가 일치하지 않습니다.'
    )
  }
}

export const areStudyDraftSnapshotsEqual = (
  first: StudyDraftSnapshot,
  second: StudyDraftSnapshot
): boolean => JSON.stringify(first) === JSON.stringify(second)

export const hasValidCanonicalProgression = (
  confirmed: StudyDraftSnapshot,
  canonical: StudyDraftSnapshot
): boolean =>
  hasSameQuestionBoundary(confirmed, canonical) &&
  canonical.revision >= confirmed.revision &&
  (canonical.revision !== confirmed.revision ||
    areStudyDraftSnapshotsEqual(confirmed, canonical))

export const assertCanonicalProgression = (
  confirmed: StudyDraftSnapshot,
  canonical: StudyDraftSnapshot
): void => {
  if (!hasValidCanonicalProgression(confirmed, canonical)) {
    throw new DraftIntegrityError(
      'canonical draft의 revision 또는 내용이 일치하지 않습니다.'
    )
  }
}

export const getVisibleSnapshot = (
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

export const isWorkingCopyForScope = (
  record: StudyDraftWorkingCopy | null,
  principalScope: string,
  sessionId: string
): record is StudyDraftWorkingCopy =>
  Boolean(
    record?.principalScope === principalScope && record.sessionId === sessionId
  )

export const withConfirmedBase = (
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

export const getStatus = (
  saveState: ReturnType<typeof useAppStore.getState>['draftSaveState'],
  savedAt: string | null,
  conflictPending: boolean,
  deferredRemoteRevision: boolean,
  reconciled: boolean
): PracticeDraftStatus => {
  if (saveState === 'offline' || saveState === 'error') {
    return { code: saveState }
  }

  if (deferredRemoteRevision) {
    return { code: 'remoteDeferred' }
  }

  if (conflictPending) {
    return { code: 'conflictPending' }
  }

  switch (saveState) {
    case 'dirty':
      return { code: 'dirty' }
    case 'saving':
      return { code: 'saving' }
    case 'saved':
      if (reconciled) return { code: 'reconciled' }
      return savedAt ? { code: 'savedAt', savedAt } : { code: 'saved' }
    case 'conflict':
      return { code: 'conflict' }
    default:
      return { code: 'synced' }
  }
}
