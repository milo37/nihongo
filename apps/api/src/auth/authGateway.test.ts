import type { PrismaClient } from '../generated/prisma/client.js'
import { describe, expect, it, vi } from 'vitest'
import type { ApiEnvironment } from '../config/env.js'
import {
  AuthGatewayError,
  createAuthGateway,
  sanitizeAuthResponse
} from './authGateway.js'

const environment = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: 3001,
  DATABASE_URL: 'postgresql://localhost/nihongo_test',
  TRUSTED_ORIGINS: ['http://localhost:5173'],
  LOG_LEVEL: 'silent',
  BETTER_AUTH_SECRET: 'auth-secret-that-is-at-least-32-characters',
  BETTER_AUTH_URL: 'http://localhost:3001',
  GUEST_COOKIE_SECRET: 'guest-secret-that-is-at-least-32-characters',
  AUTH_EMAIL_FROM: 'auth@example.test',
  AUTH_EMAIL_DELIVERY_MODE: 'test-sink',
  AUTH_TRUSTED_PROXY_CIDRS: ['127.0.0.1/32', '::1/128']
} satisfies ApiEnvironment

const createClient = () => {
  const deleteMany = vi.fn().mockResolvedValue({ count: 1 })
  return {
    client: { session: { deleteMany } } as unknown as PrismaClient,
    deleteMany
  }
}

describe('auth gateway', () => {
  it('성공 JSON에서 재귀적으로 credential을 제거한다', async () => {
    const response = await sanitizeAuthResponse(
      Response.json({
        token: 'credential',
        user: { id: 'user-id', password: 'credential' },
        session: { id: 'session-id', token: 'credential' }
      })
    )

    expect(await response.json()).toEqual({
      user: { id: 'user-id' },
      session: { id: 'session-id' }
    })
  })

  it('승인된 경로만 exact origin과 JSON으로 전달한다', async () => {
    const handler = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ token: 'secret', user: { id: 'user' } }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': 'nihongo.session_token=cookie; HttpOnly; SameSite=Lax'
        }
      })
    )
    const { client } = createClient()
    const gateway = createAuthGateway({
      auth: {
        handler,
        api: { getSession: vi.fn().mockResolvedValue(null) }
      },
      client,
      environment
    })

    const response = await gateway.handle(
      new Request('http://localhost:3001/api/auth/sign-in/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:5173'
        },
        body: JSON.stringify({ email: 'user@example.com', password: 'secret' })
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(response.headers.get('Set-Cookie')).toContain('HttpOnly')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'http://localhost:5173'
    )
    expect(response.headers.get('Access-Control-Expose-Headers')).toBe(
      'Retry-After, X-Request-Id'
    )
  })

  it('미승인 경로·origin·content type을 handler 전에 거부한다', async () => {
    const handler = vi.fn()
    const { client } = createClient()
    const gateway = createAuthGateway({
      auth: {
        handler,
        api: { getSession: vi.fn().mockResolvedValue(null) }
      },
      client,
      environment
    })

    await expect(
      gateway.handle(
        new Request('http://localhost:3001/api/auth/delete-user', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost:5173'
          },
          body: '{}'
        })
      )
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      gateway.handle(
        new Request('http://localhost:3001/api/auth/sign-in/email', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://attacker.example'
          },
          body: '{}'
        })
      )
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      gateway.handle(
        new Request('http://localhost:3001/api/auth/sign-in/email', {
          method: 'POST',
          headers: { Origin: 'http://localhost:5173' },
          body: 'email=user'
        })
      )
    ).rejects.toMatchObject({ status: 415 })
    expect(handler).not.toHaveBeenCalled()
  })

  it('native 429 응답에 Retry-After가 없으면 gateway 기본값을 제공한다', async () => {
    const handler = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { code: 'TOO_MANY_REQUESTS', message: 'Too many requests.' },
          { status: 429 }
        )
      )
    const { client } = createClient()
    const gateway = createAuthGateway({
      auth: {
        handler,
        api: { getSession: vi.fn().mockResolvedValue(null) }
      },
      client,
      environment
    })

    const response = await gateway.handle(
      new Request('http://localhost:3001/api/auth/sign-in/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:5173'
        },
        body: JSON.stringify({
          email: 'user@example.com',
          password: 'password-password'
        })
      })
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('60')
  })

  it('verification callback을 고정하고 password reset redirect 입력을 제거한다', async () => {
    const forwardedBodies: Array<Record<string, unknown>> = []
    const handler = vi.fn(async (request: Request) => {
      forwardedBodies.push((await request.json()) as Record<string, unknown>)
      return Response.json({ status: true })
    })
    const { client } = createClient()
    const gateway = createAuthGateway({
      auth: {
        handler,
        api: { getSession: vi.fn().mockResolvedValue(null) }
      },
      client,
      environment
    })
    const headers = {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:5173'
    }

    await gateway.handle(
      new Request('http://localhost:3001/api/auth/sign-up/email', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          callbackURL: 'https://attacker.example',
          email: 'user@example.com',
          name: '사용자',
          password: 'password-password'
        })
      })
    )
    await gateway.handle(
      new Request('http://localhost:3001/api/auth/request-password-reset', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email: 'user@example.com',
          redirectTo: 'https://attacker.example'
        })
      })
    )

    expect(forwardedBodies[0]).toMatchObject({
      callbackURL: 'http://localhost:5173/login?verified=1'
    })
    expect(forwardedBodies[1]).not.toHaveProperty('redirectTo')
  })

  it('password 변경은 전체 session을 폐기하고 cookie를 만료한다', async () => {
    const handler = vi.fn(async (request: Request) => {
      expect(await request.json()).toMatchObject({
        revokeOtherSessions: true
      })
      return Response.json({ success: true })
    })
    const { client, deleteMany } = createClient()
    const gateway = createAuthGateway({
      auth: {
        handler,
        api: {
          getSession: vi.fn().mockResolvedValue({
            session: { id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1' },
            user: { id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a2' }
          })
        }
      },
      client,
      environment
    })

    const response = await gateway.handle(
      new Request('http://localhost:3001/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:5173'
        },
        body: JSON.stringify({
          currentPassword: 'old-password',
          newPassword: 'new-password'
        })
      })
    )

    expect(deleteMany).toHaveBeenCalledWith({
      where: { userId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a2' }
    })
    expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0')
  })

  it('malformed·scalar·array JSON을 handler 전에 400으로 거부한다', async () => {
    const handler = vi.fn()
    const { client } = createClient()
    const gateway = createAuthGateway({
      auth: {
        handler,
        api: { getSession: vi.fn().mockResolvedValue(null) }
      },
      client,
      environment
    })

    for (const body of ['{', 'null', '[]', '"scalar"']) {
      await expect(
        gateway.handle(
          new Request('http://localhost:3001/api/auth/sign-in/email', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Origin: 'http://localhost:5173'
            },
            body
          })
        )
      ).rejects.toMatchObject({ code: 'INVALID_JSON', status: 400 })
    }
    expect(handler).not.toHaveBeenCalled()
  })

  it('chunked body가 제한을 넘으면 stream을 취소하고 413으로 거부한다', async () => {
    const handler = vi.fn()
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      pull: (controller) => {
        controller.enqueue(new Uint8Array(32 * 1_024 + 1))
      },
      cancel
    })
    const { client } = createClient()
    const gateway = createAuthGateway({
      auth: {
        handler,
        api: { getSession: vi.fn().mockResolvedValue(null) }
      },
      client,
      environment
    })

    await expect(
      gateway.handle(
        new Request('http://localhost:3001/api/auth/sign-in/email', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost:5173'
          },
          body,
          duplex: 'half'
        } as RequestInit & { duplex: 'half' })
      )
    ).rejects.toMatchObject({ code: 'REQUEST_TOO_LARGE', status: 413 })
    expect(cancel).toHaveBeenCalledOnce()
    expect(handler).not.toHaveBeenCalled()
  })

  it('선언된 큰 body도 stream을 취소하고 handler 전에 거부한다', async () => {
    const handler = vi.fn()
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel })
    const { client } = createClient()
    const gateway = createAuthGateway({
      auth: {
        handler,
        api: { getSession: vi.fn().mockResolvedValue(null) }
      },
      client,
      environment
    })

    await expect(
      gateway.handle(
        new Request('http://localhost:3001/api/auth/sign-in/email', {
          method: 'POST',
          headers: {
            'Content-Length': String(32 * 1_024 + 1),
            'Content-Type': 'application/json',
            Origin: 'http://localhost:5173'
          },
          body,
          duplex: 'half'
        } as RequestInit & { duplex: 'half' })
      )
    ).rejects.toMatchObject({ code: 'REQUEST_TOO_LARGE', status: 413 })
    expect(cancel).toHaveBeenCalledOnce()
    expect(handler).not.toHaveBeenCalled()
  })

  it('slow body는 deadline에 stream을 취소하고 408로 거부한다', async () => {
    vi.useFakeTimers()
    try {
      const handler = vi.fn()
      const cancel = vi.fn()
      const body = new ReadableStream<Uint8Array>({ cancel })
      const { client } = createClient()
      const gateway = createAuthGateway({
        auth: {
          handler,
          api: { getSession: vi.fn().mockResolvedValue(null) }
        },
        client,
        environment
      })

      const request = gateway.handle(
        new Request('http://localhost:3001/api/auth/sign-in/email', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost:5173'
          },
          body,
          duplex: 'half'
        } as RequestInit & { duplex: 'half' })
      )
      const timeoutAssertion = expect(request).rejects.toMatchObject({
        code: 'REQUEST_TIMEOUT',
        status: 408
      })
      await vi.advanceTimersByTimeAsync(5_000)

      await timeoutAssertion
      expect(cancel).toHaveBeenCalledOnce()
      expect(handler).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('public get-session과 same-site fallback을 허용하지 않는다', async () => {
    const handler = vi.fn()
    const { client } = createClient()
    const gateway = createAuthGateway({
      auth: {
        handler,
        api: { getSession: vi.fn().mockResolvedValue(null) }
      },
      client,
      environment
    })

    await expect(
      gateway.handle(new Request('http://localhost:3001/api/auth/get-session'))
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      gateway.handle(
        new Request('http://localhost:3001/api/auth/sign-out', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Sec-Fetch-Site': 'same-site'
          },
          body: '{}'
        })
      )
    ).rejects.toMatchObject({ status: 403 })
    expect(handler).not.toHaveBeenCalled()
  })

  it('verify-email POST token만 native GET으로 전달하고 body를 축소한다', async () => {
    const handler = vi.fn(async (request: Request) => {
      const url = new URL(request.url)
      expect(request.method).toBe('GET')
      expect(url.pathname).toBe('/api/auth/verify-email')
      expect(url.searchParams.get('token')).toBe('signed-token')
      expect(url.searchParams.has('callbackURL')).toBe(false)
      return Response.json({ status: true, user: { email: 'secret' } })
    })
    const { client } = createClient()
    const gateway = createAuthGateway({
      auth: {
        handler,
        api: { getSession: vi.fn().mockResolvedValue(null) }
      },
      client,
      environment
    })

    const response = await gateway.handle(
      new Request('http://localhost:3001/api/auth/verify-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:5173'
        },
        body: JSON.stringify({ token: 'signed-token' })
      })
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
  })

  it.each([
    ['/api/auth/request-password-reset', { email: 'user@example.com' }],
    ['/api/auth/send-verification-email', { email: 'user@example.com' }],
    [
      '/api/auth/sign-up/email',
      {
        email: 'user@example.com',
        name: '사용자',
        password: 'password-password'
      }
    ]
  ])('production %s 응답 시간을 동일 floor로 맞춘다', async (path, body) => {
    const delay = vi.fn().mockResolvedValue(undefined)
    const { client } = createClient()
    const gateway = createAuthGateway({
      auth: {
        handler: vi.fn().mockResolvedValue(Response.json({ status: true })),
        api: { getSession: vi.fn().mockResolvedValue(null) }
      },
      client,
      delay,
      environment: {
        ...environment,
        NODE_ENV: 'production',
        BETTER_AUTH_URL: 'https://nihongo.example.com',
        TRUSTED_ORIGINS: ['https://nihongo.example.com']
      },
      now: () => 0
    })

    await gateway.handle(
      new Request(`https://nihongo.example.com${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://nihongo.example.com'
        },
        body: JSON.stringify(body)
      })
    )
    expect(delay).toHaveBeenCalledWith(5_250)
  })

  it('error type에 민감한 입력을 포함하지 않는다', () => {
    expect(new AuthGatewayError(403, 'UNTRUSTED_ORIGIN').message).toBe(
      'UNTRUSTED_ORIGIN'
    )
  })
})
