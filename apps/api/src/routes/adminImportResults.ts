import {
  getAdminImportResultParamsSchema,
  getAdminImportResultResponseSchema,
  type AdminImportApplyResponse
} from '@nihongo/contracts/admin/content-operations'
import { Hono, type MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { QuestionImportResultUnavailableError } from '../admin/questionImportResultStore.js'
import { ApplicationError } from '../errors/applicationError.js'
import { parseStrictRawQuery } from '../http/rawQuery.js'
import type { ApiVariables } from '../middleware/requestContext.js'

type RouteEnvironment = { Variables: ApiVariables }

/** GET /api/v1/admin/question-imports/:importId recovers a lost apply response. */
export const createAdminImportResultRoutes = ({
  guard,
  readResult
}: {
  readonly guard: MiddlewareHandler<RouteEnvironment>
  readonly readResult: (
    importId: string
  ) => Promise<AdminImportApplyResponse | null>
}): Hono<RouteEnvironment> => {
  const routes = new Hono<RouteEnvironment>()

  routes.get('/question-imports/:importId', guard, async (context) => {
    let importId: string
    try {
      ;({ importId } = getAdminImportResultParamsSchema.parse({
        importId: context.req.param('importId')
      }))
    } catch (error: unknown) {
      if (!(error instanceof z.ZodError)) throw error
      throw new ApplicationError({
        code: 'VALIDATION_ERROR',
        message: 'import ID 형식이 올바르지 않습니다.',
        fieldErrors: { importId: ['import ID 형식이 올바르지 않습니다.'] },
        retryable: false
      })
    }
    parseStrictRawQuery(
      context.get('rawRequestTarget'),
      z.object({}).strict(),
      'import 결과 조회 조건이 올바르지 않습니다.'
    )
    let result: AdminImportApplyResponse | null
    try {
      result = await readResult(importId)
    } catch (error: unknown) {
      if (!(error instanceof QuestionImportResultUnavailableError)) throw error
      throw new ApplicationError({
        code: 'SERVICE_UNAVAILABLE',
        message: 'import 결과 저장소에 연결할 수 없습니다.',
        retryable: true,
        retryAfterSeconds: 5,
        cause: error
      })
    }
    if (!result) {
      throw new ApplicationError({
        code: 'RESOURCE_NOT_FOUND',
        message: '적용된 import 결과를 찾을 수 없습니다.',
        retryable: false
      })
    }
    context.header('Cache-Control', 'private, no-store')
    return context.json(getAdminImportResultResponseSchema.parse(result))
  })

  return routes
}
