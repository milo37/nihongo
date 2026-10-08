export const STUDY_GRADING_VERSION = 'server-grading-v1' as const

const MAX_ELAPSED_SEC = 86_400

export type StudyGradingErrorCode =
  | 'DUPLICATE_SESSION_QUESTION'
  | 'DUPLICATE_ANSWER'
  | 'ANSWER_NOT_IN_SESSION'
  | 'OPTION_NOT_IN_VERSION'
  | 'INVALID_DURATION'
  | 'MALFORMED_PINNED_QUESTION'

export class StudyGradingError extends Error {
  readonly code: StudyGradingErrorCode

  constructor(code: StudyGradingErrorCode, message: string) {
    super(message)
    this.name = 'StudyGradingError'
    this.code = code
  }
}

export interface PinnedStudyQuestionForGrading {
  readonly studySessionQuestionId: string
  readonly questionVersionId: string
  readonly correctOptionId: string
  readonly optionIds: readonly string[]
}

export interface SubmittedStudyAnswer {
  readonly studySessionQuestionId: string
  readonly selectedOptionId: string | null
  readonly elapsedSec: number
}

export interface GradedStudyAnswer {
  readonly studySessionQuestionId: string
  readonly questionVersionId: string
  readonly selectedOptionId: string | null
  readonly elapsedSec: number
  readonly isCorrect: boolean
  readonly gradingVersion: typeof STUDY_GRADING_VERSION
}

export interface StudySubmissionGrade {
  readonly answers: readonly GradedStudyAnswer[]
  readonly totalCount: number
  readonly correctCount: number
  readonly incorrectCount: number
  readonly correctRateBasisPoints: number
  readonly gradingVersion: typeof STUDY_GRADING_VERSION
}

const isValidElapsedSec = (value: number): boolean =>
  Number.isInteger(value) && value >= 0 && value <= MAX_ELAPSED_SEC

const createQuestionIndex = (
  questions: readonly PinnedStudyQuestionForGrading[]
): Map<string, PinnedStudyQuestionForGrading> => {
  if (questions.length === 0) {
    throw new StudyGradingError(
      'MALFORMED_PINNED_QUESTION',
      '채점할 고정 문제가 하나 이상 필요합니다.'
    )
  }

  const questionBySessionQuestionId = new Map<
    string,
    PinnedStudyQuestionForGrading
  >()

  for (const question of questions) {
    if (questionBySessionQuestionId.has(question.studySessionQuestionId)) {
      throw new StudyGradingError(
        'DUPLICATE_SESSION_QUESTION',
        `고정 세션 문제가 중복되었습니다: ${question.studySessionQuestionId}`
      )
    }

    const optionIds = new Set(question.optionIds)
    if (
      question.optionIds.length !== 4 ||
      optionIds.size !== question.optionIds.length ||
      !optionIds.has(question.correctOptionId)
    ) {
      throw new StudyGradingError(
        'MALFORMED_PINNED_QUESTION',
        `고정 문제 version의 보기 또는 정답이 올바르지 않습니다: ${question.questionVersionId}`
      )
    }

    questionBySessionQuestionId.set(question.studySessionQuestionId, question)
  }

  return questionBySessionQuestionId
}

const createAnswerIndex = (
  answers: readonly SubmittedStudyAnswer[],
  questionBySessionQuestionId: ReadonlyMap<
    string,
    PinnedStudyQuestionForGrading
  >
): Map<string, SubmittedStudyAnswer> => {
  const answerBySessionQuestionId = new Map<string, SubmittedStudyAnswer>()

  for (const answer of answers) {
    if (answerBySessionQuestionId.has(answer.studySessionQuestionId)) {
      throw new StudyGradingError(
        'DUPLICATE_ANSWER',
        `같은 세션 문제의 답안이 중복되었습니다: ${answer.studySessionQuestionId}`
      )
    }

    if (!questionBySessionQuestionId.has(answer.studySessionQuestionId)) {
      throw new StudyGradingError(
        'ANSWER_NOT_IN_SESSION',
        `세션에 속하지 않은 답안입니다: ${answer.studySessionQuestionId}`
      )
    }

    if (!isValidElapsedSec(answer.elapsedSec)) {
      throw new StudyGradingError(
        'INVALID_DURATION',
        `elapsedSec 범위를 벗어났습니다: ${answer.studySessionQuestionId}`
      )
    }

    answerBySessionQuestionId.set(answer.studySessionQuestionId, answer)
  }

  if (answerBySessionQuestionId.size !== questionBySessionQuestionId.size) {
    throw new StudyGradingError(
      'ANSWER_NOT_IN_SESSION',
      '모든 세션 문제에 답안이 하나씩 필요합니다.'
    )
  }

  return answerBySessionQuestionId
}

export const calculateCorrectRateBasisPoints = (
  correctCount: number,
  totalCount: number
): number => {
  if (
    !Number.isInteger(correctCount) ||
    !Number.isInteger(totalCount) ||
    totalCount <= 0 ||
    correctCount < 0 ||
    correctCount > totalCount
  ) {
    throw new StudyGradingError(
      'MALFORMED_PINNED_QUESTION',
      '정답률 집계 count가 올바르지 않습니다.'
    )
  }

  return Math.round((correctCount * 10_000) / totalCount)
}

export const gradePinnedStudySubmission = (
  questions: readonly PinnedStudyQuestionForGrading[],
  submittedAnswers: readonly SubmittedStudyAnswer[]
): StudySubmissionGrade => {
  const questionBySessionQuestionId = createQuestionIndex(questions)
  const answerBySessionQuestionId = createAnswerIndex(
    submittedAnswers,
    questionBySessionQuestionId
  )
  let correctCount = 0

  const answers = questions.map((question): GradedStudyAnswer => {
    const answer = answerBySessionQuestionId.get(
      question.studySessionQuestionId
    )

    if (!answer) {
      throw new StudyGradingError(
        'ANSWER_NOT_IN_SESSION',
        `세션 문제의 답안이 없습니다: ${question.studySessionQuestionId}`
      )
    }

    if (
      answer.selectedOptionId !== null &&
      !question.optionIds.includes(answer.selectedOptionId)
    ) {
      throw new StudyGradingError(
        'OPTION_NOT_IN_VERSION',
        `선택한 보기가 고정 문제 version에 속하지 않습니다: ${answer.selectedOptionId}`
      )
    }

    const isCorrect = answer.selectedOptionId === question.correctOptionId
    if (isCorrect) {
      correctCount += 1
    }

    return {
      studySessionQuestionId: question.studySessionQuestionId,
      questionVersionId: question.questionVersionId,
      selectedOptionId: answer.selectedOptionId,
      elapsedSec: answer.elapsedSec,
      isCorrect,
      gradingVersion: STUDY_GRADING_VERSION
    }
  })

  const totalCount = questions.length

  return {
    answers,
    totalCount,
    correctCount,
    incorrectCount: totalCount - correctCount,
    correctRateBasisPoints: calculateCorrectRateBasisPoints(
      correctCount,
      totalCount
    ),
    gradingVersion: STUDY_GRADING_VERSION
  }
}
