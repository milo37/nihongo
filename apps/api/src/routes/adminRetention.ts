import {
  getAdminRetentionQuerySchema,
  getAdminRetentionResponseSchema
} from '@nihongo/contracts/admin/retention'
import { Hono, type MiddlewareHandler } from 'hono'
import type { AdminRetentionReader } from '../admin/adminRetention.js'
import { parseStrictRawQuery } from '../http/rawQuery.js'
import type { ApiVariables } from '../middleware/requestContext.js'

type AdminRouteEnvironment = { Variables: ApiVariables }

/** #1266: the daily return counts of #1042, read only, admin only. */
export const createAdminRetentionRoutes = ({
  now = () => new Date(),
  readGuard,
  reader
}: {
  readonly now?: () => Date
  readonly readGuard: MiddlewareHandler<AdminRouteEnvironment>
  readonly reader: AdminRetentionReader
}): Hono<AdminRouteEnvironment> => {
  const routes = new Hono<AdminRouteEnvironment>()

  routes.get('/retention', readGuard, async (context) => {
    parseStrictRawQuery(
      context.get('rawRequestTarget'),
      getAdminRetentionQuerySchema,
      '재방문율 조회 조건이 올바르지 않습니다.'
    )
    const response = getAdminRetentionResponseSchema.parse(
      await reader.read(now())
    )
    context.header('Cache-Control', 'private, no-store')
    return context.json(response)
  })

  return routes
}
