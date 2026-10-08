import type { BookmarkSummary } from '@nihongo/contracts/bookmark/bookmark'
import { toPublicQuestionSummary } from '../question/questionMapper.js'
import type { BookmarkReadRecord } from './bookmarkRepository.js'

export const toBookmarkSummary = (
  record: BookmarkReadRecord
): BookmarkSummary => ({
  questionId: record.questionId,
  question: toPublicQuestionSummary(record.question),
  availability: record.availability,
  createdAt: record.createdAt.toISOString()
})
