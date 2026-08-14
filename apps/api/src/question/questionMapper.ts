import {
  comparePublicQuestionTags,
  type GetQuestionResponse
} from '@nihongo/contracts/question/get-question'
import type {
  ListQuestionsResponse,
  PublicQuestionSummary
} from '@nihongo/contracts/question/list-questions'
import type {
  PublishedQuestionDetailRecord,
  PublishedQuestionSummaryRecord
} from './questionRepository.js'

const QUESTION_PREVIEW_MAX_LENGTH = 160

const toSortedPublicTags = (
  tags: readonly { readonly id: string; readonly label: string }[]
): Array<{ id: string; label: string }> =>
  tags
    .map(({ id, label }) => ({ id, label }))
    .toSorted(comparePublicQuestionTags)

const createQuestionTextPreview = (questionText: string): string => {
  const characters = [...questionText]

  if (characters.length <= QUESTION_PREVIEW_MAX_LENGTH) {
    return questionText
  }

  return `${characters.slice(0, QUESTION_PREVIEW_MAX_LENGTH - 3).join('')}...`
}

export const toPublicQuestionSummary = (
  question: PublishedQuestionSummaryRecord
): PublicQuestionSummary => ({
  id: question.id,
  questionVersionId: question.questionVersionId,
  level: question.level,
  subject: question.subject,
  questionType: question.questionType,
  difficulty: question.difficulty,
  questionTextPreview: createQuestionTextPreview(question.questionText),
  tags: toSortedPublicTags(question.tags)
})

export const toPublicPracticeQuestion = (
  question: PublishedQuestionDetailRecord
): GetQuestionResponse => ({
  id: question.id,
  questionVersionId: question.questionVersionId,
  level: question.level,
  subject: question.subject,
  questionType: question.questionType,
  passage: question.passage,
  questionText: question.questionText,
  options: question.options.map(({ id, label, text }) => ({
    id,
    label: label as '1' | '2' | '3' | '4',
    text
  })),
  difficulty: question.difficulty,
  tags: toSortedPublicTags(question.tags)
})

export const toListQuestionsResponse = (
  questions: readonly PublishedQuestionSummaryRecord[],
  page: number,
  pageSize: number,
  total: number
): ListQuestionsResponse => ({
  items: questions.map(toPublicQuestionSummary),
  page,
  pageSize,
  total
})
