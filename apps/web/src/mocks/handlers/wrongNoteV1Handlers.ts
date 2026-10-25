import { errorStatusByCode } from '@nihongo/contracts/common/error'
import {
  getWrongNoteErrorSchema,
  getWrongNoteParamsSchema,
  getWrongNoteQuerySchema,
  getWrongNoteResponseSchema,
  type GetWrongNoteError
} from '@nihongo/contracts/wrong-note/get-wrong-note'
import {
  listWrongNotesErrorSchema,
  listWrongNotesQuerySchema,
  listWrongNotesResponseSchema,
  type ListWrongNotesError
} from '@nihongo/contracts/wrong-note/list-wrong-notes'
import { http, HttpResponse } from 'msw'
import {
  MockWrongNoteReadIntegrityError,
  toContractWrongNoteDetail,
  toContractWrongNoteList
} from '@mocks/adapters/wrongNoteReadContractAdapter'
import { MockHttpError, parseSearchParams } from '@mocks/handlers/shared'
import { MockDatabaseError, mockDatabase } from '@mocks/repository/mockDatabase'

const getHeaders = (requestId: string): Record<string, string> => ({
  'Cache-Control': 'private, no-store',
  'X-Request-Id': requestId
})

const createListErrorResponse = (
  error: ListWrongNotesError
): HttpResponse<ListWrongNotesError> => {
  const payload = listWrongNotesErrorSchema.parse(error)

  return HttpResponse.json(payload, {
    status: errorStatusByCode[payload.code],
    headers: getHeaders(payload.requestId)
  })
}

const createDetailErrorResponse = (
  error: GetWrongNoteError
): HttpResponse<GetWrongNoteError> => {
  const payload = getWrongNoteErrorSchema.parse(error)

  return HttpResponse.json(payload, {
    status: errorStatusByCode[payload.code],
    headers: getHeaders(payload.requestId)
  })
}

const requireUserId = (): string => {
  const user = mockDatabase.getCurrentUser()
  if (!user) {
    throw new MockDatabaseError(
      'AUTH_REQUIRED',
      401,
      '오답 노트를 조회하려면 로그인이 필요합니다.'
    )
  }
  return user.id
}

const normalizeListError = (
  error: unknown,
  requestId: string
): ListWrongNotesError => {
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

  console.error('Mock v1 listWrongNotes failed', error)
  return {
    code: 'INTERNAL_SERVER_ERROR',
    message: '오답 노트를 불러오지 못했습니다.',
    requestId,
    retryable: true
  }
}

const normalizeDetailError = (
  error: unknown,
  requestId: string
): GetWrongNoteError => {
  if (error instanceof MockHttpError) {
    return {
      code: 'VALIDATION_ERROR',
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
    if (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN') {
      return {
        code: 'RESOURCE_NOT_FOUND',
        message: '오답 노트를 찾을 수 없습니다.',
        requestId,
        retryable: false
      }
    }
  }

  console.error('Mock v1 getWrongNote failed', error)
  return {
    code: 'INTERNAL_SERVER_ERROR',
    message: '오답 노트를 불러오지 못했습니다.',
    requestId,
    retryable: true
  }
}

export const wrongNoteV1Handlers = [
  http.get('*/api/v1/wrong-notes', ({ request }) => {
    const requestId = crypto.randomUUID()

    try {
      const query = parseSearchParams(request, listWrongNotesQuerySchema)
      const userId = requireUserId()
      const response = listWrongNotesResponseSchema.parse(
        toContractWrongNoteList(
          mockDatabase.listCanonicalWrongNoteRecords(userId),
          query
        )
      )

      return HttpResponse.json(response, { headers: getHeaders(requestId) })
    } catch (error: unknown) {
      return createListErrorResponse(normalizeListError(error, requestId))
    }
  }),
  http.get('*/api/v1/wrong-notes/:questionId', ({ params, request }) => {
    const requestId = crypto.randomUUID()
    const parsedParams = getWrongNoteParamsSchema.safeParse({
      questionId: String(params.questionId ?? '')
    })
    if (!parsedParams.success) {
      return createDetailErrorResponse({
        code: 'INVALID_ID',
        message: '문제 ID 형식이 올바르지 않습니다.',
        requestId,
        retryable: false
      })
    }

    try {
      parseSearchParams(request, getWrongNoteQuerySchema)
      const userId = requireUserId()
      const response = getWrongNoteResponseSchema.parse(
        toContractWrongNoteDetail(
          mockDatabase.getCanonicalWrongNoteRecord(
            userId,
            parsedParams.data.questionId
          )
        )
      )

      return HttpResponse.json(response, { headers: getHeaders(requestId) })
    } catch (error: unknown) {
      if (error instanceof MockWrongNoteReadIntegrityError) {
        console.error('Mock v1 getWrongNote mapper integrity failed', error)
      }
      return createDetailErrorResponse(normalizeDetailError(error, requestId))
    }
  })
]
