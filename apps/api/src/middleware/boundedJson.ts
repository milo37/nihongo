import { ApplicationError } from '../errors/applicationError.js'

const DEFAULT_MAX_BYTES = 16 * 1_024
const DEFAULT_TIMEOUT_MS = 5_000

interface BoundedJsonOptions {
  maxBytes?: number
  timeoutMs?: number
}

const invalidJson = (): ApplicationError =>
  new ApplicationError({
    code: 'INVALID_JSON',
    message: '올바른 JSON object가 필요합니다.',
    retryable: false
  })

const invalidRequest = (message: string): ApplicationError =>
  new ApplicationError({
    code: 'INVALID_REQUEST',
    message,
    retryable: false
  })

export const readBoundedJsonObject = async (
  request: Request,
  {
    maxBytes = DEFAULT_MAX_BYTES,
    timeoutMs = DEFAULT_TIMEOUT_MS
  }: BoundedJsonOptions = {}
): Promise<Record<string, unknown>> => {
  const declaredLength = Number(request.headers.get('Content-Length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await request.body?.cancel().catch(() => undefined)
    throw invalidRequest('요청 본문이 너무 큽니다.')
  }

  const reader = request.body?.getReader()
  if (!reader) {
    throw invalidJson()
  }

  const chunks: Uint8Array[] = []
  let totalBytes = 0
  let timeout: NodeJS.Timeout | undefined

  const readBody = async (): Promise<Uint8Array> => {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) {
        break
      }
      totalBytes += chunk.value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw invalidRequest('요청 본문이 너무 큽니다.')
      }
      chunks.push(chunk.value)
    }

    const body = new Uint8Array(totalBytes)
    let offset = 0
    for (const chunk of chunks) {
      body.set(chunk, offset)
      offset += chunk.byteLength
    }
    return body
  }

  try {
    const bytes = await Promise.race([
      readBody(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          void reader.cancel().catch(() => undefined)
          reject(invalidRequest('요청 본문 수신 시간이 초과됐습니다.'))
        }, timeoutMs)
      })
    ])
    const parsed: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    )
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw invalidJson()
    }
    return parsed as Record<string, unknown>
  } catch (error: unknown) {
    if (error instanceof ApplicationError) {
      throw error
    }
    throw invalidJson()
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
    reader.releaseLock()
  }
}
