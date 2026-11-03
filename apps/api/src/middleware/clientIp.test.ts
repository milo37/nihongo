import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { createClientIpMiddleware } from './clientIp.js'
import type { ApiVariables } from './requestContext.js'

const createProbe = (trustedProxyCidrs: readonly string[]) => {
  const app = new Hono<{ Variables: ApiVariables }>()
  app.use('*', createClientIpMiddleware(trustedProxyCidrs))
  app.get('/', (context) => context.text(context.get('clientIp')))
  return app
}

const peerEnvironment = (remoteAddress: string) => ({
  incoming: {
    socket: { remoteAddress, remotePort: 40_000, remoteFamily: 'IPv4' }
  }
})

describe('createClientIpMiddleware', () => {
  it('returns unresolved when no peer connection is available', async () => {
    const response = await createProbe([]).request('/')
    expect(await response.text()).toBe('unresolved')
  })

  it('ignores X-Forwarded-For from an untrusted peer', async () => {
    const response = await createProbe([]).request(
      '/',
      { headers: { 'X-Forwarded-For': '203.0.113.9' } },
      peerEnvironment('198.51.100.7')
    )
    expect(await response.text()).toBe('198.51.100.7')
  })

  it('uses X-Forwarded-For from a trusted proxy peer', async () => {
    const response = await createProbe(['10.0.0.0/8']).request(
      '/',
      { headers: { 'X-Forwarded-For': '203.0.113.9' } },
      peerEnvironment('10.1.2.3')
    )
    expect(await response.text()).toBe('203.0.113.9')
  })
})
