import {
  assertDiffQuestionVersionForRequest,
  assertGetAdminQuestionForRequest,
  assertListAdminAuditLogForRequest,
  assertListAdminQuestionsForRequest,
  assertListAdminQuestionVersionsForRequest,
  assertListAdminTagsForRequest,
  assertListQuestionVersionReviewsForRequest,
  assertPreviewQuestionVersionForRequest,
  diffQuestionVersionParamsSchema,
  diffQuestionVersionQuerySchema,
  diffQuestionVersionResponseSchema,
  getAdminQuestionParamsSchema,
  getAdminQuestionQuerySchema,
  getAdminQuestionResponseSchema,
  listAdminAuditLogQuerySchema,
  listAdminAuditLogResponseSchema,
  listAdminQuestionsQuerySchema,
  listAdminQuestionsResponseSchema,
  listAdminQuestionVersionsParamsSchema,
  listAdminQuestionVersionsQuerySchema,
  listAdminQuestionVersionsResponseSchema,
  listAdminTagsQuerySchema,
  listAdminTagsResponseSchema,
  listQuestionVersionReviewsParamsSchema,
  listQuestionVersionReviewsQuerySchema,
  listQuestionVersionReviewsResponseSchema,
  previewQuestionVersionParamsSchema,
  previewQuestionVersionQuerySchema,
  previewQuestionVersionResponseSchema
} from '@nihongo/contracts/admin/phase7'
import { Hono, type MiddlewareHandler } from 'hono'
import { z, type ZodError } from 'zod'
import type { AdminQuestionReader } from '../admin/adminQuestionService.js'
import { ApplicationError } from '../errors/applicationError.js'
import { parseStrictRawQuery } from '../http/rawQuery.js'
import type { ApiVariables } from '../middleware/requestContext.js'

type AdminRouteEnvironment = { Variables: ApiVariables }

const diffRawQuerySchema = z.object({ baseVersionId: z.string() }).strict()

const toFieldErrors = (error: ZodError): Record<string, string[]> => {
  const fieldErrors: Record<string, string[]> = {}
  for (const issue of error.issues) {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'request'
    fieldErrors[path] = [...(fieldErrors[path] ?? []), issue.message]
  }
  return fieldErrors
}

const parsePath = <Output>(parse: () => Output, message: string): Output => {
  try {
    return parse()
  } catch (error: unknown) {
    if (!(error instanceof z.ZodError)) {
      throw error
    }

    throw new ApplicationError({
      code: 'INVALID_ID',
      message,
      fieldErrors: toFieldErrors(error),
      retryable: false
    })
  }
}

const noStore = (context: {
  header: (name: string, value: string) => void
}): void => context.header('Cache-Control', 'private, no-store')

export const createAdminQuestionRoutes = ({
  guard,
  reader
}: {
  guard: MiddlewareHandler<AdminRouteEnvironment>
  reader: AdminQuestionReader
}): Hono<AdminRouteEnvironment> => {
  const routes = new Hono<AdminRouteEnvironment>()
  routes.use('*', guard)

  routes.get('/questions', async (context) => {
    const query = parseStrictRawQuery(
      context.get('rawRequestTarget'),
      listAdminQuestionsQuerySchema,
      '관리자 문제 목록 조회 조건이 올바르지 않습니다.'
    )
    const raw = await reader.listQuestions(query)
    const response = listAdminQuestionsResponseSchema.parse(raw)
    assertListAdminQuestionsForRequest(query, response)
    noStore(context)
    return context.json(response)
  })

  routes.get('/questions/:questionId/versions', async (context) => {
    const params = parsePath(
      () =>
        listAdminQuestionVersionsParamsSchema.parse({
          questionId: context.req.param('questionId')
        }),
      '문제 ID 형식이 올바르지 않습니다.'
    )
    const query = parseStrictRawQuery(
      context.get('rawRequestTarget'),
      listAdminQuestionVersionsQuerySchema,
      '문제 버전 이력 조회 조건이 올바르지 않습니다.'
    )
    const raw = await reader.listVersions(params.questionId, query)
    const response = listAdminQuestionVersionsResponseSchema.parse(raw)
    assertListAdminQuestionVersionsForRequest(params, query, response)
    noStore(context)
    return context.json(response)
  })

  routes.get('/questions/:questionId', async (context) => {
    const params = parsePath(
      () =>
        getAdminQuestionParamsSchema.parse({
          questionId: context.req.param('questionId')
        }),
      '문제 ID 형식이 올바르지 않습니다.'
    )
    const query = parseStrictRawQuery(
      context.get('rawRequestTarget'),
      getAdminQuestionQuerySchema,
      '관리자 문제 상세 조회 조건이 올바르지 않습니다.'
    )
    const raw = await reader.getQuestion(params.questionId)
    const response = getAdminQuestionResponseSchema.parse(raw)
    assertGetAdminQuestionForRequest(params, query, response)
    noStore(context)
    return context.json(response)
  })

  routes.get('/tags', async (context) => {
    const query = parseStrictRawQuery(
      context.get('rawRequestTarget'),
      listAdminTagsQuerySchema,
      '관리자 태그 조회 조건이 올바르지 않습니다.'
    )
    const raw = await reader.listTags(query)
    const response = listAdminTagsResponseSchema.parse(raw)
    assertListAdminTagsForRequest(query, response)
    noStore(context)
    return context.json(response)
  })

  routes.get('/question-versions/:versionId/preview', async (context) => {
    const params = parsePath(
      () =>
        previewQuestionVersionParamsSchema.parse({
          versionId: context.req.param('versionId')
        }),
      '문제 버전 ID 형식이 올바르지 않습니다.'
    )
    const query = parseStrictRawQuery(
      context.get('rawRequestTarget'),
      previewQuestionVersionQuerySchema,
      '문제 버전 preview 조회 조건이 올바르지 않습니다.'
    )
    const raw = await reader.previewVersion(params.versionId)
    const response = previewQuestionVersionResponseSchema.parse(raw)
    assertPreviewQuestionVersionForRequest(params, query, response)
    noStore(context)
    return context.json(response)
  })

  routes.get('/question-versions/:versionId/diff', async (context) => {
    const params = parsePath(
      () =>
        diffQuestionVersionParamsSchema.parse({
          versionId: context.req.param('versionId')
        }),
      '문제 버전 ID 형식이 올바르지 않습니다.'
    )
    const rawQuery = parseStrictRawQuery(
      context.get('rawRequestTarget'),
      diffRawQuerySchema,
      '문제 버전 비교 조건이 올바르지 않습니다.'
    )
    const query = parsePath(
      () => diffQuestionVersionQuerySchema.parse(rawQuery),
      '기준 문제 버전 ID 형식이 올바르지 않습니다.'
    )
    const raw = await reader.diffVersion(params.versionId, query)
    const response = diffQuestionVersionResponseSchema.parse(raw)
    assertDiffQuestionVersionForRequest(params, query, response)
    noStore(context)
    return context.json(response)
  })

  routes.get('/question-versions/:versionId/reviews', async (context) => {
    const params = parsePath(
      () =>
        listQuestionVersionReviewsParamsSchema.parse({
          versionId: context.req.param('versionId')
        }),
      '문제 버전 ID 형식이 올바르지 않습니다.'
    )
    const query = parseStrictRawQuery(
      context.get('rawRequestTarget'),
      listQuestionVersionReviewsQuerySchema,
      '문제 버전 검수 이력 조회 조건이 올바르지 않습니다.'
    )
    const raw = await reader.listReviews(params.versionId, query)
    const response = listQuestionVersionReviewsResponseSchema.parse(raw)
    assertListQuestionVersionReviewsForRequest(params, query, response)
    noStore(context)
    return context.json(response)
  })

  routes.get('/audit-log', async (context) => {
    const query = parseStrictRawQuery(
      context.get('rawRequestTarget'),
      listAdminAuditLogQuerySchema,
      '관리자 감사 로그 조회 조건이 올바르지 않습니다.'
    )
    const raw = await reader.listAuditLog(query)
    const response = listAdminAuditLogResponseSchema.parse(raw)
    assertListAdminAuditLogForRequest(query, response)
    noStore(context)
    return context.json(response)
  })

  return routes
}
