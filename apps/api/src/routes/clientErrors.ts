import { reportClientErrorRequestSchema } from '@nihongo/contracts/observability/report-client-error'
import { Hono } from 'hono'
import { z } from 'zod'
import type { ApiEnvironment } from '../config/env.js'
import { ApplicationError } from '../errors/applicationError.js'
import { readStrictJsonBody } from '../http/strictJsonBody.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import { createClientIpMiddleware } from '../middleware/clientIp.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import type { StructuredLogger } from '../observability/logger.js'
import { toFieldErrors } from './routeSupport.js'

type ClientErrorRouteEnvironment = { Variables: ApiVariables }

const CLIENT_ERROR_BODY_CAP = 2 * 1024

/**
 * POST /api/v1/client-errors (JLP-762). One log line per screen error, no
 * sign-in and nothing stored but the per-IP rate-limit counter.
 */
export const createClientErrorRoutes = ({
  environment,
  logger,
  rateLimiter
}: {
  readonly environment: ApiEnvironment
  readonly logger: StructuredLogger
  readonly rateLimiter: ApplicationRateLimiter
}): Hono<ClientErrorRouteEnvironment> => {
  const routes = new Hono<ClientErrorRouteEnvironment>()
  routes.use(
    '*',
    createClientIpMiddleware(environment.AUTH_TRUSTED_PROXY_CIDRS)
  )

  routes.post('/', async (context) => {
    await rateLimiter.consume({
      clientIp: context.get('clientIp'),
      operation: 'client-error-report',
      windowMs: 60_000,
      max: 20
    })
    let report
    try {
      report = reportClientErrorRequestSchema.parse(
        await readStrictJsonBody(context.req.raw, CLIENT_ERROR_BODY_CAP)
      )
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        throw new ApplicationError({
          code: 'VALIDATION_ERROR',
          message: '오류 보고 형식이 올바르지 않습니다.',
          fieldErrors: toFieldErrors(error),
          retryable: false
        })
      }
      throw error
    }

    logger.warn('client.error.reported', {
      clientDeploymentEnvironment: report.deploymentEnvironment,
      clientReleaseId: report.releaseId,
      occurredAt: report.occurredAt,
      source: report.source,
      routeKey: report.routeKey,
      ...(report.requestId ? { clientRequestId: report.requestId } : {}),
      ...(report.statusClass ? { statusClass: report.statusClass } : {})
    })
    context.header('Cache-Control', 'no-store')
    return context.body(null, 204)
  })

  return routes
}
