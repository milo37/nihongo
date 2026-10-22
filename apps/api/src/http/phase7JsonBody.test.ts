import { describe, expect, it } from 'vitest'
import { ApplicationError } from '../errors/applicationError.js'
import { readPhase7JsonBody } from './phase7JsonBody.js'

const encoder = new TextEncoder()

const requestFromChunks = (chunks: readonly Uint8Array[]): Request => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    }
  })
  return new Request('http://localhost/api/v1/admin/questions', {
    body: stream,
    duplex: 'half',
    method: 'POST'
  } as RequestInit & { duplex: 'half' })
}

const expectApplicationError = async (
  promise: Promise<unknown>,
  code: ApplicationError['code']
): Promise<ApplicationError> => {
  try {
    await promise
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ApplicationError)
    const applicationError = error as ApplicationError
    expect(applicationError.code).toBe(code)
    expect(applicationError.phase7Disposition).toBe('NO_TX')
    return applicationError
  }
  throw new Error(`Expected ${code}.`)
}

describe('Phase 7 bounded strict JSON body', () => {
  it.each([
    '{"a":1,"a":2}',
    '{"outer":{"a":1,"a":2}}',
    '{"outer":{"a":1,"\\u0061":2}}',
    '{"a":1,}',
    '{"a":1} trailing'
  ])('duplicate 또는 비정규 JSON %s를 INVALID_JSON으로 닫는다', async (raw) => {
    await expectApplicationError(
      readPhase7JsonBody(requestFromChunks([encoder.encode(raw)]), 4_096),
      'INVALID_JSON'
    )
  })

  it('split chunk의 invalid UTF-8을 fatal decode한다', async () => {
    await expectApplicationError(
      readPhase7JsonBody(
        requestFromChunks([
          Uint8Array.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xe2]),
          Uint8Array.from([0x28, 0xa1, 0x22, 0x7d])
        ]),
        4_096
      ),
      'INVALID_JSON'
    )
  })

  it('container depth 12는 허용하고 13은 VALIDATION_ERROR로 거부한다', async () => {
    const atLimit = `${'{"a":'.repeat(12)}0${'}'.repeat(12)}`
    await expect(
      readPhase7JsonBody(requestFromChunks([encoder.encode(atLimit)]), 4_096)
    ).resolves.toBeDefined()

    const overLimit = `${'{"a":'.repeat(13)}0${'}'.repeat(13)}`
    await expectApplicationError(
      readPhase7JsonBody(requestFromChunks([encoder.encode(overLimit)]), 4_096),
      'VALIDATION_ERROR'
    )
  })

  it.each(['null', 'true', '1', '"text"', '[]'])(
    'non-object root %s를 INVALID_JSON으로 닫는다',
    async (raw) => {
      await expectApplicationError(
        readPhase7JsonBody(requestFromChunks([encoder.encode(raw)]), 4_096),
        'INVALID_JSON'
      )
    }
  )

  it('actual stream cap을 1 byte 넘으면 reader를 cancel하고 413으로 닫는다', async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"a":'))
        controller.enqueue(encoder.encode('12345'))
      },
      cancel() {
        cancelled = true
      }
    })
    const request = new Request('http://localhost/api/v1/admin/questions', {
      body: stream,
      duplex: 'half',
      method: 'POST'
    } as RequestInit & { duplex: 'half' })

    await expectApplicationError(
      readPhase7JsonBody(request, 9),
      'REQUEST_TOO_LARGE'
    )
    expect(cancelled).toBe(true)
  })

  it('reader cancel completion을 기다리지 않고 즉시 413으로 닫는다', async () => {
    let resolveCancellation: (() => void) | undefined
    const cancellation = new Promise<void>((resolve) => {
      resolveCancellation = resolve
    })
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('too-large'))
      },
      cancel() {
        return cancellation
      }
    })
    const request = new Request('http://localhost/api/v1/admin/questions', {
      body: stream,
      duplex: 'half',
      method: 'POST'
    } as RequestInit & { duplex: 'half' })

    await expectApplicationError(
      readPhase7JsonBody(request, 1),
      'REQUEST_TOO_LARGE'
    )
    resolveCancellation?.()
  })
})
