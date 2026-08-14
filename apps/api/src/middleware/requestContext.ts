import { randomUUID } from 'node:crypto'
import { requestIdSchema } from '@nihongo/contracts/common/id'
import { createMiddleware } from 'hono/factory'

export interface ApiVariables {
  requestId: string
}

export const requestContext = createMiddleware<{
  Variables: ApiVariables
}>(async (context, next) => {
  const incomingRequestId = context.req.header('X-Request-Id')
  const parsedRequestId = requestIdSchema.safeParse(incomingRequestId)
  const requestId = parsedRequestId.success
    ? parsedRequestId.data
    : randomUUID()

  context.set('requestId', requestId)

  try {
    await next()
  } finally {
    context.header('X-Request-Id', requestId)
  }
})
