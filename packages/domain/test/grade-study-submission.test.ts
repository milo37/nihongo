import { describe, expect, it } from 'vitest'
import {
  calculateCorrectRateBasisPoints,
  gradePinnedStudySubmission,
  STUDY_GRADING_VERSION,
  StudyGradingError,
  type PinnedStudyQuestionForGrading,
  type SubmittedStudyAnswer
} from '../src/grading/grade-study-submission.js'

const question = (index: number): PinnedStudyQuestionForGrading => ({
  studySessionQuestionId: `session-question-${index}`,
  questionVersionId: `question-version-${index}`,
  correctOptionId: `option-${index}-1`,
  optionIds: Array.from(
    { length: 4 },
    (_, optionIndex) => `option-${index}-${optionIndex + 1}`
  )
})

const questions = [question(1), question(2), question(3)] as const

const answer = (
  index: number,
  selectedOptionId: string | null,
  elapsedSec = 10
): SubmittedStudyAnswer => ({
  studySessionQuestionId: `session-question-${index}`,
  selectedOptionId,
  elapsedSec
})

const expectGradingCode = (
  action: () => unknown,
  code: StudyGradingError['code']
): void => {
  try {
    action()
    throw new Error(`StudyGradingError ${code}가 필요합니다.`)
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(StudyGradingError)
    expect((error as StudyGradingError).code).toBe(code)
  }
}

describe('gradePinnedStudySubmission', () => {
  it('고정 문제 순서로 정답·오답·미응답을 서버 채점한다', () => {
    const result = gradePinnedStudySubmission(questions, [
      answer(3, null, 30),
      answer(1, 'option-1-1', 10),
      answer(2, 'option-2-4', 20)
    ])

    expect(result).toEqual({
      answers: [
        {
          studySessionQuestionId: 'session-question-1',
          questionVersionId: 'question-version-1',
          selectedOptionId: 'option-1-1',
          elapsedSec: 10,
          isCorrect: true,
          gradingVersion: STUDY_GRADING_VERSION
        },
        {
          studySessionQuestionId: 'session-question-2',
          questionVersionId: 'question-version-2',
          selectedOptionId: 'option-2-4',
          elapsedSec: 20,
          isCorrect: false,
          gradingVersion: STUDY_GRADING_VERSION
        },
        {
          studySessionQuestionId: 'session-question-3',
          questionVersionId: 'question-version-3',
          selectedOptionId: null,
          elapsedSec: 30,
          isCorrect: false,
          gradingVersion: STUDY_GRADING_VERSION
        }
      ],
      totalCount: 3,
      correctCount: 1,
      incorrectCount: 2,
      correctRateBasisPoints: 3_333,
      gradingVersion: STUDY_GRADING_VERSION
    })
  })

  it('basis points 반올림을 정확히 고정한다', () => {
    expect(calculateCorrectRateBasisPoints(0, 3)).toBe(0)
    expect(calculateCorrectRateBasisPoints(1, 3)).toBe(3_333)
    expect(calculateCorrectRateBasisPoints(2, 3)).toBe(6_667)
    expect(calculateCorrectRateBasisPoints(1, 6)).toBe(1_667)
    expect(calculateCorrectRateBasisPoints(3, 3)).toBe(10_000)
  })

  it('중복·누락·foreign 답안을 닫힌 오류로 거부한다', () => {
    expectGradingCode(
      () =>
        gradePinnedStudySubmission(questions, [
          answer(1, null),
          answer(1, null),
          answer(3, null)
        ]),
      'DUPLICATE_ANSWER'
    )
    expectGradingCode(
      () =>
        gradePinnedStudySubmission(questions, [
          answer(1, null),
          answer(2, null)
        ]),
      'ANSWER_NOT_IN_SESSION'
    )
    expectGradingCode(
      () =>
        gradePinnedStudySubmission(questions, [
          answer(1, null),
          answer(2, null),
          answer(99, null)
        ]),
      'ANSWER_NOT_IN_SESSION'
    )
  })

  it('고정 version에 속하지 않은 option을 거부한다', () => {
    expectGradingCode(
      () =>
        gradePinnedStudySubmission(questions, [
          answer(1, 'option-2-1'),
          answer(2, null),
          answer(3, null)
        ]),
      'OPTION_NOT_IN_VERSION'
    )
  })

  it('elapsedSec 경계와 malformed pinned question을 방어한다', () => {
    expect(
      gradePinnedStudySubmission([questions[0]], [answer(1, null, 86_400)])
        .answers[0]?.elapsedSec
    ).toBe(86_400)
    expectGradingCode(
      () =>
        gradePinnedStudySubmission([questions[0]], [answer(1, null, 86_401)]),
      'INVALID_DURATION'
    )
    expectGradingCode(
      () =>
        gradePinnedStudySubmission(
          [
            {
              ...questions[0],
              correctOptionId: 'foreign-option'
            }
          ],
          [answer(1, null)]
        ),
      'MALFORMED_PINNED_QUESTION'
    )
    expectGradingCode(
      () =>
        gradePinnedStudySubmission(
          [questions[0], questions[0]],
          [answer(1, null), answer(2, null)]
        ),
      'DUPLICATE_SESSION_QUESTION'
    )
  })
})
