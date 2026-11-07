import { getStudyDraftAnswers } from '@api/study/getStudyDraftAnswers'
import { submitStudySessionV2 } from '@api/study/submitStudySessionV2'
import type { SubmitStudySessionV2Request } from '@api/study/submitStudySessionV2/schema'
import { saveStudyDraftAnswers } from '@nihongo/browser/api/study/saveStudyDraftAnswers/index'

type StudyAnswers = SubmitStudySessionV2Request['answers']

/**
 * Saves answers as the session draft, the way the practice screen does before
 * it submits, and returns the new draft revision. Answer validation
 * (missing, extra, foreign or unknown option) happens on this save.
 */
export const saveStudyAnswers = async (
  sessionId: string,
  answers: StudyAnswers
): Promise<number> => {
  const draft = (await getStudyDraftAnswers(sessionId)).data
  const saved = await saveStudyDraftAnswers(
    sessionId,
    { expectedRevision: draft.revision, currentOrdinal: 1, answers },
    crypto.randomUUID()
  )
  return saved.data.revision
}

/** Saves the answers as the draft, then submits that draft. */
export const submitStudyAnswers = async (
  sessionId: string,
  answers: StudyAnswers,
  durationSec: number
) =>
  submitStudySessionV2(
    sessionId,
    {
      answers,
      durationSec,
      expectedDraftRevision: await saveStudyAnswers(sessionId, answers)
    },
    crypto.randomUUID()
  )
