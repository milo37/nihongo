import { paramsSchema } from '@nihongo/contracts/question/get-question'

const routes = {
  get: (_path: string, _handler: (context: Context) => unknown) => undefined
}

interface Context {
  json: (value: unknown) => unknown
  req: { param: () => unknown }
}

const fakeResponseSchema = {
  parse: (value: unknown): unknown => value
}

routes.get('/questions/:questionId', (context) => {
  const params = paramsSchema.parse(context.req.param())
  return context.json(fakeResponseSchema.parse({ id: params.questionId }))
})
