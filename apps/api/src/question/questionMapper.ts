import {
  comparePublicQuestionTags,
  type PublicPracticeQuestion
} from '@nihongo/contracts/question/get-question'
import type { PublicQuestionSummary } from '@nihongo/contracts/question/list-questions'
import type {
  PublishedQuestionDetailRecord,
  PublishedQuestionSummaryRecord,
  QuestionTagRecord
} from './questionRepository.js'

const QUESTION_PREVIEW_MAX_LENGTH = 160

const toSortedPublicTags = (
  tags: readonly QuestionTagRecord[]
): QuestionTagRecord[] =>
  tags
    .map(({ id, label, labelJa }) => ({ id, label, labelJa }))
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
): PublicPracticeQuestion => ({
  id: question.id,
  questionVersionId: question.questionVersionId,
  level: question.level,
  subject: question.subject,
  questionType: question.questionType,
  passage: question.passage,
  ...(question.passageId === undefined
    ? {}
    : { passageId: question.passageId }),
  ...(question.passageFurigana === undefined
    ? {}
    : {
        passageFurigana:
          question.passageFurigana === null
            ? null
            : question.passageFurigana.map((segment) => ({ ...segment }))
      }),
  ...(question.passageAudio === undefined
    ? {}
    : {
        passageAudio:
          question.passageAudio === null ? null : { ...question.passageAudio }
      }),
  questionText: question.questionText,
  options: question.options.map(({ id, label, text }) => ({
    id,
    label: label as '1' | '2' | '3' | '4',
    text
  })),
  difficulty: question.difficulty,
  tags: toSortedPublicTags(question.tags)
})
