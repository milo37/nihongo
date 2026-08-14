import {
  getQuestionParamsSchema,
  getQuestionResponseSchema
} from '@nihongo/contracts/question/get-question'
import {
  listQuestionsQuerySchema,
  listQuestionsResponseSchema
} from '@nihongo/contracts/question/list-questions'
import { z, type ZodError } from 'zod'
import { Hono } from 'hono'
import { ApplicationError } from '../errors/applicationError.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import type { QuestionReader } from '../question/questionService.js'

interface QuestionRouteDependencies {
  questionReader: QuestionReader
}

const toFieldErrors = (error: ZodError): Record<string, string[]> => {
  const fieldErrors: Record<string, string[]> = {}

  for (const issue of error.issues) {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'request'
    fieldErrors[path] = [...(fieldErrors[path] ?? []), issue.message]
  }

  return fieldErrors
}

export const createQuestionRoutes = ({
  questionReader
}: QuestionRouteDependencies): Hono<{ Variables: ApiVariables }> => {
  const routes = new Hono<{ Variables: ApiVariables }>()
  routes.get('/', async (context) => {
    let query

    try {
      query = listQuestionsQuerySchema.parse(context.req.query())
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        throw new ApplicationError({
          code: 'VALIDATION_ERROR',
          message: '문제 목록 조회 조건이 올바르지 않습니다.',
          fieldErrors: toFieldErrors(error),
          retryable: false
        })
      }

      throw error
    }

    const response = listQuestionsResponseSchema.parse(
      await questionReader.listQuestions(query)
    )
    context.header('Cache-Control', 'private, no-store')

    return context.json(response)
  })

  routes.get('/:questionId', async (context) => {
    let params

    try {
      params = getQuestionParamsSchema.parse({
        questionId: context.req.param('questionId')
      })
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        throw new ApplicationError({
          code: 'INVALID_ID',
          message: '문제 ID 형식이 올바르지 않습니다.',
          fieldErrors: toFieldErrors(error),
          retryable: false
        })
      }

      throw error
    }

    const response = getQuestionResponseSchema.parse(
      await questionReader.getQuestion(params.questionId)
    )
    context.header('Cache-Control', 'private, no-store')

    return context.json(response)
  })

  return routes
}
