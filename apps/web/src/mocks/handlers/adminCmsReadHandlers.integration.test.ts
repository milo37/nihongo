import {
  diffQuestionVersionResponseSchema,
  getAdminQuestionResponseSchema,
  listAdminAuditLogResponseSchema,
  listAdminQuestionsResponseSchema,
  listAdminQuestionVersionsResponseSchema,
  listAdminTagsResponseSchema,
  listQuestionVersionReviewsResponseSchema,
  previewQuestionVersionResponseSchema
} from '@nihongo/contracts/admin/phase7'
import { apiFailureSchema } from '@nihongo/contracts/common/error'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetAdminCmsReadRateLimitForTesting } from '@mocks/handlers/adminCmsReadHandlers'
import { mockDatabase } from '@mocks/repository/mockDatabase'

const BASE = 'http://localhost/api/v1/admin'

const getSeedIds = async (): Promise<{
  questionId: string
  versionId: string
}> => {
  const response = await fetch(`${BASE}/questions?pageSize=100`)
  const payload = listAdminQuestionsResponseSchema.parse(await response.json())
  const first = payload.items[0]
  if (!first) {
    throw new Error('canonical admin seed fixture가 필요합니다.')
  }
  return {
    questionId: first.questionId,
    versionId: first.selectedVersionId
  }
}

beforeEach(() => {
  resetAdminCmsReadRateLimitForTesting()
})

describe('Phase 7 canonical admin read MSW parity', () => {
  it('65개 retained PUBLISHED v1과 8개 active read projection을 제공한다', async () => {
    mockDatabase.loginAs('ADMIN')
    const listResponse = await fetch(`${BASE}/questions?pageSize=100`)
    expect(listResponse.status).toBe(200)
    expect(listResponse.headers.get('cache-control')).toBe('private, no-store')
    expect(listResponse.headers.get('x-request-id')).toBeTruthy()
    const list = listAdminQuestionsResponseSchema.parse(
      await listResponse.json()
    )
    expect(list.total).toBe(65)
    expect(list.items).toHaveLength(65)
    expect(list.items.every((item) => item.versionStatus === 'PUBLISHED')).toBe(
      true
    )

    const { questionId, versionId } = await getSeedIds()
    const responses = await Promise.all([
      fetch(`${BASE}/questions/${questionId}`),
      fetch(`${BASE}/questions/${questionId}/versions`),
      fetch(`${BASE}/tags?q=jlpt&limit=50`),
      fetch(`${BASE}/question-versions/${versionId}/preview`),
      fetch(
        `${BASE}/question-versions/${versionId}/diff?baseVersionId=${versionId}`
      ),
      fetch(`${BASE}/question-versions/${versionId}/reviews`),
      fetch(`${BASE}/audit-log`)
    ])
    expect(responses.every((response) => response.status === 200)).toBe(true)
    const [detail, versions, tags, preview, diff, reviews, audit] =
      await Promise.all(responses.map((response) => response.json()))
    getAdminQuestionResponseSchema.parse(detail)
    listAdminQuestionVersionsResponseSchema.parse(versions)
    listAdminTagsResponseSchema.parse(tags)
    const previewPayload = previewQuestionVersionResponseSchema.parse(preview)
    expect('correctOptionId' in previewPayload.question).toBe(false)
    expect(previewPayload.adminAnswer.correctOptionId).toBeTruthy()
    expect(diffQuestionVersionResponseSchema.parse(diff).changes).toEqual([])
    expect(
      listQuestionVersionReviewsResponseSchema.parse(reviews).items
    ).toEqual([])
    expect(listAdminAuditLogResponseSchema.parse(audit).items).toEqual([])
  })

  it('auth를 query parsing보다 먼저 적용하고 malformed canonical path는 closed 404다', async () => {
    const guest = await fetch(`${BASE}/questions?unknown=1`)
    expect(guest.status).toBe(401)
    expect(apiFailureSchema.parse(await guest.json()).code).toBe(
      'AUTHENTICATION_REQUIRED'
    )

    mockDatabase.loginAs('USER')
    const user = await fetch(`${BASE}/questions?unknown=1`)
    expect(user.status).toBe(403)
    expect(apiFailureSchema.parse(await user.json()).code).toBe(
      'ADMIN_REQUIRED'
    )

    mockDatabase.loginAs('ADMIN')
    const invalidQuery = await fetch(`${BASE}/questions?unknown=1`)
    expect(invalidQuery.status).toBe(422)
    const invalidPath = await fetch(
      `${BASE}/questions/00000000-0000-0000-0000-000000000000`
    )
    expect(invalidPath.status).toBe(404)
  })

  it('ADMIN_READ actor/IP 120회 제한과 legacy singular endpoint 차단을 보존한다', async () => {
    mockDatabase.loginAs('ADMIN')
    for (let index = 0; index < 120; index += 1) {
      expect((await fetch(`${BASE}/audit-log`)).status).toBe(200)
    }
    const limited = await fetch(`${BASE}/audit-log`)
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBeTruthy()

    resetAdminCmsReadRateLimitForTesting()
    expect(
      (await fetch('http://localhost/api/admin/question?pageSize=100')).status
    ).toBe(404)
  }, 15_000)
})
