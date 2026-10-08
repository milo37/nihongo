import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canonicalizeStudySubmission } from '@nihongo/domain/submission/canonicalize-study-submission'
import { studySubmitVersionConformanceFixture } from '@nihongo/contracts/testing/study-submit-version-conformance'
import {
  canonicalizeTolerantStudySubmission,
  canonicalizeTolerantStudySubmissionV2,
  hashStudySubmission
} from './studySubmissionCanonicalizer.js'

const id = (suffix: number): string =>
  `018f6b7a-1f4b-7d5e-8a91-${suffix.toString().padStart(12, '0')}`

const sessionId = id(1)
const orderedSessionQuestions = [
  { studySessionQuestionId: id(2), ordinal: 1 },
  { studySessionQuestionId: id(3), ordinal: 2 }
]
const answers = [
  {
    studySessionQuestionId: id(3),
    selectedOptionId: null,
    elapsedSec: 12
  },
  {
    studySessionQuestionId: id(2),
    selectedOptionId: id(4),
    elapsedSec: 8
  }
]

describe('tolerant study submission canonicalizer', () => {
  it('Phase 4 shared fixture로 기존 submit-v1 material과 hash를 byte 고정한다', () => {
    const fixture = studySubmitVersionConformanceFixture
    const canonical = canonicalizeTolerantStudySubmission({
      sessionId: fixture.sessionId,
      orderedSessionQuestions: fixture.orderedSessionQuestionIds.map(
        (studySessionQuestionId, index) => ({
          studySessionQuestionId,
          ordinal: index + 1
        })
      ),
      answers: fixture.answers,
      durationSec: fixture.durationSec
    })

    expect(canonical).toBe(fixture.v1CanonicalMaterial)
    expect(hashStudySubmission(canonical)).toBe(fixture.v1Sha256)
  })

  it('Phase 4 shared fixture로 submit-v2 material과 hash를 byte 고정한다', () => {
    const fixture = studySubmitVersionConformanceFixture
    const canonical = canonicalizeTolerantStudySubmissionV2({
      sessionId: fixture.sessionId,
      orderedSessionQuestions: fixture.orderedSessionQuestionIds.map(
        (studySessionQuestionId, index) => ({
          studySessionQuestionId,
          ordinal: index + 1
        })
      ),
      answers: fixture.answers,
      durationSec: fixture.durationSec,
      expectedDraftRevision: fixture.expectedDraftRevision
    })

    expect(canonical).toBe(fixture.v2CanonicalMaterial)
    expect(hashStudySubmission(canonical)).toBe(fixture.v2Sha256)
  })

  it('valid exact answer set은 domain canonicalizer와 byte-for-byte 동일하다', () => {
    const tolerant = canonicalizeTolerantStudySubmission({
      sessionId,
      orderedSessionQuestions,
      answers,
      durationSec: 20
    })
    const exact = canonicalizeStudySubmission({
      sessionId,
      orderedSessionQuestions,
      answers,
      durationSec: 20
    })

    expect(tolerant).toBe(exact)
    expect(hashStudySubmission(tolerant)).toBe(
      createHash('sha256').update(exact).digest('hex')
    )
  })

  it('known ID는 ordinal, unknown ID는 뒤의 UUID lexical 순서로 모두 보존한다', () => {
    const canonical = canonicalizeTolerantStudySubmission({
      sessionId,
      orderedSessionQuestions,
      answers: [
        {
          studySessionQuestionId: id(9),
          selectedOptionId: null,
          elapsedSec: 9
        },
        ...answers,
        {
          studySessionQuestionId: id(8),
          selectedOptionId: id(7),
          elapsedSec: 7
        }
      ],
      durationSec: 36
    })
    const material = JSON.parse(canonical.slice('submit-v1:'.length)) as {
      answers: Array<{ studySessionQuestionId: string }>
    }

    expect(
      material.answers.map(
        ({ studySessionQuestionId }) => studySessionQuestionId
      )
    ).toEqual([id(2), id(3), id(8), id(9)])
  })
})
