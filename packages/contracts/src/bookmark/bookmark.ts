import { z } from 'zod'
import { isoDateTimeSchema } from '../common/date.js'
import { bookmarkAvailabilitySchema } from '../common/enum.js'
import { opaqueIdSchema } from '../common/id.js'
import { publicQuestionSummarySchema } from '../question/list-questions.js'

export const bookmarkSummarySchema = z
  .object({
    questionId: opaqueIdSchema,
    question: publicQuestionSummarySchema,
    availability: bookmarkAvailabilitySchema,
    createdAt: isoDateTimeSchema
  })
  .strict()
  .superRefine((bookmark, context) => {
    if (bookmark.questionId !== bookmark.question.id) {
      context.addIssue({
        code: 'custom',
        path: ['question', 'id'],
        message: 'Bookmark questionId와 public question ID가 일치해야 합니다.'
      })
    }
  })

export type BookmarkSummary = z.output<typeof bookmarkSummarySchema>
