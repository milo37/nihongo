import { createMiddleware } from 'hono/factory'
import { routePath } from 'hono/route'
import type { ApiVariables } from './requestContext.js'
import type { StructuredLogger } from '../observability/logger.js'

export const createRequestLogger = (logger: StructuredLogger) =>
  createMiddleware<{ Variables: ApiVariables }>(async (context, next) => {
    const startedAt = performance.now()
    let completed = false

    try {
      await next()
      completed = true
    } finally {
      if (completed) {
        logger.info('http.request.completed', {
          requestId: context.get('requestId'),
          method: context.req.method,
          path: routePath(context, -1),
          status: context.res.status,
          durationMs: Math.round((performance.now() - startedAt) * 100) / 100
        })
      }
    }
  })
