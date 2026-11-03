import type { MiddlewareHandler } from 'hono'
import { createMiddleware } from 'hono/factory'
import type { ApiEnvironment } from '../config/env.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import {
  assertDeclaredBodyBound,
  assertJsonTransport,
  assertTrustedOrigin
} from './adminCommandGuard.js'

type AdminRouteEnvironment = { Variables: ApiVariables }

const CONSOLE_COMMAND_BODY_CAP = 16 * 1024

/**
 * Operations console (#484) commands without re-authentication: the content
 * manifest guard does not apply, so transport and origin are checked here
 * before the admin session guard.
 */
export const createAdminConsoleCommandGuard = ({
  environment,
  readGuard
}: {
  readonly environment: ApiEnvironment
  readonly readGuard: MiddlewareHandler<AdminRouteEnvironment>
}): MiddlewareHandler<AdminRouteEnvironment> =>
  createMiddleware<AdminRouteEnvironment>(async (context, next) => {
    assertDeclaredBodyBound(context, CONSOLE_COMMAND_BODY_CAP)
    assertJsonTransport(context)
    assertTrustedOrigin(context, environment)
    await readGuard(context, next)
  })
