import {
  getAdminMemberParamsSchema,
  getAdminMemberResponseSchema,
  listAdminMembersQuerySchema,
  listAdminMembersResponseSchema,
  releaseAdminMemberRestrictionRequestSchema,
  releaseAdminMemberRestrictionResponseSchema,
  restrictAdminMemberRequestSchema,
  restrictAdminMemberResponseSchema
} from '@nihongo/contracts/admin/members'
import { Hono, type MiddlewareHandler } from 'hono'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import type { AdminMemberService } from '../admin/adminMemberService.js'
import { ApplicationError } from '../errors/applicationError.js'
import { parseStrictRawQuery } from '../http/rawQuery.js'
import { readStrictJsonBody } from '../http/strictJsonBody.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import { toFieldErrors } from './routeSupport.js'

type AdminRouteEnvironment = { Variables: ApiVariables }

const MEMBER_BODY_CAP = 16 * 1024

const validated = async <Output>(
  message: string,
  parse: () => Output | Promise<Output>
): Promise<Output> => {
  try {
    return await parse()
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      throw new ApplicationError({
        code: 'VALIDATION_ERROR',
        message,
        fieldErrors: toFieldErrors(error),
        retryable: false
      })
    }
    throw error
  }
}

const noStore = (context: {
  header: (name: string, value: string) => void
}): void => context.header('Cache-Control', 'private, no-store')

/** Restriction commands need an admin sign-in from the last 5 minutes. */
const requireFreshAdminSession = createMiddleware<AdminRouteEnvironment>(
  async (context, next) => {
    if (context.get('adminSessionFresh') !== true) {
      throw new ApplicationError({
        code: 'FRESH_ASSURANCE_REQUIRED',
        message:
          '민감한 관리자 작업을 위해 연결된 SSO 계정으로 다시 인증해 주세요.',
        retryable: false
      })
    }
    await next()
  }
)

export const createAdminMemberRoutes = ({
  commandGuard,
  readGuard,
  service
}: {
  readonly commandGuard: MiddlewareHandler<AdminRouteEnvironment>
  readonly readGuard: MiddlewareHandler<AdminRouteEnvironment>
  readonly service: AdminMemberService
}): Hono<AdminRouteEnvironment> => {
  const routes = new Hono<AdminRouteEnvironment>()

  routes.get('/members', readGuard, async (context) => {
    const query = parseStrictRawQuery(
      context.get('rawRequestTarget'),
      listAdminMembersQuerySchema,
      '회원 목록 조회 조건이 올바르지 않습니다.'
    )
    const response = listAdminMembersResponseSchema.parse(
      await service.listMembers(context.get('adminActorId'), query)
    )
    noStore(context)
    return context.json(response)
  })

  routes.get('/members/:memberId', readGuard, async (context) => {
    const { memberId } = await validated(
      '회원 ID 형식이 올바르지 않습니다.',
      () =>
        getAdminMemberParamsSchema.parse({
          memberId: context.req.param('memberId')
        })
    )
    parseStrictRawQuery(
      context.get('rawRequestTarget'),
      z.object({}).strict(),
      '회원 상세 조회 조건이 올바르지 않습니다.'
    )
    const response = getAdminMemberResponseSchema.parse(
      await service.getMember(context.get('adminActorId'), memberId)
    )
    noStore(context)
    return context.json(response)
  })

  routes.post(
    '/members/:memberId/restriction',
    commandGuard,
    requireFreshAdminSession,
    async (context) => {
      parseStrictRawQuery(
        context.get('rawRequestTarget'),
        z.object({}).strict(),
        '회원 제한 조건이 올바르지 않습니다.'
      )
      const { memberId } = await validated(
        '회원 ID 형식이 올바르지 않습니다.',
        () =>
          getAdminMemberParamsSchema.parse({
            memberId: context.req.param('memberId')
          })
      )
      const request = await validated(
        '회원 제한 요청이 올바르지 않습니다.',
        async () =>
          restrictAdminMemberRequestSchema.parse(
            await readStrictJsonBody(context.req.raw, MEMBER_BODY_CAP)
          )
      )
      const response = restrictAdminMemberResponseSchema.parse(
        await service.restrict({
          actorId: context.get('adminActorId'),
          memberId,
          expectedRowVersion: request.expectedRowVersion,
          reason: request.reason
        })
      )
      noStore(context)
      return context.json(response)
    }
  )

  routes.post(
    '/members/:memberId/restriction-release',
    commandGuard,
    requireFreshAdminSession,
    async (context) => {
      parseStrictRawQuery(
        context.get('rawRequestTarget'),
        z.object({}).strict(),
        '회원 제한 해제 조건이 올바르지 않습니다.'
      )
      const { memberId } = await validated(
        '회원 ID 형식이 올바르지 않습니다.',
        () =>
          getAdminMemberParamsSchema.parse({
            memberId: context.req.param('memberId')
          })
      )
      const request = await validated(
        '회원 제한 해제 요청이 올바르지 않습니다.',
        async () =>
          releaseAdminMemberRestrictionRequestSchema.parse(
            await readStrictJsonBody(context.req.raw, MEMBER_BODY_CAP)
          )
      )
      const response = releaseAdminMemberRestrictionResponseSchema.parse(
        await service.releaseRestriction({
          actorId: context.get('adminActorId'),
          memberId,
          expectedRowVersion: request.expectedRowVersion
        })
      )
      noStore(context)
      return context.json(response)
    }
  )

  return routes
}
