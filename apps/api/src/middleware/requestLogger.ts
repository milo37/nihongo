import { createMiddleware } from 'hono/factory'
import { routePath } from 'hono/route'
import type { ApiVariables } from './requestContext.js'
import type { StructuredLogger } from '../observability/logger.js'
import {
  toBoundedDurationMs,
  toHttpStatusClass
} from '../observability/httpLog.js'

export const createRequestLogger = (logger: StructuredLogger) =>
  createMiddleware<{ Variables: ApiVariables }>(async (context, next) => {
    const startedAt = performance.now()
    context.set('requestStartedAt', startedAt)
    let completed = false

    try {
      await next()
      completed = true
    } finally {
      if (completed) {
        logger.info('http.request.completed', {
          requestId: context.get('requestId'),
          routeTemplate: routePath(context, -1),
          statusClass: toHttpStatusClass(context.res.status),
          durationMs: toBoundedDurationMs(startedAt)
        })
      }
    }
  })
