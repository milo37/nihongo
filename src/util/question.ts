import type {
  PracticeQuestion,
  QuestionOptionRecord,
  QuestionRecord
} from '@common/types/domain'

export const toPracticeQuestion = (
  question: QuestionRecord
): PracticeQuestion => ({
  id: question.id,
  level: question.level,
  subject: question.subject,
  questionType: question.questionType,
  passage: question.passage,
  questionText: question.questionText,
  options: question.options.map(({ id, label, text }) => ({ id, label, text })),
  difficulty: question.difficulty,
  tags: [...question.tags]
})

export const getCorrectOption = (
  question: QuestionRecord
): QuestionOptionRecord | null => {
  let correctOption: QuestionOptionRecord | null = null

  for (const option of question.options) {
    if (!option.isCorrect) {
      continue
    }

    if (correctOption) {
      return null
    }

    correctOption = option
  }

  return correctOption
}
