import type { BookmarkSummary } from '@nihongo/contracts/bookmark/bookmark'
import { toContractQuestionSummary } from '@mocks/adapters/questionContractAdapter'
import type { CanonicalBookmarkSourceRecord } from '@mocks/repository/mockDatabase'

export const toContractBookmarkSummary = (
  source: CanonicalBookmarkSourceRecord
): BookmarkSummary => {
  const question = toContractQuestionSummary(source.question)
  return {
    questionId: question.id,
    question,
    availability: source.availability,
    createdAt: source.bookmark.createdAt
  }
}
