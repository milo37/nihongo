import type {
  QuestionRecord,
  StudyAnswerInput,
  StudyResult,
  StudyResultItem
} from '@common/types/domain'
import { getCorrectOption, toPracticeQuestion } from '@util/question'

export type StudyResultErrorCode =
  | 'DUPLICATE_ANSWER'
  | 'INVALID_OPTION'
  | 'INVALID_QUESTION'
  | 'MALFORMED_QUESTION'

const STUDY_RESULT_ERROR_STATUS: Record<StudyResultErrorCode, number> = {
  DUPLICATE_ANSWER: 422,
  INVALID_OPTION: 422,
  INVALID_QUESTION: 422,
  MALFORMED_QUESTION: 500
}

export class StudyResultCalculationError extends Error {
  readonly code: StudyResultErrorCode
  readonly status: number

  constructor(code: StudyResultErrorCode, message: string) {
    super(message)
    this.name = 'StudyResultCalculationError'
    this.code = code
    this.status = STUDY_RESULT_ERROR_STATUS[code]
  }
}

export interface CalculateStudyResultInput {
  sessionId: string
  questions: readonly QuestionRecord[]
  answers: readonly StudyAnswerInput[]
  durationSec: number
}

const buildAnswerMap = (
  questions: readonly QuestionRecord[],
  answers: readonly StudyAnswerInput[]
): Map<string, StudyAnswerInput> => {
  const questionIdSet = new Set(questions.map(({ id }) => id))
  const answerByQuestionId = new Map<string, StudyAnswerInput>()

  for (const answer of answers) {
    if (!questionIdSet.has(answer.questionId)) {
      throw new StudyResultCalculationError(
        'INVALID_QUESTION',
        `세션에 없는 문제입니다: ${answer.questionId}`
      )
    }

    if (answerByQuestionId.has(answer.questionId)) {
      throw new StudyResultCalculationError(
        'DUPLICATE_ANSWER',
        `같은 문제의 답안이 중복되었습니다: ${answer.questionId}`
      )
    }

    answerByQuestionId.set(answer.questionId, answer)
  }

  return answerByQuestionId
}

export const calculateStudyResult = ({
  sessionId,
  questions,
  answers,
  durationSec
}: CalculateStudyResultInput): StudyResult => {
  const answerByQuestionId = buildAnswerMap(questions, answers)
  const items: StudyResultItem[] = []
  let correctCount = 0

  for (const question of questions) {
    const correctOption = getCorrectOption(question)

    if (!correctOption) {
      throw new StudyResultCalculationError(
        'MALFORMED_QUESTION',
        `정답이 정확히 하나가 아닌 문제입니다: ${question.id}`
      )
    }

    const answer = answerByQuestionId.get(question.id)
    const selectedOptionId = answer?.selectedOptionId ?? null

    if (
      selectedOptionId !== null &&
      !question.options.some(({ id }) => id === selectedOptionId)
    ) {
      throw new StudyResultCalculationError(
        'INVALID_OPTION',
        `문제에 속하지 않은 보기입니다: ${selectedOptionId}`
      )
    }

    const isCorrect = selectedOptionId === correctOption.id
    if (isCorrect) {
      correctCount += 1
    }

    items.push({
      question: toPracticeQuestion(question),
      selectedOptionId,
      correctOptionId: correctOption.id,
      isCorrect,
      explanationKo: question.explanationKo,
      explanationJa: question.explanationJa,
      tags: [...question.tags]
    })
  }

  const totalCount = questions.length

  return {
    sessionId,
    totalCount,
    correctCount,
    incorrectCount: totalCount - correctCount,
    correctRate:
      totalCount === 0 ? 0 : Math.round((correctCount / totalCount) * 100),
    durationSec: Math.max(0, Math.trunc(durationSec)),
    items
  }
}
