import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import {
  adminQuestionExportContentDisposition,
  adminQuestionExportContentType
} from '@nihongo/contracts/admin/phase7'
import { exportPhase7AdminQuestions } from '@api/phase7/phase7AdminApi'
import { requestPhase7Export } from '@api/phase7/requestPhase7Export'
import { isApiError } from '@api/config'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import {
  advanceAuthTransitionEpoch,
  AuthTransitionSupersededError
} from '@libs/authTransitionFence'
import { phase7Sha256TextPort } from '@libs/phase7Sha256'
import { DEMO_REVIEWER_ADMIN_ID } from '@mocks/data/users'
import { mockServer } from '@/test/server'
import { useAppStore } from '@store/index'

const encoder = new TextEncoder()

const exportHeaders = (requestId = crypto.randomUUID()): HeadersInit => ({
  'Cache-Control': 'private, no-store',
  'Content-Disposition': adminQuestionExportContentDisposition,
  'Content-Type': adminQuestionExportContentType,
  'X-Request-Id': requestId
})

const getExportRequest = () => {
  const admin = mockDatabase.loginAs('ADMIN')
  useAppStore.getState().setCurrentUser(admin)
  const question = mockDatabase.getCanonicalAdminCmsSnapshot().questions[0]
  if (!question) throw new Error('Export fixture is unavailable.')
  return { questionIds: [question.questionId] }
}

describe('requestPhase7Export raw transport', () => {
  it('preserves canonical bytes and validates exact success metadata', async () => {
    const request = getExportRequest()
    const result = await exportPhase7AdminQuestions(request)

    expect(JSON.parse(new TextDecoder().decode(result.bytes))).toEqual(
      result.document
    )
    expect(result.fileName).toBe('nihongo-admin-questions-v1.json')
    expect(result.requestId).toMatch(/^[0-9a-f-]{36}$/u)
  })

  it.each([
    ['wrong status', 201, exportHeaders()],
    [
      'cacheable response',
      200,
      {
        ...exportHeaders(),
        'Cache-Control': 'public, max-age=60'
      }
    ],
    [
      'malformed request id',
      200,
      { ...exportHeaders(), 'X-Request-Id': 'not-a-request-id' }
    ]
  ])(
    'rejects %s before exposing attachment bytes',
    async (_label, status, headers) => {
      const request = getExportRequest()
      const canonical = await exportPhase7AdminQuestions(request)
      mockServer.use(
        http.post(
          '*/api/v1/admin/questions/export',
          () => new HttpResponse(canonical.bytes, { status, headers })
        )
      )

      await expect(exportPhase7AdminQuestions(request)).rejects.toMatchObject({
        isResponseValidationError: true,
        status
      })
    }
  )

  it('rejects malformed UTF-8, non-canonical JSON, and oversized bodies', async () => {
    const request = getExportRequest()
    const canonical = await exportPhase7AdminQuestions(request)
    const fixtures = [
      new Uint8Array([0xff]),
      encoder.encode(`${new TextDecoder().decode(canonical.bytes)}\n`),
      new Uint8Array(8 * 1024 * 1024 + 1)
    ]

    for (const bytes of fixtures) {
      mockServer.use(
        http.post(
          '*/api/v1/admin/questions/export',
          () => new HttpResponse(bytes, { headers: exportHeaders() })
        )
      )
      await expect(exportPhase7AdminQuestions(request)).rejects.toMatchObject({
        isResponseValidationError: true,
        status: 200
      })
    }
  })

  it('decodes canonical raw ApiFailure and rejects attachment/error mismatches', async () => {
    const request = getExportRequest()
    const requestId = crypto.randomUUID()
    const failure = {
      code: 'RATE_LIMITED',
      message: '잠시 후 다시 시도해 주세요.',
      requestId,
      retryable: true
    }
    const bytes = encoder.encode(JSON.stringify(failure))
    mockServer.use(
      http.post(
        '*/api/v1/admin/questions/export',
        () =>
          new HttpResponse(bytes, {
            status: 429,
            headers: {
              'Cache-Control': 'private, no-store',
              'Content-Type': 'application/json; charset=utf-8',
              'Retry-After': '900',
              'X-Request-Id': requestId
            }
          })
      )
    )

    const error = await exportPhase7AdminQuestions(request).catch(
      (reason: unknown) => reason
    )
    expect(isApiError(error)).toBe(true)
    expect(error).toMatchObject({
      code: 'RATE_LIMITED',
      requestId,
      retryAfterMs: 900_000,
      retryable: true,
      status: 429
    })

    mockServer.use(
      http.post(
        '*/api/v1/admin/questions/export',
        () =>
          new HttpResponse(bytes, {
            status: 429,
            headers: {
              ...exportHeaders(requestId),
              'Retry-After': '900'
            }
          })
      )
    )
    await expect(exportPhase7AdminQuestions(request)).rejects.toMatchObject({
      isResponseValidationError: true,
      status: 429
    })
  })

  it('does not wrap an auth transition during async document correlation', async () => {
    const request = getExportRequest()
    const canonical = await exportPhase7AdminQuestions(request)
    mockServer.use(
      http.post(
        '*/api/v1/admin/questions/export',
        () => new HttpResponse(canonical.bytes, { headers: exportHeaders() })
      )
    )
    const originalDigest = phase7Sha256TextPort.digestUtf8
    let releaseDigest: (() => void) | undefined
    const digestGate = new Promise<void>((resolve) => {
      releaseDigest = resolve
    })
    const digestStarted = vi.fn()
    vi.spyOn(phase7Sha256TextPort, 'digestUtf8').mockImplementation(
      async (value) => {
        digestStarted()
        await digestGate
        return originalDigest(value)
      }
    )

    const pending = exportPhase7AdminQuestions(request)
    await vi.waitFor(() => expect(digestStarted).toHaveBeenCalled())
    advanceAuthTransitionEpoch()
    releaseDigest?.()

    await expect(pending).rejects.toBeInstanceOf(AuthTransitionSupersededError)
  })

  it('rejects bytes when the ADMIN actor changes without an epoch signal', async () => {
    const request = getExportRequest()
    const canonical = await exportPhase7AdminQuestions(request)
    mockServer.use(
      http.post(
        '*/api/v1/admin/questions/export',
        () => new HttpResponse(canonical.bytes, { headers: exportHeaders() })
      )
    )
    const originalDigest = phase7Sha256TextPort.digestUtf8
    let releaseDigest: (() => void) | undefined
    const digestGate = new Promise<void>((resolve) => {
      releaseDigest = resolve
    })
    const digestStarted = vi.fn()
    vi.spyOn(phase7Sha256TextPort, 'digestUtf8').mockImplementation(
      async (value) => {
        digestStarted()
        await digestGate
        return originalDigest(value)
      }
    )

    const pending = exportPhase7AdminQuestions(request)
    await vi.waitFor(() => expect(digestStarted).toHaveBeenCalled())
    useAppStore
      .getState()
      .setCurrentUser(mockDatabase.loginAs('ADMIN', DEMO_REVIEWER_ADMIN_ID))
    releaseDigest?.()

    await expect(pending).rejects.toBeInstanceOf(AuthTransitionSupersededError)
  })

  it('forwards AbortSignal to the raw request', async () => {
    const request = getExportRequest()
    mockServer.use(
      http.post('*/api/v1/admin/questions/export', async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
        return new HttpResponse(new Uint8Array([0xff]), {
          headers: exportHeaders()
        })
      })
    )
    const controller = new AbortController()
    const pending = requestPhase7Export(request, {
      signal: controller.signal
    })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'ERR_CANCELED' })
  })
})
