import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import {
  createPhase7QuestionReport,
  getPhase7AdminQuestionReport,
  listPhase7AdminAuditLog,
  listPhase7AdminQuestions,
  reauthenticatePhase7Admin
} from '@api/phase7/phase7AdminApi'
import { isApiError } from '@api/config'
import { MOCK_ADMIN_PASSWORD } from '@mocks/handlers/authHandlers'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import {
  advanceAuthTransitionEpoch,
  AuthTransitionSupersededError
} from '@libs/authTransitionFence'
import { phase7Sha256TextPort } from '@libs/phase7Sha256'
import { mockServer } from '@/test/server'

const canonicalHeaders = (requestId = crypto.randomUUID()): HeadersInit => ({
  'Cache-Control': 'private, no-store',
  'X-Request-Id': requestId
})

const getPublishedVersionId = (): string => {
  const question = mockDatabase
    .getCanonicalAdminCmsSnapshot()
    .questions.find((candidate) => candidate.currentPublishedVersionId !== null)
  if (!question?.currentPublishedVersionId) {
    throw new Error('Published Phase 7 fixture is unavailable.')
  }
  return question.currentPublishedVersionId
}

const createReportFixture = async () => {
  mockDatabase.loginAs('USER')
  const created = await createPhase7QuestionReport({
    questionVersionId: getPublishedVersionId(),
    reason: 'OTHER',
    description: '응답 digest 검증용 신고입니다.'
  })
  mockDatabase.loginAs('ADMIN')
  return await getPhase7AdminQuestionReport(created.id)
}

describe('requestPhase7Operation transport and correlation', () => {
  it('accepts canonical success metadata and rejects cacheable success', async () => {
    mockDatabase.loginAs('ADMIN')
    const canonical = await listPhase7AdminQuestions({
      page: 1,
      pageSize: 1,
      sort: 'UPDATED_DESC'
    })
    expect(canonical.items).toHaveLength(1)

    mockServer.use(
      http.get('*/api/v1/admin/questions', () =>
        HttpResponse.json(canonical, {
          status: 200,
          headers: { 'X-Request-Id': crypto.randomUUID() }
        })
      )
    )

    await expect(
      listPhase7AdminQuestions({
        page: 1,
        pageSize: 1,
        sort: 'UPDATED_DESC'
      })
    ).rejects.toMatchObject({ isResponseValidationError: true, status: 200 })
  })

  it('rejects error status/code and Retry-After metadata mismatches', async () => {
    mockDatabase.loginAs('ADMIN')
    const requestId = crypto.randomUUID()
    mockServer.use(
      http.get('*/api/v1/admin/questions', () =>
        HttpResponse.json(
          {
            code: 'ADMIN_REQUIRED',
            message: '관리자 권한이 필요합니다.',
            requestId,
            retryable: false
          },
          {
            status: 401,
            headers: canonicalHeaders(requestId)
          }
        )
      )
    )

    const mismatch = await listPhase7AdminQuestions({
      page: 1,
      pageSize: 1,
      sort: 'UPDATED_DESC'
    }).catch((error: unknown) => error)
    expect(isApiError(mismatch)).toBe(true)
    expect(mismatch).toMatchObject({
      isResponseValidationError: true,
      status: 401
    })

    mockServer.use(
      http.get('*/api/v1/admin/questions', () =>
        HttpResponse.json(
          {
            code: 'RATE_LIMITED',
            message: '잠시 후 다시 시도해 주세요.',
            requestId,
            retryable: true
          },
          {
            status: 429,
            headers: canonicalHeaders(requestId)
          }
        )
      )
    )
    await expect(
      listPhase7AdminQuestions({
        page: 1,
        pageSize: 1,
        sort: 'UPDATED_DESC'
      })
    ).rejects.toMatchObject({ isResponseValidationError: true, status: 429 })
  })

  it('rejects schema-valid report and audit digest tampering', async () => {
    const report = await createReportFixture()
    mockServer.use(
      http.get(`*/api/v1/admin/question-reports/${report.id}`, () =>
        HttpResponse.json(
          { ...report, descriptionDigest: '0'.repeat(64) },
          { headers: canonicalHeaders() }
        )
      )
    )
    await expect(getPhase7AdminQuestionReport(report.id)).rejects.toMatchObject(
      { isResponseValidationError: true }
    )

    await reauthenticatePhase7Admin({ password: MOCK_ADMIN_PASSWORD })
    const audit = await listPhase7AdminAuditLog({ limit: 20 })
    const first = audit.items[0]
    if (!first) throw new Error('Audit fixture is unavailable.')
    mockServer.use(
      http.get('*/api/v1/admin/audit-log', () =>
        HttpResponse.json(
          {
            ...audit,
            items: [{ ...first, contentDigest: '0'.repeat(64) }]
          },
          { headers: canonicalHeaders() }
        )
      )
    )
    await expect(listPhase7AdminAuditLog({ limit: 20 })).rejects.toMatchObject({
      isResponseValidationError: true
    })
  })

  it('keeps an auth-epoch change during async correlation distinct from response validation', async () => {
    const report = await createReportFixture()
    mockServer.use(
      http.get(`*/api/v1/admin/question-reports/${report.id}`, () =>
        HttpResponse.json(report, { headers: canonicalHeaders() })
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

    const request = getPhase7AdminQuestionReport(report.id)
    await vi.waitFor(() => expect(digestStarted).toHaveBeenCalledOnce())
    advanceAuthTransitionEpoch()
    releaseDigest?.()

    await expect(request).rejects.toBeInstanceOf(AuthTransitionSupersededError)
  })
})
