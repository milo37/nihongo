import {
  getQuestionParamsSchema,
  getQuestionResponseSchema
} from '@nihongo/contracts/question/get-question'
import {
  listQuestionsQuerySchema,
  listQuestionsResponseSchema
} from '@nihongo/contracts/question/list-questions'
import { getConnInfo } from '@hono/node-server/conninfo'
import { z, type ZodError } from 'zod'
import { Hono, type Context } from 'hono'
import { createClientIpAuthority } from '../auth/clientIp.js'
import type { ApiEnvironment } from '../config/env.js'
import { ApplicationError } from '../errors/applicationError.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import type { QuestionReader } from '../question/questionService.js'

type QuestionRouteEnvironment = { Variables: ApiVariables }
type QuestionReadOperation = 'question-list-read' | 'question-detail-read'

interface QuestionReadSecurityDependencies {
  readonly environment: ApiEnvironment
  readonly rateLimiter: ApplicationRateLimiter
}

interface QuestionRouteDependencies {
  readonly questionReader: QuestionReader
  readonly questionReadSecurity: QuestionReadSecurityDependencies | undefined
}

const QUESTION_READ_MAX = 120
const QUESTION_READ_WINDOW_MILLISECONDS = 60_000

const toFieldErrors = (error: ZodError): Record<string, string[]> => {
  const fieldErrors: Record<string, string[]> = {}

  for (const issue of error.issues) {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'request'
    fieldErrors[path] = [...(fieldErrors[path] ?? []), issue.message]
  }

  return fieldErrors
}

export const createQuestionRoutes = ({
  questionReader,
  questionReadSecurity
}: QuestionRouteDependencies): Hono<QuestionRouteEnvironment> => {
  const routes = new Hono<QuestionRouteEnvironment>()
  const clientIpAuthority = questionReadSecurity
    ? createClientIpAuthority(
        questionReadSecurity.environment.AUTH_TRUSTED_PROXY_CIDRS
      )
    : undefined
  const consumeQuestionReadRateLimit = async (
    context: Context<QuestionRouteEnvironment>,
    operation: QuestionReadOperation
  ): Promise<void> => {
    if (!questionReadSecurity || !clientIpAuthority) {
      throw new ApplicationError({
        code: 'SERVICE_UNAVAILABLE',
        message: '문제 조회 요청 제한을 적용할 수 없습니다.',
        retryable: true,
        retryAfterSeconds: 5
      })
    }

    let peerAddress: string | undefined
    try {
      peerAddress = getConnInfo(context).remote.address
    } catch {
      peerAddress = undefined
    }

    await questionReadSecurity.rateLimiter.consume({
      clientIp: clientIpAuthority.resolve(
        peerAddress,
        context.req.header('X-Forwarded-For') ?? null
      ),
      max: QUESTION_READ_MAX,
      operation,
      windowMs: QUESTION_READ_WINDOW_MILLISECONDS
    })
  }

  routes.get('/', async (context) => {
    await consumeQuestionReadRateLimit(context, 'question-list-read')
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
    await consumeQuestionReadRateLimit(context, 'question-detail-read')
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
