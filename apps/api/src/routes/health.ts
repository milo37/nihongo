import { z } from 'zod'
import { Hono } from 'hono'
import { ApplicationError } from '../errors/applicationError.js'
import type { ApiVariables } from '../middleware/requestContext.js'

export const liveHealthResponseSchema = z
  .object({ status: z.literal('ok') })
  .strict()

export const readyHealthResponseSchema = z
  .object({ status: z.literal('ready') })
  .strict()

interface HealthRouteDependencies {
  checkReadiness: () => Promise<void>
  releaseId: string
  readinessTimeoutMs?: number
}

const DEFAULT_READINESS_TIMEOUT_MS = 3_000
const releaseIdSchema = z.string().regex(/^[0-9a-f]{40}$/u)

const waitForReadiness = async (
  checkReadiness: () => Promise<void>,
  timeoutMs: number
): Promise<void> => {
  let timeout: NodeJS.Timeout | undefined

  try {
    await Promise.race([
      checkReadiness(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Readiness check timed out.')),
          timeoutMs
        )
      })
    ])
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

export const createHealthRoutes = ({
  checkReadiness,
  releaseId,
  readinessTimeoutMs = DEFAULT_READINESS_TIMEOUT_MS
}: HealthRouteDependencies): Hono<{ Variables: ApiVariables }> => {
  const routes = new Hono<{ Variables: ApiVariables }>()
  const parsedReleaseId = releaseIdSchema.parse(releaseId)

  routes.get('/live', (context) => {
    context.header('Cache-Control', 'no-store')
    context.header('X-Release-Id', parsedReleaseId)
    return context.json(liveHealthResponseSchema.parse({ status: 'ok' }), 200)
  })

  routes.get('/ready', async (context) => {
    context.header('Cache-Control', 'no-store')
    context.header('X-Release-Id', parsedReleaseId)

    try {
      await waitForReadiness(checkReadiness, readinessTimeoutMs)
    } catch (error: unknown) {
      throw new ApplicationError({
        code: 'SERVICE_UNAVAILABLE',
        message: '서비스 준비 상태를 확인하지 못했습니다.',
        retryable: true,
        cause: error
      })
    }

    return context.json(readyHealthResponseSchema.parse({ status: 'ready' }))
  })

  return routes
}
