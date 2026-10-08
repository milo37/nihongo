import {
  cancelStudySessionBodySchema,
  cancelStudySessionParamsSchema
} from '@nihongo/contracts/study/cancel-study-session'

const routes = {
  post: (_path: string, _handler: (context: Context) => unknown) => undefined
}

interface Context {
  body: (value: null, status: number) => unknown
  req: {
    json: () => Promise<unknown>
    param: (name: string) => unknown
  }
}

routes.post('/:sessionId/cancellation', async (context) => {
  cancelStudySessionParamsSchema.parse({
    sessionId: context.req.param('sessionId')
  })
  cancelStudySessionBodySchema.parse(await context.req.json())
  return context.body(null, 204)
})
