import { describe, expect, it } from 'vitest'
import {
  canonicalizeStudySubmission,
  STUDY_SUBMISSION_CANONICAL_PREFIX,
  StudySubmissionCanonicalizationError,
  type CanonicalizeStudySubmissionInput
} from '../src/submission/canonicalize-study-submission.js'

const input = {
  sessionId: 'session-1',
  orderedSessionQuestions: [
    { studySessionQuestionId: 'session-question-2', ordinal: 2 },
    { studySessionQuestionId: 'session-question-1', ordinal: 1 }
  ],
  answers: [
    {
      studySessionQuestionId: 'session-question-2',
      selectedOptionId: null,
      elapsedSec: 20
    },
    {
      studySessionQuestionId: 'session-question-1',
      selectedOptionId: 'option-1',
      elapsedSec: 10
    }
  ],
  durationSec: 30
} as const satisfies CanonicalizeStudySubmissionInput

const expectCanonicalizationCode = (
  candidate: CanonicalizeStudySubmissionInput,
  code: StudySubmissionCanonicalizationError['code']
): void => {
  try {
    canonicalizeStudySubmission(candidate)
    throw new Error(
      `StudySubmissionCanonicalizationError ${code}가 필요합니다.`
    )
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(StudySubmissionCanonicalizationError)
    expect((error as StudySubmissionCanonicalizationError).code).toBe(code)
  }
}

describe('canonicalizeStudySubmission', () => {
  it('session ordinal과 고정 JSON key 순서로 submit-v1 material을 만든다', () => {
    expect(canonicalizeStudySubmission(input)).toBe(
      `${STUDY_SUBMISSION_CANONICAL_PREFIX}{"sessionId":"session-1","answers":[{"studySessionQuestionId":"session-question-1","selectedOptionId":"option-1","elapsedSec":10},{"studySessionQuestionId":"session-question-2","selectedOptionId":null,"elapsedSec":20}],"durationSec":30}`
    )
  })

  it('request answer와 session question 배열 순서가 달라도 같은 material이다', () => {
    const first = canonicalizeStudySubmission(input)
    const second = canonicalizeStudySubmission({
      ...input,
      orderedSessionQuestions: [...input.orderedSessionQuestions].reverse(),
      answers: [...input.answers].reverse()
    })

    expect(second).toBe(first)
  })

  it('입력 배열을 변경하지 않는다', () => {
    const questionOrder = input.orderedSessionQuestions.map(
      (question) => question.ordinal
    )
    const answerOrder = input.answers.map(
      (answer) => answer.studySessionQuestionId
    )

    canonicalizeStudySubmission(input)

    expect(
      input.orderedSessionQuestions.map((question) => question.ordinal)
    ).toEqual(questionOrder)
    expect(
      input.answers.map((answer) => answer.studySessionQuestionId)
    ).toEqual(answerOrder)
  })

  it('답안 중복·foreign·누락을 typed error로 닫는다', () => {
    expectCanonicalizationCode(
      { ...input, answers: [input.answers[0], input.answers[0]] },
      'DUPLICATE_ANSWER'
    )
    expectCanonicalizationCode(
      {
        ...input,
        answers: [
          input.answers[0],
          { ...input.answers[1], studySessionQuestionId: 'foreign' }
        ]
      },
      'ANSWER_NOT_IN_SESSION'
    )
    expectCanonicalizationCode(
      { ...input, answers: [input.answers[0]] },
      'ANSWER_NOT_IN_SESSION'
    )
  })

  it('session question 중복·ordinal gap을 typed error로 닫는다', () => {
    expectCanonicalizationCode(
      {
        ...input,
        orderedSessionQuestions: [
          input.orderedSessionQuestions[0],
          input.orderedSessionQuestions[0]
        ]
      },
      'DUPLICATE_SESSION_QUESTION'
    )
    expectCanonicalizationCode(
      {
        ...input,
        orderedSessionQuestions: input.orderedSessionQuestions.map(
          (question) => ({ ...question, ordinal: question.ordinal + 1 })
        )
      },
      'INVALID_SESSION_QUESTION_ORDER'
    )
  })

  it('duration 경계와 session ID를 방어한다', () => {
    expect(
      canonicalizeStudySubmission({
        ...input,
        answers: input.answers.map((item) => ({ ...item, elapsedSec: 86_400 })),
        durationSec: 604_800
      })
    ).toContain('"durationSec":604800')
    expectCanonicalizationCode(
      { ...input, durationSec: 604_801 },
      'INVALID_DURATION'
    )
    expectCanonicalizationCode(
      {
        ...input,
        answers: [{ ...input.answers[0], elapsedSec: -1 }, input.answers[1]]
      },
      'INVALID_DURATION'
    )
    expectCanonicalizationCode(
      { ...input, sessionId: '  ' },
      'INVALID_SESSION_ID'
    )
  })
})
