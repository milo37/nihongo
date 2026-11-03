import { describe, expect, it } from 'vitest'
import { canonicalizeStudyDraftSave } from '../src/study/canonicalize-study-draft-save.js'

describe('canonicalizeStudyDraftSave', () => {
  it('orders answers by ordinal, then unknown ids by id, and keeps the v2 byte format', () => {
    const canonical = canonicalizeStudyDraftSave(
      'session-1',
      [
        { ordinal: 1, studySessionQuestionId: 'q-b' },
        { ordinal: 2, studySessionQuestionId: 'q-a' }
      ],
      {
        expectedRevision: 3,
        currentOrdinal: 2,
        answers: [
          {
            studySessionQuestionId: 'q-z',
            selectedOptionId: 'o-3',
            elapsedSec: 1
          },
          {
            studySessionQuestionId: 'q-a',
            selectedOptionId: null,
            elapsedSec: 4
          },
          {
            studySessionQuestionId: 'q-y',
            selectedOptionId: 'o-2',
            elapsedSec: 0
          },
          {
            studySessionQuestionId: 'q-b',
            selectedOptionId: 'o-1',
            elapsedSec: 7
          }
        ]
      }
    )
    expect(canonical).toBe(
      'draft-save-v2:{"sessionId":"session-1","expectedRevision":3,"currentOrdinal":2,"answers":[' +
        '{"studySessionQuestionId":"q-b","selectedOptionId":"o-1","elapsedSec":7},' +
        '{"studySessionQuestionId":"q-a","selectedOptionId":null,"elapsedSec":4},' +
        '{"studySessionQuestionId":"q-y","selectedOptionId":"o-2","elapsedSec":0},' +
        '{"studySessionQuestionId":"q-z","selectedOptionId":"o-3","elapsedSec":1}]}'
    )
  })
})
