import {
  JsonParseError,
  parseJsonBytes,
  parsePhase7JsonBytes,
  Phase7JsonParseError
} from '@nihongo/contracts/admin/content-operations'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readStrictJsonBody } from './strictJsonBody.js'

const requestWithStream = (stream: ReadableStream<Uint8Array>): Request =>
  new Request('http://localhost/body-test', {
    method: 'POST',
    body: stream,
    ...{ duplex: 'half' }
  })

const requestWithChunks = (chunks: readonly Uint8Array[]): Request =>
  requestWithStream(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      }
    })
  )

const failure = (code: string) => ({
  code,
  retryable: false,
  phase7Disposition: 'NO_TX'
})

afterEach(() => vi.useRealTimers())

describe('JSON parser export compatibility', () => {
  it('preserves function and constructor identity and error metadata', () => {
    expect(parseJsonBytes).toBe(parsePhase7JsonBytes)
    expect(parseJsonBytes.name).toBe('parsePhase7JsonBytes')
    expect(JsonParseError).toBe(Phase7JsonParseError)

    const error = new JsonParseError('MAX_DEPTH_EXCEEDED')
    expect(error).toBeInstanceOf(JsonParseError)
    expect(error).toBeInstanceOf(Phase7JsonParseError)
    expect(error.name).toBe('Phase7JsonParseError')
    expect(error.constructor.name).toBe('Phase7JsonParseError')
    expect(error.kind).toBe('MAX_DEPTH_EXCEEDED')
    expect(error.message).toBe(
      'Phase 7 JSON exceeds the maximum container depth.'
    )

    const duplicate = new TextEncoder().encode('{"key":1,"key":2}')
    expect(() => parseJsonBytes(duplicate)).toThrow(Phase7JsonParseError)
    expect(() => parsePhase7JsonBytes(duplicate)).toThrow(JsonParseError)
  })
})

describe('readStrictJsonBody', () => {
  it('accepts a complete object at the byte cap across UTF-8 chunks', async () => {
    vi.useFakeTimers()
    const bytes = new TextEncoder().encode('{"text":"한국어"}')
    const request = requestWithChunks([
      bytes.slice(0, 10),
      bytes.slice(10, 12),
      bytes.slice(12)
    ])
    await expect(readStrictJsonBody(request, bytes.length)).resolves.toEqual({
      text: '한국어'
    })
    expect(request.body?.locked).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['', '[]', 'null', '1', '{"key":1,"key":2}', '{"key":'])(
    'preserves strict object and duplicate-member rejection: %s',
    async (body) => {
      const request = new Request('http://localhost/body-test', {
        method: 'POST',
        body
      })
      await expect(readStrictJsonBody(request, 1024)).rejects.toMatchObject(
        failure('INVALID_JSON')
      )
      expect(request.body?.locked).toBe(false)
    }
  )

  it('rejects malformed UTF-8 and releases the reader', async () => {
    const request = requestWithChunks([Uint8Array.of(0xff)])
    await expect(readStrictJsonBody(request, 1024)).rejects.toMatchObject(
      failure('INVALID_JSON')
    )
    expect(request.body?.locked).toBe(false)
  })

  it('preserves the maximum JSON depth failure', async () => {
    const request = new Request('http://localhost/body-test', {
      method: 'POST',
      body: '{"value":'.repeat(13) + '0' + '}'.repeat(13)
    })
    await expect(readStrictJsonBody(request, 1024)).rejects.toMatchObject(
      failure('VALIDATION_ERROR')
    )
    expect(request.body?.locked).toBe(false)
  })

  it('rejects an oversized stream without awaiting stalled cancellation', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn(() => new Promise<void>(() => undefined))
    const request = requestWithStream(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"large":true}'))
        },
        cancel
      })
    )
    await expect(readStrictJsonBody(request, 2)).rejects.toMatchObject(
      failure('REQUEST_TOO_LARGE')
    )
    expect(cancel).toHaveBeenCalledOnce()
    expect(request.body?.locked).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([false, true])(
    'ends a stalled body at five seconds even if cancellation stalls: %s',
    async (stallCancellation) => {
      vi.useFakeTimers()
      const cancel = vi.fn(() =>
        stallCancellation ? new Promise<void>(() => undefined) : undefined
      )
      const request = requestWithStream(new ReadableStream({ cancel }))
      const observed = readStrictJsonBody(request, 1024).then(
        () => ({ kind: 'SUCCESS' }) as const,
        (error: unknown) => ({ kind: 'ERROR', error }) as const
      )
      let settled = false
      void observed.then(() => {
        settled = true
      })
      await vi.advanceTimersByTimeAsync(4999)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(settled).toBe(true)
      expect(await observed).toMatchObject({
        kind: 'ERROR',
        error: failure('INVALID_JSON')
      })
      expect(cancel).toHaveBeenCalledOnce()
      expect(request.body?.locked).toBe(false)
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('does not extend the deadline when partial chunks arrive', async () => {
    vi.useFakeTimers()
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const cancel = vi.fn()
    const request = requestWithStream(
      new ReadableStream({
        start(value) {
          controller = value
        },
        cancel
      })
    )
    const observed = readStrictJsonBody(request, 1024).catch(
      (error: unknown) => error
    )
    await vi.advanceTimersByTimeAsync(4000)
    controller.enqueue(new TextEncoder().encode('{"pending":'))
    await vi.advanceTimersByTimeAsync(1000)
    expect(await observed).toMatchObject(failure('INVALID_JSON'))
    expect(cancel).toHaveBeenCalledOnce()
    expect(request.body?.locked).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('converts stream failures to the existing NO_TX error and clears the timer', async () => {
    vi.useFakeTimers()
    const request = requestWithStream(
      new ReadableStream({
        start(controller) {
          controller.error(new Error('untrusted stream detail'))
        }
      })
    )
    await expect(readStrictJsonBody(request, 1024)).rejects.toMatchObject(
      failure('INVALID_JSON')
    )
    expect(request.body?.locked).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
})
