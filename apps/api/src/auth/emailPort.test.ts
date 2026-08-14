import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiEnvironment } from '../config/env.js'
import { createAuthEmailPort } from './emailPort.js'

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
  AUTH_EMAIL_DELIVERY_MODE: 'webhook',
  AUTH_EMAIL_WEBHOOK_URL: 'https://mail.example.test/auth',
  AUTH_EMAIL_WEBHOOK_SECRET: 'webhook-secret-that-is-at-least-32-characters',
  AUTH_TRUSTED_PROXY_CIDRS: ['127.0.0.1/32']
} satisfies ApiEnvironment

const message = {
  from: 'auth@example.test',
  purpose: 'EMAIL_VERIFICATION',
  recipient: 'user@example.test',
  url: 'https://nihongo.example.test/verify-email#token=private'
} as const

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('webhook auth email port', () => {
  it('일시 실패는 한 번 재시도한 뒤 성공한다', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createAuthEmailPort(environment).send(message)).resolves.toBe(
      undefined
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('두 번 실패하면 민감 정보 없는 일반 오류로 닫는다', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      createAuthEmailPort(environment).send(message)
    ).rejects.toThrow('Auth email delivery failed.')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('성공·실패 응답 body를 모두 취소해 연결을 반환한다', async () => {
    const firstCancel = vi.fn()
    const secondCancel = vi.fn()
    const createStreamingResponse = (
      status: number,
      cancel: () => void
    ): Response =>
      new Response(
        new ReadableStream({
          cancel,
          start: (controller) =>
            controller.enqueue(new TextEncoder().encode('ignored body'))
        }),
        { status }
      )
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(createStreamingResponse(503, firstCancel))
        .mockResolvedValueOnce(createStreamingResponse(200, secondCancel))
    )

    await expect(createAuthEmailPort(environment).send(message)).resolves.toBe(
      undefined
    )
    expect(firstCancel).toHaveBeenCalledOnce()
    expect(secondCancel).toHaveBeenCalledOnce()
  })
})
