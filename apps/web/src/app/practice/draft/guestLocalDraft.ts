import type { StudyDraftSnapshot } from '@nihongo/contracts/study/study-draft'
import type { ParsedSaveStudyDraftAnswersRequest } from '@nihongo/browser/api/study/saveStudyDraftAnswers/schema'
import type { SaveStudyDraftAnswersTransportResponse } from '@nihongo/browser/api/study/saveStudyDraftAnswers/schema'
import { getStudySessionV2 } from '@api/study/getStudySessionV2'
import { useAppStore } from '@nihongo/browser/store/index'

/**
 * A guest's answers are not kept on the server (U4, BE #765): the draft
 * APIs answer 401 for guests. The session screen still works on a draft,
 * so for a guest it lives here, in memory, and is lost on reload. Submit
 * then sends expectedDraftRevision 0 with the answers on screen.
 */
const drafts = new Map<string, StudyDraftSnapshot>()

export const isGuestPrincipal = (): boolean =>
  useAppStore.getState().currentUser === null

const createBase = async (
  sessionId: string,
  signal?: AbortSignal
): Promise<StudyDraftSnapshot> => {
  const { data } = await getStudySessionV2(sessionId, signal)
  return {
    studySessionId: sessionId,
    revision: 0,
    currentOrdinal: 1,
    savedAt: null,
    answers: data.questions.map((question) => ({
      studySessionQuestionId: question.sessionQuestionId,
      selectedOptionId: null,
      elapsedSec: 0
    }))
  }
}

export const readGuestDraft = async (
  sessionId: string,
  signal?: AbortSignal
): Promise<StudyDraftSnapshot> => {
  const stored = drafts.get(sessionId)
  if (stored) return stored
  // After a reload this tab's working copy still holds the last local save.
  const workingCopy = useAppStore.getState().draftWorkingCopy
  if (
    workingCopy?.principalScope === 'GUEST' &&
    workingCopy.sessionId === sessionId
  ) {
    drafts.set(sessionId, workingCopy.confirmedBase)
    return workingCopy.confirmedBase
  }
  const base = await createBase(sessionId, signal)
  drafts.set(sessionId, base)
  return base
}

export const saveGuestDraft = (
  sessionId: string,
  body: ParsedSaveStudyDraftAnswersRequest
): SaveStudyDraftAnswersTransportResponse => {
  const saved: StudyDraftSnapshot = {
    studySessionId: sessionId,
    revision: body.expectedRevision + 1,
    currentOrdinal: body.currentOrdinal,
    savedAt: new Date().toISOString(),
    answers: body.answers
  }
  drafts.set(sessionId, saved)
  return {
    data: saved,
    headers: {
      'cache-control': 'private, no-store',
      'content-type': 'application/json',
      'idempotency-replayed': null,
      location: null,
      'x-nihongo-practice-contract': '2'
    },
    status: 200
  }
}

export const clearGuestDraftsForTesting = (): void => drafts.clear()
