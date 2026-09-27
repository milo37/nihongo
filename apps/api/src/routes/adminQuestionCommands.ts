import {
  assertCreateAdminQuestionResponse,
  assertCreateAdminQuestionVersionResponse,
  assertRequestContentReviewResponse,
  assertRequestQuestionChangesResponse,
  assertUpdateQuestionVersionResponse,
  createAdminQuestionRequestSchema,
  createAdminQuestionResponseSchema,
  createAdminQuestionVersionParamsSchema,
  createAdminQuestionVersionRequestSchema,
  createAdminQuestionVersionResponseSchema,
  phase7EmptyQuerySchema,
  requestContentReviewParamsSchema,
  requestContentReviewRequestSchema,
  requestContentReviewResponseSchema,
  requestQuestionChangesParamsSchema,
  requestQuestionChangesRequestSchema,
  requestQuestionChangesResponseSchema,
  updateQuestionVersionParamsSchema,
  updateQuestionVersionRequestSchema,
  updateQuestionVersionResponseSchema,
  type Phase7Operation
} from '@nihongo/contracts/admin/phase7'
import { Hono, type MiddlewareHandler } from 'hono'
import { z, type ZodError, type ZodType } from 'zod'
import type { AdminQuestionCommandService } from '../admin/adminQuestionCommandService.js'
import { getPhase7OperationBodyCap } from '../admin/adminCommandGuard.js'
import { ApplicationError } from '../errors/applicationError.js'
import { readPhase7JsonBody } from '../http/phase7JsonBody.js'
import { parseStrictRawQuery } from '../http/rawQuery.js'
import type { ApiVariables } from '../middleware/requestContext.js'

type AdminRouteEnvironment = { Variables: ApiVariables }

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
    if (!(error instanceof z.ZodError)) throw error
    throw new ApplicationError({
      code: 'INVALID_ID',
      message,
      fieldErrors: toFieldErrors(error),
      retryable: false,
      phase7Disposition: 'NO_TX'
    })
  }
}

const parseBody = async <Schema extends ZodType>(
  request: Request,
  operation: Phase7Operation,
  schema: Schema,
  message: string
): Promise<z.output<Schema>> => {
  const raw = await readPhase7JsonBody(
    request,
    getPhase7OperationBodyCap(operation)
  )
  const parsed = schema.safeParse(raw)
  if (parsed.success) return parsed.data
  throw new ApplicationError({
    code: 'VALIDATION_ERROR',
    message,
    fieldErrors: toFieldErrors(parsed.error),
    retryable: false,
    phase7Disposition: 'NO_TX'
  })
}

const assertEmptyQuery = (requestTarget: string): void => {
  try {
    parseStrictRawQuery(
      requestTarget,
      phase7EmptyQuerySchema,
      '관리자 명령 쿼리 문자열이 올바르지 않습니다.'
    )
  } catch (error: unknown) {
    if (!(error instanceof ApplicationError)) throw error
    throw new ApplicationError({
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
      phase7Disposition: 'NO_TX',
      cause: error
    })
  }
}

const assertCommittedResponse = <Response>(
  assertion: () => Response
): Response => {
  try {
    return assertion()
  } catch (error: unknown) {
    throw new ApplicationError({
      code: 'INTERNAL_SERVER_ERROR',
      message: '관리자 명령 응답 무결성을 확인할 수 없습니다.',
      retryable: false,
      phase7Disposition: 'COMMIT_CONFIRMED',
      cause: error
    })
  }
}

const noStore = (context: {
  header: (name: string, value: string) => void
}): void => context.header('Cache-Control', 'private, no-store')

const authority = (context: {
  get: {
    (key: 'adminActorId'): string
    (key: 'adminSessionToken'): string
    (key: 'requestId'): string
  }
}) => ({
  actorId: context.get('adminActorId'),
  rawSessionToken: context.get('adminSessionToken'),
  requestId: context.get('requestId')
})

export const createAdminQuestionCommandRoutes = ({
  commandService,
  guard
}: {
  commandService: AdminQuestionCommandService
  guard: MiddlewareHandler<AdminRouteEnvironment>
}): Hono<AdminRouteEnvironment> => {
  const routes = new Hono<AdminRouteEnvironment>()

  routes.post('/questions', guard, async (context) => {
    assertEmptyQuery(context.get('rawRequestTarget'))
    const request = createAdminQuestionRequestSchema.parse(
      await parseBody(
        context.req.raw,
        'createAdminQuestion',
        createAdminQuestionRequestSchema,
        '관리자 문제 생성 요청이 올바르지 않습니다.'
      )
    )
    const raw = await commandService.createQuestion(authority(context), request)
    const response = createAdminQuestionResponseSchema.parse(
      assertCommittedResponse(() =>
        assertCreateAdminQuestionResponse(request, raw)
      )
    )
    noStore(context)
    return context.json(response, 201)
  })

  routes.post('/questions/:questionId/versions', guard, async (context) => {
    assertEmptyQuery(context.get('rawRequestTarget'))
    const params = parsePath(
      () =>
        createAdminQuestionVersionParamsSchema.parse({
          questionId: context.req.param('questionId')
        }),
      '문제 ID 형식이 올바르지 않습니다.'
    )
    const request = await parseBody(
      context.req.raw,
      'createAdminQuestionVersion',
      createAdminQuestionVersionRequestSchema,
      '관리자 문제 버전 생성 요청이 올바르지 않습니다.'
    )
    const raw = await commandService.createVersion(
      authority(context),
      params.questionId,
      request
    )
    const response = createAdminQuestionVersionResponseSchema.parse(
      assertCommittedResponse(() =>
        assertCreateAdminQuestionVersionResponse(params, request, raw)
      )
    )
    noStore(context)
    return context.json(response, 201)
  })

  routes.patch('/question-versions/:versionId', guard, async (context) => {
    assertEmptyQuery(context.get('rawRequestTarget'))
    const params = parsePath(
      () =>
        updateQuestionVersionParamsSchema.parse({
          versionId: context.req.param('versionId')
        }),
      '문제 버전 ID 형식이 올바르지 않습니다.'
    )
    const request = await parseBody(
      context.req.raw,
      'updateQuestionVersion',
      updateQuestionVersionRequestSchema,
      '관리자 문제 버전 수정 요청이 올바르지 않습니다.'
    )
    const raw = await commandService.updateVersion(
      authority(context),
      params.versionId,
      request
    )
    const response = updateQuestionVersionResponseSchema.parse(
      assertCommittedResponse(() =>
        assertUpdateQuestionVersionResponse(params, request, raw)
      )
    )
    noStore(context)
    return context.json(response)
  })

  routes.post(
    '/question-versions/:versionId/review-request',
    guard,
    async (context) => {
      assertEmptyQuery(context.get('rawRequestTarget'))
      const params = parsePath(
        () =>
          requestContentReviewParamsSchema.parse({
            versionId: context.req.param('versionId')
          }),
        '문제 버전 ID 형식이 올바르지 않습니다.'
      )
      const request = await parseBody(
        context.req.raw,
        'requestContentReview',
        requestContentReviewRequestSchema,
        '콘텐츠 검수 요청이 올바르지 않습니다.'
      )
      const raw = await commandService.requestReview(
        authority(context),
        params.versionId,
        request
      )
      const response = requestContentReviewResponseSchema.parse(
        assertCommittedResponse(() =>
          assertRequestContentReviewResponse(params, request, raw)
        )
      )
      noStore(context)
      return context.json(response)
    }
  )

  routes.post(
    '/question-versions/:versionId/change-request',
    guard,
    async (context) => {
      assertEmptyQuery(context.get('rawRequestTarget'))
      const params = parsePath(
        () =>
          requestQuestionChangesParamsSchema.parse({
            versionId: context.req.param('versionId')
          }),
        '문제 버전 ID 형식이 올바르지 않습니다.'
      )
      const request = await parseBody(
        context.req.raw,
        'requestQuestionChanges',
        requestQuestionChangesRequestSchema,
        '수정 요청이 올바르지 않습니다.'
      )
      const raw = await commandService.requestChanges(
        authority(context),
        params.versionId,
        request
      )
      const response = requestQuestionChangesResponseSchema.parse(
        assertCommittedResponse(() =>
          assertRequestQuestionChangesResponse(params, request, raw)
        )
      )
      noStore(context)
      return context.json(response)
    }
  )

  return routes
}
