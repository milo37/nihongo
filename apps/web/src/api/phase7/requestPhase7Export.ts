import axios from 'axios'
import {
  adminQuestionExportContentDisposition,
  adminQuestionExportContentType,
  assertAdminQuestionExportDocumentForRequest,
  exportAdminQuestionsErrorSchema,
  exportAdminQuestionsRequestSchema,
  type AdminQuestionExportDocumentV1,
  type ExportAdminQuestionsRequest
} from '@nihongo/contracts/admin/phase7'
import { errorStatusByCode } from '@nihongo/contracts/common/error'
import { requestIdSchema } from '@nihongo/contracts/common/id'
import {
  apiClient,
  createResponseValidationError,
  withErrorFlags
} from '@api/config'
import {
  AuthTransitionSupersededError,
  assertCurrentAuthActorTransitionFence,
  captureAuthActorTransitionFence
} from '@libs/authTransitionFence'
import { phase7Sha256TextPort } from '@libs/phase7Sha256'
import { useAppStore } from '@store/index'

const MAX_EXPORT_BYTES = 8 * 1024 * 1024
const RETRY_AFTER_SECONDS = /^[1-9][0-9]*$/u
const JSON_CONTENT_TYPE = /^application\/json(?:\s*;\s*charset=utf-8)?$/iu

export interface Phase7ExportResult {
  readonly bytes: Uint8Array
  readonly document: AdminQuestionExportDocumentV1
  readonly fileName: 'nihongo-admin-questions-v1.json'
  readonly requestId: string
}

const readHeader = (headers: unknown, name: string): string | null => {
  if (!headers || typeof headers !== 'object') return null
  if ('get' in headers && typeof headers.get === 'function') {
    const value: unknown = headers.get(name)
    return typeof value === 'string' ? value : null
  }
  const record = headers as Readonly<Record<string, unknown>>
  const value = record[name] ?? record[name.toLowerCase()]
  return typeof value === 'string' ? value : null
}

const toBytes = (value: unknown): Uint8Array => {
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (value instanceof Uint8Array) return value
  throw new Error('Export response is not an ArrayBuffer.')
}

const decodeUtf8 = (bytes: Uint8Array): string =>
  new TextDecoder('utf-8', { fatal: true }).decode(bytes)

export const requestPhase7Export = async (
  rawRequest: ExportAdminQuestionsRequest,
  options: { readonly signal?: AbortSignal } = {}
): Promise<Phase7ExportResult> => {
  const request = exportAdminQuestionsRequestSchema.parse(rawRequest)
  const actor = useAppStore.getState().currentUser
  if (actor?.role !== 'ADMIN') throw new AuthTransitionSupersededError()
  const actorFence = captureAuthActorTransitionFence(actor)
  const assertActorFence = (): void => {
    assertCurrentAuthActorTransitionFence(
      actorFence,
      useAppStore.getState().currentUser
    )
  }

  try {
    const response = await apiClient.post<ArrayBuffer>(
      '/v1/admin/questions/export',
      request,
      { responseType: 'arraybuffer', signal: options.signal }
    )
    assertActorFence()

    try {
      const bytes = toBytes(response.data)
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_EXPORT_BYTES) {
        throw new Error('Export response exceeds the bounded byte range.')
      }
      const contentType = readHeader(response.headers, 'content-type')
      const contentDisposition = readHeader(
        response.headers,
        'content-disposition'
      )
      const requestId = readHeader(response.headers, 'x-request-id')
      const parsedRequestId = requestIdSchema.safeParse(requestId)
      if (
        response.status !== 200 ||
        contentType !== adminQuestionExportContentType ||
        contentDisposition !== adminQuestionExportContentDisposition ||
        readHeader(response.headers, 'cache-control') !== 'private, no-store' ||
        !parsedRequestId.success ||
        readHeader(response.headers, 'retry-after') !== null
      ) {
        throw new Error('Export attachment headers are not canonical.')
      }
      const canonicalResponseBody = decodeUtf8(bytes)
      const rawDocument: unknown = JSON.parse(canonicalResponseBody)
      const assertion = await assertAdminQuestionExportDocumentForRequest(
        phase7Sha256TextPort,
        request,
        rawDocument,
        { canonicalResponseBody }
      )
      assertActorFence()
      return {
        bytes,
        document: assertion.document,
        fileName: 'nihongo-admin-questions-v1.json',
        requestId: parsedRequestId.data
      }
    } catch (error: unknown) {
      if (error instanceof AuthTransitionSupersededError) throw error
      throw createResponseValidationError(error, response.status)
    }
  } catch (error: unknown) {
    assertActorFence()
    if (axios.isAxiosError(error) && error.response) {
      try {
        const bytes = toBytes(error.response.data)
        const rawFailure: unknown = JSON.parse(decodeUtf8(bytes))
        const failure = exportAdminQuestionsErrorSchema.parse(rawFailure)
        const retryAfter = readHeader(error.response.headers, 'retry-after')
        const contentType = readHeader(error.response.headers, 'content-type')
        if (
          error.response.status !== errorStatusByCode[failure.code] ||
          contentType === null ||
          !JSON_CONTENT_TYPE.test(contentType) ||
          readHeader(error.response.headers, 'content-disposition') !== null ||
          readHeader(error.response.headers, 'cache-control') !==
            'private, no-store' ||
          readHeader(error.response.headers, 'x-request-id') !==
            failure.requestId ||
          (failure.code === 'RATE_LIMITED' && retryAfter === null) ||
          (retryAfter !== null &&
            failure.code !== 'RATE_LIMITED' &&
            failure.code !== 'SERVICE_UNAVAILABLE') ||
          (retryAfter !== null && !RETRY_AFTER_SECONDS.test(retryAfter))
        ) {
          throw new Error('Export failure transport metadata is not canonical.')
        }
        throw withErrorFlags(error, {
          code: failure.code,
          fieldErrors: failure.fieldErrors,
          isServerValidationError: error.response.status === 422,
          isValidationError: error.response.status === 422,
          requestId: failure.requestId,
          retryable: failure.retryable,
          serverMessage: failure.message,
          status: error.response.status
        })
      } catch (failureError: unknown) {
        if (failureError === error) throw failureError
        throw createResponseValidationError(failureError, error.response.status)
      }
    }
    throw error
  }
}
