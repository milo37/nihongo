import { delay, http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getHealthLive } from '@api/development/getHealthLive'
import { apiClient } from '@nihongo/browser/api/config'
import { mockServer } from '@/test/server'

afterEach(() => vi.unstubAllEnvs())

describe('development live health', () => {
  it('accepts only the live JSON contract at the root path', async () => {
    mockServer.use(
      http.get('*/health/live', ({ request }) => {
        expect(new URL(request.url).origin).toBe(window.location.origin)
        expect(request.credentials).toBe('omit')
        return HttpResponse.json({ status: 'ok' })
      })
    )
    const request = vi.spyOn(apiClient, 'get')
    await expect(getHealthLive()).resolves.toEqual({ status: 'ok' })
    expect(request).toHaveBeenCalledWith(
      '/health/live',
      expect.objectContaining({
        baseURL: new URL('/', window.location.href).href,
        adapter: 'fetch',
        timeout: 5000,
        withCredentials: false
      })
    )
    request.mockRestore()
  })
  it.each([
    () =>
      new HttpResponse('<html>SPA</html>', {
        headers: { 'Content-Type': 'text/html' }
      }),
    () => HttpResponse.json({ status: 'ready' }),
    () => HttpResponse.json({ status: 'ok', extra: true }),
    () =>
      new HttpResponse('{bad', {
        headers: { 'Content-Type': 'application/json' }
      }),
    () => HttpResponse.json({ status: 'ok' }, { status: 201 }),
    () => HttpResponse.json({ status: 'ok' }, { status: 503 }),
    () => HttpResponse.error()
  ])('rejects invalid responses and failures', async (response) => {
    mockServer.use(http.get('*/health/live', response))
    await expect(getHealthLive()).rejects.toThrow()
  })
  it('propagates bounded timeout failures', async () => {
    const request = vi
      .spyOn(apiClient, 'get')
      .mockRejectedValueOnce(new Error('timeout'))
    await expect(getHealthLive()).rejects.toThrow('timeout')
    request.mockRestore()
  })
})

it('ends a stalled request within the configured timeout', async () => {
  mockServer.use(
    http.get('*/health/live', async () => {
      await delay(5500)
      return HttpResponse.json({ status: 'ok' })
    })
  )
  await expect(getHealthLive()).rejects.toThrow()
}, 7000)

it('cancels an in-flight request explicitly without waiting for the timeout', async () => {
  let started: (() => void) | undefined
  const pending = new Promise<void>((resolve) => {
    started = resolve
  })
  let finish: (() => void) | undefined
  const response = new Promise<void>((resolve) => {
    finish = resolve
  })
  mockServer.use(
    http.get('*/health/live', async () => {
      started?.()
      await response
      return HttpResponse.json({ status: 'ok' })
    })
  )
  const controller = new AbortController()
  const result = expect(getHealthLive(controller.signal)).rejects.toThrow()
  await pending
  controller.abort()
  await result
  finish?.()
})
it('rejects an already-cancelled request without dispatching and never requests in production', async () => {
  const request = vi.spyOn(apiClient, 'get')
  const controller = new AbortController()
  controller.abort()
  await expect(getHealthLive(controller.signal)).rejects.toThrow()
  const calls = request.mock.calls.length
  vi.stubEnv('DEV', false)
  await expect(getHealthLive()).rejects.toThrow(
    'Development diagnostics disabled'
  )
  expect(request).toHaveBeenCalledTimes(calls)
})
