import { getCurrentPrincipalResponseSchema } from '@nihongo/contracts/auth/get-current-principal'

const routes = {
  delete: (_path: string, _handler: (context: Context) => unknown) => undefined,
  get: (_path: string, _handler: (context: Context) => unknown) => undefined
}

interface Context {
  body: (value: null, status: number) => unknown
  json: (value: unknown) => unknown
  req: {
    json: () => Promise<unknown>
    param: (name: string) => unknown
    raw: { headers: Headers }
  }
}

routes.get('/me', (context) => {
  void context.req.raw.headers
  const response = getCurrentPrincipalResponseSchema.parse({ kind: 'GUEST' })
  return context.json(response)
})

routes.delete('/guest-principal', (context) => context.body(null, 204))
