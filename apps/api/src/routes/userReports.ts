import {
  adminReportMutationResponseSchema,
  adminReportParamsSchema,
  closeAdminReportRequestSchema,
  getAdminReportResponseSchema,
  listAdminReportsQuerySchema,
  listAdminReportsResponseSchema,
  replyAndCloseAdminReportRequestSchema,
  saveAdminReportNoteRequestSchema
} from '@nihongo/contracts/admin/reports'
import {
  createReportRequestSchema,
  createReportResponseSchema,
  listMyReportsQuerySchema,
  listMyReportsResponseSchema
} from '@nihongo/contracts/report/reports'
import { Hono, type MiddlewareHandler } from 'hono'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import {
  assertAccountNotRestricted,
  type AccountRestrictionReader
} from '../account/accountRestriction.js'
import { appendAdminAuthHeaders } from '../admin/adminReadGuard.js'
import type { PrincipalService } from '../auth/principalService.js'
import type { ApiEnvironment } from '../config/env.js'
import { ApplicationError } from '../errors/applicationError.js'
import { parseStrictRawQuery } from '../http/rawQuery.js'
import { readStrictJsonBody } from '../http/strictJsonBody.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import type { UserReportService } from '../report/userReportService.js'
import { toFieldErrors } from './routeSupport.js'

type RouteEnvironment = { Variables: ApiVariables }

const REPORT_BODY_CAP = 16 * 1024

const validationError = (message: string, error: z.ZodError): never => {
  throw new ApplicationError({
    code: 'VALIDATION_ERROR',
    message,
    fieldErrors: toFieldErrors(error),
    retryable: false
  })
}

/** Converts contract parse failures into VALIDATION_ERROR. */
const validated = async <Output>(
  message: string,
  parse: () => Output | Promise<Output>
): Promise<Output> => {
  try {
    return await parse()
  } catch (error: unknown) {
    if (error instanceof z.ZodError) return validationError(message, error)
    throw error
  }
}

const noStore = (context: {
  header: (name: string, value: string) => void
}): void => context.header('Cache-Control', 'private, no-store')

/** Learner routes under /api/v1/reports. */
export const createUserReportRoutes = ({
  accountRestrictionReader,
  createGuard,
  environment,
  principalService,
  service
}: {
  readonly accountRestrictionReader: AccountRestrictionReader
  readonly createGuard: MiddlewareHandler<RouteEnvironment>
  readonly environment: ApiEnvironment
  readonly principalService: PrincipalService
  readonly service: UserReportService
}): Hono<RouteEnvironment> => {
  const routes = new Hono<RouteEnvironment>()

  routes.post('/', createGuard, async (context) => {
    const request = await validated(
      '제보 요청이 올바르지 않습니다.',
      async () =>
        createReportRequestSchema.parse(
          await readStrictJsonBody(context.req.raw, REPORT_BODY_CAP)
        )
    )
    await assertAccountNotRestricted(
      accountRestrictionReader,
      context.get('reporterActorId')
    )
    const response = createReportResponseSchema.parse(
      await service.createReport(context.get('reporterActorId'), request)
    )
    noStore(context)
    return context.json(response, 201)
  })

  const requireReporter = createMiddleware<RouteEnvironment>(
    async (context, next) => {
      const resolution = await principalService.resolveAuthenticatedUser(
        context.req.raw.headers
      )
      appendAdminAuthHeaders(context, resolution, environment)
      if (!resolution.user) {
        throw new ApplicationError({
          code: resolution.clearSessionCookie
            ? 'AUTH_SESSION_EXPIRED'
            : 'AUTHENTICATION_REQUIRED',
          message: resolution.clearSessionCookie
            ? '로그인 세션이 만료됐습니다.'
            : '내 제보를 보려면 로그인이 필요합니다.',
          retryable: false
        })
      }
      context.set('reporterActorId', resolution.user.id)
      await next()
    }
  )

  routes.get('/', requireReporter, async (context) => {
    const query = parseStrictRawQuery(
      context.get('rawRequestTarget'),
      listMyReportsQuerySchema,
      '내 제보 조회 조건이 올바르지 않습니다.'
    )
    const response = listMyReportsResponseSchema.parse(
      await service.listMyReports(context.get('reporterActorId'), query)
    )
    noStore(context)
    return context.json(response)
  })

  return routes
}

/** Admin routes under /api/v1/admin/reports. */
export const createAdminUserReportRoutes = ({
  commandGuard,
  readGuard,
  service
}: {
  readonly commandGuard: MiddlewareHandler<RouteEnvironment>
  readonly readGuard: MiddlewareHandler<RouteEnvironment>
  readonly service: UserReportService
}): Hono<RouteEnvironment> => {
  const routes = new Hono<RouteEnvironment>()

  routes.get('/reports', readGuard, async (context) => {
    const query = parseStrictRawQuery(
      context.get('rawRequestTarget'),
      listAdminReportsQuerySchema,
      '제보 목록 조회 조건이 올바르지 않습니다.'
    )
    const response = listAdminReportsResponseSchema.parse(
      await service.listAdminReports(query)
    )
    noStore(context)
    return context.json(response)
  })

  routes.get('/reports/:reportId', readGuard, async (context) => {
    const { reportId } = await validated(
      '제보 ID 형식이 올바르지 않습니다.',
      () =>
        adminReportParamsSchema.parse({
          reportId: context.req.param('reportId')
        })
    )
    parseStrictRawQuery(
      context.get('rawRequestTarget'),
      z.object({}).strict(),
      '제보 상세 조회 조건이 올바르지 않습니다.'
    )
    const response = getAdminReportResponseSchema.parse(
      await service.getAdminReport(reportId)
    )
    noStore(context)
    return context.json(response)
  })

  routes.post(
    '/reports/:reportId/reply-and-close',
    commandGuard,
    async (context) => {
      parseStrictRawQuery(
        context.get('rawRequestTarget'),
        z.object({}).strict(),
        '제보 명령 조건이 올바르지 않습니다.'
      )
      const { reportId } = await validated(
        '제보 ID 형식이 올바르지 않습니다.',
        () =>
          adminReportParamsSchema.parse({
            reportId: context.req.param('reportId')
          })
      )
      const request = await validated(
        '제보 명령 요청이 올바르지 않습니다.',
        async () =>
          replyAndCloseAdminReportRequestSchema.parse(
            await readStrictJsonBody(context.req.raw, REPORT_BODY_CAP)
          )
      )
      const response = adminReportMutationResponseSchema.parse(
        await service.replyAndClose(reportId, request)
      )
      noStore(context)
      return context.json(response)
    }
  )

  routes.post('/reports/:reportId/note', commandGuard, async (context) => {
    parseStrictRawQuery(
      context.get('rawRequestTarget'),
      z.object({}).strict(),
      '제보 명령 조건이 올바르지 않습니다.'
    )
    const { reportId } = await validated(
      '제보 ID 형식이 올바르지 않습니다.',
      () =>
        adminReportParamsSchema.parse({
          reportId: context.req.param('reportId')
        })
    )
    const request = await validated(
      '제보 명령 요청이 올바르지 않습니다.',
      async () =>
        saveAdminReportNoteRequestSchema.parse(
          await readStrictJsonBody(context.req.raw, REPORT_BODY_CAP)
        )
    )
    const response = adminReportMutationResponseSchema.parse(
      await service.saveNote(reportId, request)
    )
    noStore(context)
    return context.json(response)
  })

  routes.post('/reports/:reportId/close', commandGuard, async (context) => {
    parseStrictRawQuery(
      context.get('rawRequestTarget'),
      z.object({}).strict(),
      '제보 명령 조건이 올바르지 않습니다.'
    )
    const { reportId } = await validated(
      '제보 ID 형식이 올바르지 않습니다.',
      () =>
        adminReportParamsSchema.parse({
          reportId: context.req.param('reportId')
        })
    )
    const request = await validated(
      '제보 명령 요청이 올바르지 않습니다.',
      async () =>
        closeAdminReportRequestSchema.parse(
          await readStrictJsonBody(context.req.raw, REPORT_BODY_CAP)
        )
    )
    const response = adminReportMutationResponseSchema.parse(
      await service.close(reportId, request)
    )
    noStore(context)
    return context.json(response)
  })

  return routes
}
