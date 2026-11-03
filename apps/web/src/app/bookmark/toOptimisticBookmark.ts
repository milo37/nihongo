import type { BookmarkSummary } from '@nihongo/contracts/bookmark/bookmark'

type BookmarkQuestion = BookmarkSummary['question']

export type OptimisticBookmarkSource = Pick<
  BookmarkQuestion,
  'id' | 'level' | 'subject' | 'questionType' | 'difficulty'
> & {
  questionVersionId: string | null
  questionText: string
  tagSummaries?: BookmarkQuestion['tags'] | null
}

const QUESTION_PREVIEW_MAX_CHARACTERS = 160

// Builds the list row shown before the server confirms a practice or result bookmark.
export const toOptimisticBookmark = (
  question: OptimisticBookmarkSource
): BookmarkSummary | undefined => {
  if (!question.questionVersionId || !question.tagSummaries) {
    return undefined
  }
  const characters = [...question.questionText]
  return {
    questionId: question.id,
    question: {
      id: question.id,
      questionVersionId: question.questionVersionId,
      level: question.level,
      subject: question.subject,
      questionType: question.questionType,
      difficulty: question.difficulty,
      questionTextPreview:
        characters.length <= QUESTION_PREVIEW_MAX_CHARACTERS
          ? question.questionText
          : `${characters.slice(0, QUESTION_PREVIEW_MAX_CHARACTERS - 3).join('')}...`,
      tags: question.tagSummaries
    },
    availability: 'AVAILABLE',
    createdAt: new Date().toISOString()
  }
}
