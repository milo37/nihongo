import { HttpResponse } from 'msw'
import { z, type ZodType } from 'zod'

const DEFAULT_MAX_JSON_BODY_BYTES = 16 * 1_024

interface MockErrorPayload {
  code: string
  message: string
}

interface MockErrorLike {
  code?: unknown
  message?: unknown
  status?: unknown
}

export class MockHttpError extends Error {
  readonly code: string
  readonly fieldErrors?: Record<string, string[]>
  readonly status: number

  constructor(
    status: number,
    code: string,
    message: string,
    fieldErrors?: Record<string, string[]>
  ) {
    super(message)
    this.name = 'MockHttpError'
    this.code = code
    this.fieldErrors = fieldErrors
    this.status = status
  }
}

export const hasTrustedMockWriteOrigin = (request: Request): boolean => {
  const origin = request.headers.get('Origin')
  const fetchSite = request.headers.get('Sec-Fetch-Site')
  const requestOrigin = new URL(request.url).origin
  const allowedOrigins = new Set([
    requestOrigin,
    ...(typeof globalThis.location?.origin === 'string'
      ? [globalThis.location.origin]
      : [])
  ])
  let hasSameOriginReferrer = false
  if (origin === null && fetchSite === null && request.referrer) {
    try {
      hasSameOriginReferrer = new URL(request.referrer).origin === requestOrigin
    } catch {
      hasSameOriginReferrer = false
    }
  }

  return (
    (origin !== null && allowedOrigins.has(origin)) ||
    (origin === null && fetchSite === 'same-origin') ||
    hasSameOriginReferrer
  )
}

export const readBoundedMockJsonObject = async (
  request: Request,
  maxBytes = DEFAULT_MAX_JSON_BODY_BYTES
): Promise<Record<string, unknown>> => {
  const declaredLength = Number(request.headers.get('Content-Length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new MockHttpError(400, 'INVALID_REQUEST', '요청 본문이 너무 큽니다.')
  }

  let textBody: string
  try {
    textBody = await request.text()
  } catch {
    throw new MockHttpError(
      400,
      'INVALID_JSON',
      '올바른 JSON object가 필요합니다.'
    )
  }
  if (new TextEncoder().encode(textBody).byteLength > maxBytes) {
    throw new MockHttpError(400, 'INVALID_REQUEST', '요청 본문이 너무 큽니다.')
  }

  try {
    const parsed: unknown = JSON.parse(textBody)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('JSON body is not an object.')
    }
    return parsed as Record<string, unknown>
  } catch {
    throw new MockHttpError(
      400,
      'INVALID_JSON',
      '올바른 JSON object가 필요합니다.'
    )
  }
}

export const parseBoundedJsonBody = async <Schema extends ZodType>(
  request: Request,
  schema: Schema
): Promise<z.output<Schema>> => {
  const parsed = schema.safeParse(await readBoundedMockJsonObject(request))
  if (!parsed.success) {
    throw new MockHttpError(
      422,
      'VALIDATION_ERROR',
      parsed.error.issues[0]?.message ?? '요청 형식이 올바르지 않습니다.'
    )
  }
  return parsed.data
}

const isMockErrorLike = (error: unknown): error is MockErrorLike =>
  typeof error === 'object' && error !== null

export const parseJsonBody = async <Schema extends ZodType>(
  request: Request,
  schema: Schema
): Promise<z.output<Schema>> => {
  let body: unknown

  try {
    body = await request.json()
  } catch {
    throw new MockHttpError(
      400,
      'INVALID_JSON',
      '요청 본문이 올바르지 않습니다.'
    )
  }

  const parsed = schema.safeParse(body)

  if (!parsed.success) {
    throw new MockHttpError(
      422,
      'VALIDATION_ERROR',
      parsed.error.issues[0]?.message ?? '요청 형식이 올바르지 않습니다.'
    )
  }

  return parsed.data
}

export const parseSearchParams = <Schema extends ZodType>(
  request: Request,
  schema: Schema,
  message = '검색 조건이 올바르지 않습니다.'
): z.output<Schema> => {
  const searchParams = new URL(request.url).searchParams
  const params: Record<string, string | string[]> = Object.create(
    null
  ) as Record<string, string | string[]>
  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key)
    const parsedKey = key === '__proto__' ? '__forbidden_proto__' : key
    params[parsedKey] =
      key === 'questionIds'
        ? values
        : values.length === 1
          ? (values[0] ?? '')
          : values
  }
  const parsed = schema.safeParse(params)

  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {}
    parsed.error.issues.forEach((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'request'
      fieldErrors[path] = [...(fieldErrors[path] ?? []), issue.message]
    })
    throw new MockHttpError(422, 'VALIDATION_ERROR', message, fieldErrors)
  }

  return parsed.data
}

export const toErrorResponse = (
  error: unknown
): HttpResponse<MockErrorPayload> => {
  if (error instanceof MockHttpError) {
    return HttpResponse.json<MockErrorPayload>(
      { code: error.code, message: error.message },
      { status: error.status }
    )
  }

  if (isMockErrorLike(error)) {
    const status =
      typeof error.status === 'number' && error.status >= 400
        ? error.status
        : 500
    const code =
      typeof error.code === 'string' ? error.code : 'INTERNAL_SERVER_ERROR'
    const message =
      typeof error.message === 'string'
        ? error.message
        : '요청을 처리하지 못했습니다.'

    return HttpResponse.json<MockErrorPayload>({ code, message }, { status })
  }

  return HttpResponse.json<MockErrorPayload>(
    {
      code: 'INTERNAL_SERVER_ERROR',
      message: '요청을 처리하지 못했습니다.'
    },
    { status: 500 }
  )
}
