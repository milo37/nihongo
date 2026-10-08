import { describe, expect, it, vi } from 'vitest'
import { ApplicationError } from '../errors/applicationError.js'
import { readBoundedJsonObject } from './boundedJson.js'

describe('readBoundedJsonObject', () => {
  it('제한 안의 JSON object를 읽는다', async () => {
    const request = new Request('http://localhost/api/v1/study-sessions', {
      method: 'POST',
      body: JSON.stringify({ count: 5 })
    })
    await expect(
      readBoundedJsonObject(request, { maxBytes: 100 })
    ).resolves.toEqual({ count: 5 })
  })

  it('malformed·scalar JSON을 INVALID_JSON으로 거부한다', async () => {
    for (const body of ['{', 'null', '[]']) {
      const request = new Request('http://localhost/api/v1/study-sessions', {
        method: 'POST',
        body
      })
      await expect(readBoundedJsonObject(request)).rejects.toMatchObject({
        code: 'INVALID_JSON'
      } satisfies Partial<ApplicationError>)
    }
  })

  it('선언·stream 크기 초과를 INVALID_REQUEST로 거부한다', async () => {
    const declared = new Request('http://localhost/api/v1/study-sessions', {
      method: 'POST',
      headers: { 'Content-Length': '100' },
      body: '{}'
    })
    const streamed = new Request('http://localhost/api/v1/study-sessions', {
      method: 'POST',
      body: JSON.stringify({ value: 'too-large' })
    })

    await expect(
      readBoundedJsonObject(declared, { maxBytes: 10 })
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    await expect(
      readBoundedJsonObject(streamed, { maxBytes: 10 })
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
  })

  it('느린 stream을 취소하고 timeout으로 닫는다', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      pull: () => new Promise(() => undefined),
      cancel
    })
    const request = new Request('http://localhost/api/v1/study-sessions', {
      method: 'POST',
      body: stream,
      duplex: 'half'
    } as RequestInit)
    const assertion = expect(
      readBoundedJsonObject(request, { timeoutMs: 5 })
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    await vi.advanceTimersByTimeAsync(5)
    await assertion
    expect(cancel).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })
})
