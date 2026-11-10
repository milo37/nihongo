import { http, HttpResponse } from 'msw'
import { importGuestResultResponseSchema } from '@nihongo/contracts/study/import-guest-result'
import type { ImportGuestResultResponse } from '@nihongo/contracts/study/import-guest-result'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { MockHttpError, toErrorResponse } from '@mocks/handlers/shared'

const NOTHING_MOVED: ImportGuestResultResponse = {
  importedSessionId: null,
  wrongAnswerCount: 0
}

// The mock does not move guest sessions between owners; the real server
// does (covered by the real e2e). Tests set the next answer here.
let nextResult: ImportGuestResultResponse | MockHttpError = NOTHING_MOVED

export const mockGuestResultImport = {
  setNext: (result: ImportGuestResultResponse | MockHttpError): void => {
    nextResult = result
  },
  reset: (): void => {
    nextResult = NOTHING_MOVED
  }
}

export const guestResultImportHandlers = [
  http.post('*/api/v1/me/guest-result-import', () => {
    try {
      if (!mockDatabase.getCurrentUser()) {
        throw new MockHttpError(
          401,
          'AUTHENTICATION_REQUIRED',
          '로그인이 필요한 기능입니다.'
        )
      }
      const result = nextResult
      // Like the server: the guest cookie is gone after the first answer.
      nextResult = NOTHING_MOVED
      if (result instanceof MockHttpError) throw result
      return HttpResponse.json(importGuestResultResponseSchema.parse(result), {
        headers: { 'Cache-Control': 'private, no-store' }
      })
    } catch (error: unknown) {
      return toErrorResponse(error)
    }
  })
]
