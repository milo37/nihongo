import {
  assertCreateQuestionReportForRequest,
  createQuestionReportRequestSchema,
  createQuestionReportResponseSchema,
  phase7EmptyQuerySchema
} from '@nihongo/contracts/admin/phase7'
import { Hono, type MiddlewareHandler } from 'hono'
import { z, type ZodError } from 'zod'
import type { QuestionReportService } from '../admin/questionReportService.js'
import { getPhase7OperationBodyCap } from '../admin/adminCommandGuard.js'
import { ApplicationError } from '../errors/applicationError.js'
import { readPhase7JsonBody } from '../http/phase7JsonBody.js'
import { parseStrictRawQuery } from '../http/rawQuery.js'
import type { ApiVariables } from '../middleware/requestContext.js'

type ReportRouteEnvironment = { Variables: ApiVariables }

const toFieldErrors = (error: ZodError): Record<string, string[]> => {
  const fieldErrors: Record<string, string[]> = {}
  for (const issue of error.issues) {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'request'
    fieldErrors[path] = [...(fieldErrors[path] ?? []), issue.message]
  }
  return fieldErrors
}

const assertCommittedResponse = <Response>(
  assertion: () => Response
): Response => {
  try {
    return assertion()
  } catch (error: unknown) {
    throw new ApplicationError({
      code: 'INTERNAL_SERVER_ERROR',
      message: '문제 신고 응답 무결성을 확인할 수 없습니다.',
      retryable: false,
      phase7Disposition: 'COMMIT_CONFIRMED',
      cause: error
    })
  }
}

export const createQuestionReportRoutes = ({
  guard,
  service
}: {
  readonly guard: MiddlewareHandler<ReportRouteEnvironment>
  readonly service: QuestionReportService
}): Hono<ReportRouteEnvironment> => {
  const routes = new Hono<ReportRouteEnvironment>()

  routes.post('/', guard, async (context) => {
    parseStrictRawQuery(
      context.get('rawRequestTarget'),
      phase7EmptyQuerySchema,
      '문제 신고 쿼리 문자열이 올바르지 않습니다.'
    )
    const raw = await readPhase7JsonBody(
      context.req.raw,
      getPhase7OperationBodyCap('createQuestionReport')
    )
    const request = (() => {
      try {
        return createQuestionReportRequestSchema.parse(raw)
      } catch (error: unknown) {
        if (!(error instanceof z.ZodError)) throw error
        throw new ApplicationError({
          code: 'VALIDATION_ERROR',
          message: '문제 신고 요청이 올바르지 않습니다.',
          fieldErrors: toFieldErrors(error),
          retryable: false,
          phase7Disposition: 'NO_TX'
        })
      }
    })()
    const rawResponse = await service.createReport(
      {
        actorId: context.get('reporterActorId'),
        rawSessionToken: context.get('reporterSessionToken')
      },
      request
    )
    const response = createQuestionReportResponseSchema.parse(
      assertCommittedResponse(() =>
        assertCreateQuestionReportForRequest(request, rawResponse)
      )
    )
    context.header('Cache-Control', 'private, no-store')
    return context.json(response, 201)
  })

  return routes
}
