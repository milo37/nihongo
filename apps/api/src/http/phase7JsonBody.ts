import {
  parsePhase7JsonBytes,
  Phase7JsonParseError
} from '@nihongo/contracts/admin/phase7'
import { ApplicationError } from '../errors/applicationError.js'

const requestTooLarge = (): ApplicationError =>
  new ApplicationError({
    code: 'REQUEST_TOO_LARGE',
    message: '요청 본문이 허용된 크기를 초과했습니다.',
    retryable: false,
    phase7Disposition: 'NO_TX'
  })

const invalidJson = (): ApplicationError =>
  new ApplicationError({
    code: 'INVALID_JSON',
    message: 'JSON 요청 본문이 올바르지 않습니다.',
    retryable: false,
    phase7Disposition: 'NO_TX'
  })

export const readPhase7JsonBody = async (
  request: Request,
  maximumBytes: number
): Promise<unknown> => {
  const reader = request.body?.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0

  if (reader) {
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        byteLength += chunk.value.byteLength
        if (byteLength > maximumBytes) {
          void reader.cancel().catch(() => undefined)
          throw requestTooLarge()
        }
        chunks.push(chunk.value)
      }
    } catch (error: unknown) {
      if (error instanceof ApplicationError) throw error
      throw invalidJson()
    }
  }

  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    const value = parsePhase7JsonBytes(bytes)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw invalidJson()
    }
    return value
  } catch (error: unknown) {
    if (
      error instanceof Phase7JsonParseError &&
      error.kind === 'MAX_DEPTH_EXCEEDED'
    ) {
      throw new ApplicationError({
        code: 'VALIDATION_ERROR',
        message: 'JSON 요청 본문의 중첩 깊이가 너무 큽니다.',
        retryable: false,
        phase7Disposition: 'NO_TX'
      })
    }
    throw invalidJson()
  }
}
