import {
  deletePushSubscriptionRequestSchema,
  putPushSubscriptionRequestSchema,
  type PushConfigResponse
} from '@nihongo/contracts/notification/web-push'
import { Hono } from 'hono'
import { z } from 'zod'
import type { ApiEnvironment } from '../config/env.js'
import { ApplicationError } from '../errors/applicationError.js'
import { readStrictJsonBody } from '../http/strictJsonBody.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import { createClientIpMiddleware } from '../middleware/clientIp.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import type { PushSubscriptionStore } from '../notification/pushSubscriptionStore.js'
import { toFieldErrors } from './routeSupport.js'

type WebPushRouteEnvironment = { Variables: ApiVariables }

const PUSH_SUBSCRIPTION_BODY_CAP = 4 * 1024

/**
 * #1046: /api/v1/push. The daily web push: the public key, subscribe and turn
 * off. No sign-in; members and guests are the same, and nothing ties a
 * subscription to a person.
 */
export const createWebPushRoutes = ({
  environment,
  publicKey,
  rateLimiter,
  store
}: {
  readonly environment: ApiEnvironment
  /** VAPID public key; null keeps push off (config says so, writes refuse). */
  readonly publicKey: string | null
  readonly rateLimiter: ApplicationRateLimiter
  readonly store: PushSubscriptionStore
}): Hono<WebPushRouteEnvironment> => {
  const routes = new Hono<WebPushRouteEnvironment>()
  routes.use(
    '*',
    createClientIpMiddleware(environment.AUTH_TRUSTED_PROXY_CIDRS)
  )

  const readBody = async <T>(
    clientIp: string,
    request: Request,
    schema: z.ZodType<T>
  ): Promise<T> => {
    await rateLimiter.consume({
      clientIp,
      operation: 'push-subscription',
      windowMs: 60_000,
      max: 10
    })
    try {
      return schema.parse(
        await readStrictJsonBody(request, PUSH_SUBSCRIPTION_BODY_CAP)
      )
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        throw new ApplicationError({
          code: 'VALIDATION_ERROR',
          message: '알림 구독 형식이 올바르지 않습니다.',
          fieldErrors: toFieldErrors(error),
          retryable: false
        })
      }
      throw error
    }
  }

  routes.get('/config', (context) => {
    context.header('Cache-Control', 'no-store')
    return context.json<PushConfigResponse>({ publicKey })
  })

  routes.put('/subscription', async (context) => {
    if (publicKey === null) {
      throw new ApplicationError({
        code: 'SERVICE_UNAVAILABLE',
        message: '알림이 꺼져 있습니다.',
        retryable: false
      })
    }
    const subscription = await readBody(
      context.get('clientIp'),
      context.req.raw,
      putPushSubscriptionRequestSchema
    )
    await store.save({
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      locale: subscription.locale
    })
    context.header('Cache-Control', 'no-store')
    return context.body(null, 204)
  })

  routes.delete('/subscription', async (context) => {
    const { endpoint } = await readBody(
      context.get('clientIp'),
      context.req.raw,
      deletePushSubscriptionRequestSchema
    )
    await store.remove(endpoint)
    context.header('Cache-Control', 'no-store')
    return context.body(null, 204)
  })

  return routes
}
