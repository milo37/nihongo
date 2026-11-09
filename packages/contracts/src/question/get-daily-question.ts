import { z } from 'zod'
import { calendarDateSchema } from '../common/date.js'
import { jlptLevelSchema } from '../common/enum.js'
import { createApiFailureSchema } from '../common/error.js'
import { reviewedQuestionSchema } from '../study/study-result.js'

/**
 * GET /api/v1/daily-question?level=N5 (JLP-815). One question a day per
 * level, the same for everyone on the same Korean date. No sign-in, no
 * record: the answer and explanations come with the question.
 */
export const getDailyQuestionQuerySchema = z
  .object({
    level: jlptLevelSchema
  })
  .strict()

export const getDailyQuestionResponseSchema = z
  .object({
    /** Korean (Asia/Seoul) calendar date the question belongs to. */
    date: calendarDateSchema,
    level: jlptLevelSchema,
    question: reviewedQuestionSchema
  })
  .strict()
  .superRefine((value, context) => {
    if (value.question.level !== value.level) {
      context.addIssue({
        code: 'custom',
        path: ['question', 'level'],
        message: '오늘의 문제는 요청한 급수여야 합니다.'
      })
    }
    if (value.question.subject === 'READING') {
      context.addIssue({
        code: 'custom',
        path: ['question', 'subject'],
        message: '오늘의 문제는 어휘·문법 문제입니다.'
      })
    }
  })

const getDailyQuestionErrorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'NO_ELIGIBLE_QUESTIONS',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])

export const getDailyQuestionErrorSchema = createApiFailureSchema(
  getDailyQuestionErrorCodeSchema
)

export type GetDailyQuestionQuery = z.output<typeof getDailyQuestionQuerySchema>
export type GetDailyQuestionResponse = z.output<
  typeof getDailyQuestionResponseSchema
>
export type GetDailyQuestionError = z.output<typeof getDailyQuestionErrorSchema>
