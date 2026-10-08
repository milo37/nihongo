import {
  assertReauthenticateAdminResponse,
  phase7EmptyQuerySchema,
  reauthenticateAdminRequestSchema,
  reauthenticateAdminResponseSchema
} from '@nihongo/contracts/admin/phase7'
import { Hono, type MiddlewareHandler } from 'hono'
import { z } from 'zod'
import type { AdminReauthenticationService } from '../admin/adminReauthenticationService.js'
import { getPhase7OperationBodyCap } from '../admin/adminCommandGuard.js'
import { ApplicationError } from '../errors/applicationError.js'
import { readPhase7JsonBody } from '../http/phase7JsonBody.js'
import { parseStrictRawQuery } from '../http/rawQuery.js'
import type { ApiVariables } from '../middleware/requestContext.js'

type AdminRouteEnvironment = { Variables: ApiVariables }

const toFieldErrors = (error: z.ZodError): Record<string, string[]> => {
  const fieldErrors: Record<string, string[]> = {}
  for (const issue of error.issues) {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'request'
    fieldErrors[path] = [...(fieldErrors[path] ?? []), issue.message]
  }
  return fieldErrors
}

const assertEmptyQuery = (requestTarget: string): void => {
  try {
    parseStrictRawQuery(
      requestTarget,
      phase7EmptyQuerySchema,
      '관리자 재인증 쿼리 문자열이 올바르지 않습니다.'
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
      message: '관리자 재인증 응답 무결성을 확인할 수 없습니다.',
      retryable: false,
      phase7Disposition: 'COMMIT_CONFIRMED',
      cause: error
    })
  }
}

export const createAdminReauthenticationRoutes = ({
  guard,
  service
}: {
  guard: MiddlewareHandler<AdminRouteEnvironment>
  service: AdminReauthenticationService
}): Hono<AdminRouteEnvironment> => {
  const routes = new Hono<AdminRouteEnvironment>()

  routes.post('/reauthentication', guard, async (context) => {
    assertEmptyQuery(context.get('rawRequestTarget'))
    const raw = await readPhase7JsonBody(
      context.req.raw,
      getPhase7OperationBodyCap('reauthenticateAdmin')
    )
    const parsed = reauthenticateAdminRequestSchema.safeParse(raw)
    if (!parsed.success) {
      throw new ApplicationError({
        code: 'VALIDATION_ERROR',
        message: '관리자 재인증 요청이 올바르지 않습니다.',
        fieldErrors: toFieldErrors(parsed.error),
        retryable: false,
        phase7Disposition: 'NO_TX'
      })
    }
    const request = reauthenticateAdminRequestSchema.parse(parsed.data)

    const output = await service.reauthenticate({
      actorId: context.get('adminActorId'),
      headers: context.req.raw.headers,
      password: request.password,
      rawSessionToken: context.get('adminSessionToken'),
      requestId: context.get('requestId')
    })
    const committedResponse = assertCommittedResponse(() =>
      reauthenticateAdminResponseSchema.parse(
        assertReauthenticateAdminResponse(request, output.response)
      )
    )
    const response = reauthenticateAdminResponseSchema.parse(committedResponse)
    for (const cookie of output.setCookies) {
      context.header('Set-Cookie', cookie, { append: true })
    }
    context.header('Cache-Control', 'private, no-store')
    return context.json(response)
  })

  return routes
}
