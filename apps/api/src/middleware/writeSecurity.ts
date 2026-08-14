import { createMiddleware } from 'hono/factory'
import type { ApiEnvironment } from '../config/env.js'
import { ApplicationError } from '../errors/applicationError.js'
import type { ApiVariables } from './requestContext.js'

const WRITE_METHODS = new Set(['DELETE', 'PATCH', 'POST', 'PUT'])
const JSON_CONTENT_TYPE_PATTERN = /^application\/json(?:\s*;|$)/iu

export const createWriteSecurity = (environment: ApiEnvironment) =>
  createMiddleware<{ Variables: ApiVariables }>(async (context, next) => {
    if (!WRITE_METHODS.has(context.req.method)) {
      await next()
      return
    }

    if (context.req.method !== 'DELETE') {
      const contentType = context.req.header('Content-Type') ?? ''
      if (!JSON_CONTENT_TYPE_PATTERN.test(contentType)) {
        throw new ApplicationError({
          code: 'INVALID_REQUEST',
          message: 'JSON 요청만 허용됩니다.',
          retryable: false
        })
      }
    }

    const origin = context.req.header('Origin')
    const fetchSite = context.req.header('Sec-Fetch-Site')
    const isTrustedOrigin =
      origin !== undefined && environment.TRUSTED_ORIGINS.includes(origin)
    const isSameOriginRequest =
      origin === undefined && fetchSite === 'same-origin'

    if (!isTrustedOrigin && !isSameOriginRequest) {
      throw new ApplicationError({
        code: 'UNTRUSTED_ORIGIN',
        message: '허용되지 않은 요청 출처입니다.',
        retryable: false
      })
    }

    await next()
  })
