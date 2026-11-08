import {
  clearSubmissionAttempt,
  writeStoredSubmissionAttempt
} from '@nihongo/browser/app/practice/submissionAttemptStorage'
import { readStudyDraftSubmissionAttempt } from '@app/practice/studyDraftSubmissionAttempt'

describe('studyDraftSubmissionAttempt (JLP-792)', () => {
  it('옛 빌드가 남긴 expectedDraftRevision은 무시하고 읽는다', () => {
    const sessionId = crypto.randomUUID()
    const idempotencyKey = crypto.randomUUID()
    const answer = {
      elapsedSec: 3,
      selectedOptionId: null,
      studySessionQuestionId: crypto.randomUUID()
    }
    writeStoredSubmissionAttempt(sessionId, {
      canonicalBody: {
        answers: [answer],
        durationSec: 3,
        expectedDraftRevision: 4
      },
      contractVersion: 2,
      idempotencyKey
    })
    try {
      expect(readStudyDraftSubmissionAttempt(sessionId)).toEqual({
        canonicalBody: { answers: [answer], durationSec: 3 },
        contractVersion: 2,
        idempotencyKey
      })
    } finally {
      clearSubmissionAttempt(sessionId)
    }
  })
})
