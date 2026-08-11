import { HttpResponse } from 'msw'
import { z, type ZodType } from 'zod'

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
  readonly status: number

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'MockHttpError'
    this.code = code
    this.status = status
  }
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
  schema: Schema
): z.output<Schema> => {
  const params = Object.fromEntries(new URL(request.url).searchParams.entries())
  const parsed = schema.safeParse(params)

  if (!parsed.success) {
    throw new MockHttpError(
      422,
      'VALIDATION_ERROR',
      parsed.error.issues[0]?.message ?? '검색 조건이 올바르지 않습니다.'
    )
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
