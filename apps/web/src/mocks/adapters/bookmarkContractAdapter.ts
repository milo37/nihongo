import type { BookmarkSummary } from '@nihongo/contracts/bookmark/bookmark'
import {
  getContractQuestionId,
  toContractQuestionSummary
} from '@mocks/adapters/questionContractAdapter'
import type { CanonicalBookmarkSourceRecord } from '@mocks/repository/mockDatabase'

export const toContractBookmarkSummary = (
  source: CanonicalBookmarkSourceRecord
): BookmarkSummary => ({
  questionId: getContractQuestionId(source.question.id),
  question: toContractQuestionSummary(source.question),
  availability: source.availability,
  createdAt: source.bookmark.createdAt
})
