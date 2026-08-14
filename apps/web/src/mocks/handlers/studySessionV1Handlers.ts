import { errorStatusByCode } from '@nihongo/contracts/common/error'
import {
  createStudySessionBodySchema,
  createStudySessionErrorSchema,
  createStudySessionResponseSchema,
  type CreateStudySessionError
} from '@nihongo/contracts/study/create-study-session'
import {
  getStudySessionErrorSchema,
  getStudySessionParamsSchema,
  getStudySessionResponseSchema,
  type GetStudySessionError
} from '@nihongo/contracts/study/get-study-session'
import { http, HttpResponse } from 'msw'
import { toContractStudySessionPayload } from '@mocks/adapters/studySessionContractAdapter'
import {
  createMockGuestPrincipalCookie,
  inspectMockGuestProof
} from '@mocks/guestPrincipal'
import { MockHttpError, parseJsonBody } from '@mocks/handlers/shared'
import { MockDatabaseError, mockDatabase } from '@mocks/repository/mockDatabase'

const JSON_CONTENT_TYPE_PATTERN = /^application\/json(?:\s*;|$)/iu

const getHeaders = (
  requestId: string,
  code?: string
): Record<string, string> => ({
  'Cache-Control': 'private, no-store',
  'X-Request-Id': requestId,
  ...(code === 'RATE_LIMITED'
    ? { 'Retry-After': '30' }
    : code === 'SERVICE_UNAVAILABLE'
      ? { 'Retry-After': '5' }
      : {})
})

const createCreateErrorResponse = (
  error: CreateStudySessionError
): HttpResponse<CreateStudySessionError> => {
  const payload = createStudySessionErrorSchema.parse(error)

  return HttpResponse.json(payload, {
    status: errorStatusByCode[payload.code],
    headers: getHeaders(payload.requestId, payload.code)
  })
}

const createGetErrorResponse = (
  error: GetStudySessionError
): HttpResponse<GetStudySessionError> => {
  const payload = getStudySessionErrorSchema.parse(error)

  return HttpResponse.json(payload, {
    status: errorStatusByCode[payload.code],
    headers: getHeaders(payload.requestId, payload.code)
  })
}

const normalizeCreateError = (
  error: unknown,
  requestId: string
): CreateStudySessionError => {
  if (error instanceof MockHttpError) {
    if (error.code === 'INVALID_JSON') {
      return {
        code: 'INVALID_JSON',
        message: error.message,
        requestId,
        retryable: false
      }
    }
    if (error.code === 'VALIDATION_ERROR') {
      return {
        code: 'VALIDATION_ERROR',
        message: error.message,
        requestId,
        retryable: false
      }
    }
  }

  if (error instanceof MockDatabaseError) {
    if (error.code === 'NOT_FOUND') {
      return {
        code: 'NO_ELIGIBLE_QUESTIONS',
        message: '선택한 조건에 출제 가능한 문제가 없습니다.',
        requestId,
        retryable: false
      }
    }
    if (error.code === 'AUTH_REQUIRED') {
      return {
        code: 'AUTHENTICATION_REQUIRED',
        message: '로그인이 필요합니다.',
        requestId,
        retryable: false
      }
    }
  }

  console.error('Mock v1 createStudySession failed', error)
  return {
    code: 'INTERNAL_SERVER_ERROR',
    message: '학습 세션을 만들지 못했습니다.',
    requestId,
    retryable: true
  }
}

const normalizeGetError = (
  error: unknown,
  requestId: string
): GetStudySessionError => {
  if (error instanceof MockDatabaseError) {
    if (error.code === 'AUTH_REQUIRED') {
      return {
        code: 'AUTHENTICATION_REQUIRED',
        message: '학습 세션을 조회하려면 인증 정보가 필요합니다.',
        requestId,
        retryable: false
      }
    }
    if (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN') {
      return {
        code: 'RESOURCE_NOT_FOUND',
        message: '학습 세션을 찾을 수 없습니다.',
        requestId,
        retryable: false
      }
    }
  }

  console.error('Mock v1 getStudySession failed', error)
  return {
    code: 'INTERNAL_SERVER_ERROR',
    message: '학습 세션을 불러오지 못했습니다.',
    requestId,
    retryable: true
  }
}

export const studySessionV1Handlers = [
  http.post('*/api/v1/study-sessions', async ({ request }) => {
    const requestId = crypto.randomUUID()

    if (
      !JSON_CONTENT_TYPE_PATTERN.test(request.headers.get('Content-Type') ?? '')
    ) {
      return createCreateErrorResponse({
        code: 'INVALID_REQUEST',
        message: 'JSON 요청만 허용됩니다.',
        requestId,
        retryable: false
      })
    }

    try {
      const input = await parseJsonBody(request, createStudySessionBodySchema)

      if (input.mode !== 'RANDOM') {
        return createCreateErrorResponse({
          code: 'VALIDATION_ERROR',
          message: '현재 RANDOM 출제 모드만 사용할 수 있습니다.',
          fieldErrors: { mode: ['현재 RANDOM 모드만 지원합니다.'] },
          requestId,
          retryable: false
        })
      }
      if (input.explicitQuestionIds) {
        return createCreateErrorResponse({
          code: 'VALIDATION_ERROR',
          message: '명시 문제 출제는 아직 사용할 수 없습니다.',
          fieldErrors: {
            explicitQuestionIds: ['명시 문제 출제는 아직 지원하지 않습니다.']
          },
          requestId,
          retryable: false
        })
      }

      const isGuest = mockDatabase.getCurrentUser() === null
      const inspectedGuestProof = inspectMockGuestProof(request)
      const canReuseGuestProof =
        isGuest &&
        inspectedGuestProof.kind === 'VERIFIED' &&
        mockDatabase.isCanonicalGuestPrincipalActive(inspectedGuestProof.id)
      const canonicalGuestPrincipalId = isGuest
        ? canReuseGuestProof && inspectedGuestProof.kind === 'VERIFIED'
          ? inspectedGuestProof.id
          : crypto.randomUUID()
        : undefined
      const shouldIssueGuestCookie = isGuest && !canReuseGuestProof
      const created = mockDatabase.createStudySession({
        ...(canonicalGuestPrincipalId ? { canonicalGuestPrincipalId } : {}),
        level: input.level,
        subject: input.subject,
        mode: 'RANDOM',
        count: input.count
      })
      const response = createStudySessionResponseSchema.parse(
        toContractStudySessionPayload(
          mockDatabase.getCanonicalStudySessionSnapshotRecord(
            created.session.id,
            canonicalGuestPrincipalId ?? null
          )
        )
      )

      return HttpResponse.json(response, {
        status: 201,
        headers: {
          ...getHeaders(requestId),
          ...(canonicalGuestPrincipalId && shouldIssueGuestCookie
            ? {
                'Set-Cookie': createMockGuestPrincipalCookie(
                  canonicalGuestPrincipalId
                )
              }
            : {})
        }
      })
    } catch (error: unknown) {
      return createCreateErrorResponse(normalizeCreateError(error, requestId))
    }
  }),
  http.get('*/api/v1/study-sessions/:sessionId', ({ params, request }) => {
    const requestId = crypto.randomUUID()
    const parsedParams = getStudySessionParamsSchema.safeParse({
      sessionId: String(params.sessionId ?? '')
    })

    if (!parsedParams.success) {
      return createGetErrorResponse({
        code: 'INVALID_ID',
        message: '학습 세션 ID 형식이 올바르지 않습니다.',
        requestId,
        retryable: false
      })
    }

    try {
      const inspectedGuestProof = inspectMockGuestProof(request)
      if (
        mockDatabase.getCurrentUser() === null &&
        inspectedGuestProof.kind === 'ABSENT'
      ) {
        return createGetErrorResponse({
          code: 'AUTHENTICATION_REQUIRED',
          message: '학습 세션을 조회하려면 인증 정보가 필요합니다.',
          requestId,
          retryable: false
        })
      }
      if (
        mockDatabase.getCurrentUser() === null &&
        (inspectedGuestProof.kind === 'INVALID' ||
          (inspectedGuestProof.kind === 'VERIFIED' &&
            !mockDatabase.isCanonicalGuestPrincipalActive(
              inspectedGuestProof.id
            )))
      ) {
        return createGetErrorResponse({
          code: 'GUEST_SESSION_EXPIRED',
          message: '게스트 세션이 만료됐습니다.',
          requestId,
          retryable: false
        })
      }
      const source = mockDatabase.getCanonicalStudySessionSnapshotRecord(
        parsedParams.data.sessionId,
        inspectedGuestProof.kind === 'VERIFIED' ? inspectedGuestProof.id : null
      )
      if (source.session.mode !== 'RANDOM') {
        return createGetErrorResponse({
          code: 'RESOURCE_NOT_FOUND',
          message: '학습 세션을 찾을 수 없습니다.',
          requestId,
          retryable: false
        })
      }
      const response = getStudySessionResponseSchema.parse(
        toContractStudySessionPayload(source)
      )

      return HttpResponse.json(response, {
        headers: getHeaders(requestId)
      })
    } catch (error: unknown) {
      return createGetErrorResponse(normalizeGetError(error, requestId))
    }
  })
]
