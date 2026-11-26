import {
  deletePushSubscriptionRequestSchema,
  pushConfigResponseSchema,
  putPushSubscriptionRequestSchema
} from '@nihongo/contracts/notification/web-push'
import { ECDH } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import type { PrincipalService } from '../auth/principalService.js'
import type { ApiEnvironment } from '../config/env.js'
import { ApplicationError } from '../errors/applicationError.js'
import { readStrictJsonBody } from '../http/strictJsonBody.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import { createClientIpMiddleware } from '../middleware/clientIp.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import type { PushSubscriptionStore } from '../notification/pushSubscriptionStore.js'
import { appendAuthHeaders, toFieldErrors } from './routeSupport.js'

type WebPushRouteEnvironment = { Variables: ApiVariables }

const PUSH_SUBSCRIPTION_BODY_CAP = 4 * 1024

/**
 * The contract only checks the shape. A key that is not a point on P-256 would
 * pass it, then fail every send with a plain error and never be removed, so
 * the route checks the point itself.
 */
const isP256PublicKey = (p256dh: string): boolean => {
  try {
    ECDH.convertKey(Buffer.from(p256dh, 'base64url'), 'prime256v1')
    return true
  } catch {
    return false
  }
}

/**
 * #1046: /api/v1/push. The daily goal web push: the public key, subscribe
 * (members only; the subscription belongs to the member) and turn off (no
 * sign-in needed, so logout can call it).
 */
export const createWebPushRoutes = ({
  environment,
  principalService,
  publicKey,
  rateLimiter,
  store
}: {
  readonly environment: ApiEnvironment
  readonly principalService: PrincipalService
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
    context: Context<WebPushRouteEnvironment>,
    schema: z.ZodType<T>
  ): Promise<T> => {
    await rateLimiter.consume({
      clientIp: context.get('clientIp'),
      operation: 'push-subscription',
      windowMs: 60_000,
      max: 10
    })
    try {
      return schema.parse(
        await readStrictJsonBody(context.req.raw, PUSH_SUBSCRIPTION_BODY_CAP)
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

  const memberId = async (
    context: Context<WebPushRouteEnvironment>
  ): Promise<string> => {
    const resolution = await principalService.resolveAuthenticatedUser(
      context.req.raw.headers
    )
    appendAuthHeaders(context, resolution, environment)
    if (!resolution.user) {
      throw new ApplicationError({
        code: resolution.clearSessionCookie
          ? 'AUTH_SESSION_EXPIRED'
          : 'AUTHENTICATION_REQUIRED',
        message: resolution.clearSessionCookie
          ? '로그인 세션이 만료됐습니다.'
          : '알림은 로그인이 필요합니다.',
        retryable: false
      })
    }
    return resolution.user.id
  }

  routes.get('/config', (context) => {
    context.header('Cache-Control', 'no-store')
    return context.json(pushConfigResponseSchema.parse({ publicKey }))
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
      context,
      putPushSubscriptionRequestSchema
    )
    if (!isP256PublicKey(subscription.keys.p256dh)) {
      throw new ApplicationError({
        code: 'VALIDATION_ERROR',
        message: '알림 구독 형식이 올바르지 않습니다.',
        fieldErrors: { 'keys.p256dh': ['P-256 공개 키가 아닙니다.'] },
        retryable: false
      })
    }
    await store.save({
      userId: await memberId(context),
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
      context,
      deletePushSubscriptionRequestSchema
    )
    await store.remove(endpoint)
    context.header('Cache-Control', 'no-store')
    return context.body(null, 204)
  })

  return routes
}
