import {
  paramsSchema,
  responseSchema
} from '@nihongo/contracts/question/get-question'

const routes = {
  get: (_path: string, _handler: (context: Context) => unknown) => undefined
}

interface Context {
  json: (value: unknown) => unknown
  req: { param: () => unknown }
}

routes.get('/questions/:questionId', (context) => {
  const params = paramsSchema.parse(context.req.param())
  void responseSchema
  return context.json({ id: params.questionId })
})
