import {
  createBookmarkBodySchema,
  createBookmarkErrorSchema,
  createBookmarkParamsSchema,
  createBookmarkResponseSchema,
  type CreateBookmarkError
} from '@nihongo/contracts/bookmark/create-bookmark'
import {
  deleteBookmarkErrorSchema,
  deleteBookmarkParamsSchema,
  type DeleteBookmarkError
} from '@nihongo/contracts/bookmark/delete-bookmark'
import {
  listBookmarksErrorSchema,
  listBookmarksQuerySchema,
  listBookmarksResponseSchema,
  type ListBookmarksError
} from '@nihongo/contracts/bookmark/list-bookmarks'
import { errorStatusByCode } from '@nihongo/contracts/common/error'
import { http, HttpResponse } from 'msw'
import { toContractBookmarkSummary } from '@mocks/adapters/bookmarkContractAdapter'
import { getContractQuestionId } from '@mocks/adapters/questionContractAdapter'
import {
  hasTrustedMockWriteOrigin,
  MockHttpError,
  parseSearchParams,
  readBoundedMockJsonObject
} from '@mocks/handlers/shared'
import { MockDatabaseError, mockDatabase } from '@mocks/repository/mockDatabase'

const JSON_CONTENT_TYPE_PATTERN = /^application\/json(?:\s*;|$)/iu

const responseHeaders = (requestId: string): Record<string, string> => ({
  'Cache-Control': 'private, no-store',
  'X-Request-Id': requestId
})

const createErrorResponse = <ErrorPayload extends { code: string }>(
  payload: ErrorPayload,
  schema: { parse: (value: unknown) => ErrorPayload },
  requestId: string
): HttpResponse<ErrorPayload> => {
  const parsed = schema.parse(payload)
  return HttpResponse.json(parsed, {
    status: errorStatusByCode[parsed.code as keyof typeof errorStatusByCode],
    headers: responseHeaders(requestId)
  })
}

const requireUserId = (): string => {
  const user = mockDatabase.getCurrentUser()
  if (!user) {
    throw new MockDatabaseError(
      'AUTH_REQUIRED',
      401,
      '즐겨찾기는 로그인이 필요합니다.'
    )
  }
  return user.id
}

const normalizeListError = (
  error: unknown,
  requestId: string
): ListBookmarksError => {
  if (error instanceof MockHttpError) {
    return {
      code: 'VALIDATION_ERROR',
      message: error.message,
      requestId,
      retryable: false
    }
  }
  if (error instanceof MockDatabaseError && error.code === 'AUTH_REQUIRED') {
    return {
      code: 'AUTHENTICATION_REQUIRED',
      message: error.message,
      requestId,
      retryable: false
    }
  }
  console.error('Mock v1 listBookmarks failed', error)
  return {
    code: 'INTERNAL_SERVER_ERROR',
    message: '즐겨찾기를 불러오지 못했습니다.',
    requestId,
    retryable: true
  }
}

const normalizeCreateError = (
  error: unknown,
  requestId: string
): CreateBookmarkError => {
  if (error instanceof MockHttpError) {
    const supportedCodes = new Set<CreateBookmarkError['code']>([
      'INVALID_JSON',
      'INVALID_REQUEST',
      'UNTRUSTED_ORIGIN'
    ])
    return {
      code: supportedCodes.has(error.code as CreateBookmarkError['code'])
        ? (error.code as CreateBookmarkError['code'])
        : 'INVALID_REQUEST',
      message: error.message,
      requestId,
      retryable: false
    }
  }
  if (error instanceof MockDatabaseError) {
    if (error.code === 'AUTH_REQUIRED') {
      return {
        code: 'AUTHENTICATION_REQUIRED',
        message: error.message,
        requestId,
        retryable: false
      }
    }
    if (error.code === 'NOT_FOUND') {
      return {
        code: 'RESOURCE_NOT_FOUND',
        message: '문제를 찾을 수 없습니다.',
        requestId,
        retryable: false
      }
    }
    if (error.code === 'INVALID_INPUT') {
      return {
        code: 'QUESTION_NOT_AVAILABLE',
        message: error.message,
        requestId,
        retryable: false
      }
    }
  }
  console.error('Mock v1 createBookmark failed', error)
  return {
    code: 'INTERNAL_SERVER_ERROR',
    message: '즐겨찾기를 저장하지 못했습니다.',
    requestId,
    retryable: true
  }
}

const normalizeDeleteError = (
  error: unknown,
  requestId: string
): DeleteBookmarkError => {
  if (error instanceof MockHttpError) {
    return {
      code: 'UNTRUSTED_ORIGIN',
      message: error.message,
      requestId,
      retryable: false
    }
  }
  if (error instanceof MockDatabaseError && error.code === 'AUTH_REQUIRED') {
    return {
      code: 'AUTHENTICATION_REQUIRED',
      message: error.message,
      requestId,
      retryable: false
    }
  }
  console.error('Mock v1 deleteBookmark failed', error)
  return {
    code: 'INTERNAL_SERVER_ERROR',
    message: '즐겨찾기를 삭제하지 못했습니다.',
    requestId,
    retryable: true
  }
}

export const bookmarkHandlers = [
  http.get('*/api/v1/bookmarks', ({ request }) => {
    const requestId = crypto.randomUUID()
    try {
      const query = parseSearchParams(request, listBookmarksQuerySchema)
      const userId = requireUserId()
      const requestedIds = query.questionIds ? new Set(query.questionIds) : null
      const items = mockDatabase
        .listCanonicalBookmarkSources(userId)
        .map(toContractBookmarkSummary)
        .filter(
          (bookmark) =>
            requestedIds === null || requestedIds.has(bookmark.questionId)
        )
      const offset = (query.page - 1) * query.pageSize
      const response = listBookmarksResponseSchema.parse({
        items: items.slice(offset, offset + query.pageSize),
        page: query.page,
        pageSize: query.pageSize,
        total: items.length
      })
      return HttpResponse.json(response, {
        headers: responseHeaders(requestId)
      })
    } catch (error: unknown) {
      return createErrorResponse(
        normalizeListError(error, requestId),
        listBookmarksErrorSchema,
        requestId
      )
    }
  }),
  http.put('*/api/v1/bookmarks/:questionId', async ({ params, request }) => {
    const requestId = crypto.randomUUID()
    try {
      if (
        !JSON_CONTENT_TYPE_PATTERN.test(
          request.headers.get('Content-Type') ?? ''
        )
      ) {
        throw new MockHttpError(
          400,
          'INVALID_REQUEST',
          'JSON 요청만 허용됩니다.'
        )
      }
      if (!hasTrustedMockWriteOrigin(request)) {
        throw new MockHttpError(
          403,
          'UNTRUSTED_ORIGIN',
          '허용되지 않은 요청 출처입니다.'
        )
      }
      const parsedParams = createBookmarkParamsSchema.safeParse({
        questionId: String(params.questionId ?? '')
      })
      if (!parsedParams.success) {
        return createErrorResponse(
          {
            code: 'INVALID_ID',
            message: '문제 ID 형식이 올바르지 않습니다.',
            requestId,
            retryable: false
          },
          createBookmarkErrorSchema,
          requestId
        )
      }
      const parsedBody = createBookmarkBodySchema.safeParse(
        await readBoundedMockJsonObject(request)
      )
      if (!parsedBody.success) {
        throw new MockHttpError(
          400,
          'INVALID_REQUEST',
          '즐겨찾기 생성 요청이 올바르지 않습니다.'
        )
      }
      const userId = requireUserId()
      const sourceQuestionId = mockDatabase.resolveCanonicalQuestionId(
        parsedParams.data.questionId
      )
      if (!sourceQuestionId) {
        throw new MockDatabaseError(
          'NOT_FOUND',
          404,
          '문제를 찾을 수 없습니다.'
        )
      }
      const result = mockDatabase.createCanonicalBookmark(
        userId,
        sourceQuestionId
      )
      const response = createBookmarkResponseSchema.parse(
        toContractBookmarkSummary(result.source)
      )
      return HttpResponse.json(response, {
        status: result.created ? 201 : 200,
        headers: {
          ...responseHeaders(requestId),
          Location: `/api/v1/bookmarks/${getContractQuestionId(sourceQuestionId)}`
        }
      })
    } catch (error: unknown) {
      return createErrorResponse(
        normalizeCreateError(error, requestId),
        createBookmarkErrorSchema,
        requestId
      )
    }
  }),
  http.delete('*/api/v1/bookmarks/:questionId', ({ params, request }) => {
    const requestId = crypto.randomUUID()
    try {
      if (!hasTrustedMockWriteOrigin(request)) {
        throw new MockHttpError(
          403,
          'UNTRUSTED_ORIGIN',
          '허용되지 않은 요청 출처입니다.'
        )
      }
      const parsedParams = deleteBookmarkParamsSchema.safeParse({
        questionId: String(params.questionId ?? '')
      })
      if (!parsedParams.success) {
        return createErrorResponse(
          {
            code: 'INVALID_ID',
            message: '문제 ID 형식이 올바르지 않습니다.',
            requestId,
            retryable: false
          },
          deleteBookmarkErrorSchema,
          requestId
        )
      }
      const userId = requireUserId()
      const sourceQuestionId = mockDatabase.resolveCanonicalQuestionId(
        parsedParams.data.questionId
      )
      if (sourceQuestionId) {
        mockDatabase.deleteBookmark(userId, sourceQuestionId)
      }
      return new HttpResponse(null, {
        status: 204,
        headers: responseHeaders(requestId)
      })
    } catch (error: unknown) {
      return createErrorResponse(
        normalizeDeleteError(error, requestId),
        deleteBookmarkErrorSchema,
        requestId
      )
    }
  })
]
