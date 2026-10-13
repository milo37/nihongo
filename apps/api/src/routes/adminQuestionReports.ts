import { createHash } from 'node:crypto'
import {
  assertQuestionReportDescriptionDigest,
  assertGetAdminQuestionReportForRequest,
  assertListAdminQuestionReportsForRequest,
  getAdminQuestionReportParamsSchema,
  getAdminQuestionReportResponseSchema,
  listAdminQuestionReportsQuerySchema,
  listAdminQuestionReportsResponseSchema
} from '@nihongo/contracts/admin/phase7'
import { Hono, type MiddlewareHandler } from 'hono'
import { z, type ZodError } from 'zod'
import type { QuestionReportService } from '../admin/questionReportService.js'
import { ApplicationError } from '../errors/applicationError.js'
import { parseStrictRawQuery } from '../http/rawQuery.js'
import type { ApiVariables } from '../middleware/requestContext.js'

type AdminRouteEnvironment = { Variables: ApiVariables }

const sha256Port = {
  digestUtf8: async (value: string): Promise<string> =>
    createHash('sha256').update(value, 'utf8').digest('hex')
}

const toFieldErrors = (error: ZodError): Record<string, string[]> => {
  const fieldErrors: Record<string, string[]> = {}
  for (const issue of error.issues) {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'request'
    fieldErrors[path] = [...(fieldErrors[path] ?? []), issue.message]
  }
  return fieldErrors
}

export const createAdminQuestionReportRoutes = ({
  guard,
  service
}: {
  readonly guard: MiddlewareHandler<AdminRouteEnvironment>
  readonly service: QuestionReportService
}): Hono<AdminRouteEnvironment> => {
  const routes = new Hono<AdminRouteEnvironment>()

  routes.get('/question-reports', guard, async (context) => {
    const query = parseStrictRawQuery(
      context.get('rawRequestTarget'),
      listAdminQuestionReportsQuerySchema,
      '문제 신고 목록 조회 조건이 올바르지 않습니다.'
    )
    const response = listAdminQuestionReportsResponseSchema.parse(
      assertListAdminQuestionReportsForRequest(
        query,
        await service.listReports(query)
      )
    )
    context.header('Cache-Control', 'private, no-store')
    return context.json(response)
  })

  routes.get('/question-reports/:reportId', guard, async (context) => {
    const params = (() => {
      try {
        return getAdminQuestionReportParamsSchema.parse({
          reportId: context.req.param('reportId')
        })
      } catch (error: unknown) {
        if (!(error instanceof z.ZodError)) throw error
        throw new ApplicationError({
          code: 'INVALID_ID',
          message: '문제 신고 ID 형식이 올바르지 않습니다.',
          fieldErrors: toFieldErrors(error),
          retryable: false,
          phase7Disposition: 'NO_TX'
        })
      }
    })()
    parseStrictRawQuery(
      context.get('rawRequestTarget'),
      z.object({}).strict(),
      '문제 신고 상세 조회 조건이 올바르지 않습니다.'
    )
    const response = getAdminQuestionReportResponseSchema.parse(
      assertGetAdminQuestionReportForRequest(
        params,
        await service.getReport(params.reportId)
      )
    )
    try {
      await assertQuestionReportDescriptionDigest(sha256Port, response)
    } catch (error: unknown) {
      throw new ApplicationError({
        code: 'INTERNAL_SERVER_ERROR',
        message: '문제 신고 상세 응답 무결성을 확인할 수 없습니다.',
        retryable: false,
        phase7Disposition: 'NO_TX',
        cause: error
      })
    }
    context.header('Cache-Control', 'private, no-store')
    return context.json(response)
  })

  return routes
}
