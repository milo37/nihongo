import { getConnInfo } from '@hono/node-server/conninfo'
import { createMiddleware } from 'hono/factory'
import { createClientIpAuthority } from '../auth/clientIp.js'
import type { ApiVariables } from './requestContext.js'

export const createClientIpMiddleware = (
  trustedProxyCidrs: readonly string[]
) => {
  const clientIpAuthority = createClientIpAuthority(trustedProxyCidrs)
  return createMiddleware<{ Variables: ApiVariables }>(
    async (context, next) => {
      let peerAddress: string | undefined
      try {
        peerAddress = getConnInfo(context).remote.address
      } catch {
        peerAddress = undefined
      }
      context.set(
        'clientIp',
        clientIpAuthority.resolve(
          peerAddress,
          context.req.header('X-Forwarded-For') ?? null
        )
      )
      await next()
    }
  )
}
