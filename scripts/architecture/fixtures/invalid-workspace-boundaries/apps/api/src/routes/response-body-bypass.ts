import {
  paramsSchema,
  responseSchema
} from '@nihongo/contracts/question/get-question'

const routes = {
  get: (_path: string, _handler: (context: Context) => unknown) => undefined
}

interface Context {
  body: (value: unknown) => unknown
  req: { param: () => unknown }
}

routes.get('/questions/:questionId/attachment', (context) => {
  const params = paramsSchema.parse(context.req.param())
  void responseSchema
  return context.body({ id: params.questionId })
})
