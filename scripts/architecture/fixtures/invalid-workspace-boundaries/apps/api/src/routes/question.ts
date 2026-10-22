const routes = {
  get: (_path: string, _handler: (context: Context) => unknown) => undefined
}

interface Context {
  json: (value: unknown) => unknown
  req: { param: () => unknown }
}

routes.get('/questions/:questionId', (context) =>
  context.json({ id: context.req.param() })
)
