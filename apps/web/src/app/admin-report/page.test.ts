import { describe, expect, it } from 'vitest'
import { parseAdminQuestionReportSearch } from '@app/admin-report/page'

describe('admin question report URL query boundary', () => {
  it('accepts canonical report filters', () => {
    const parsed = parseAdminQuestionReportSearch(
      new URLSearchParams({
        assigneeActorId: '00000000-0000-4000-8000-000000000002',
        createdFrom: '2026-01-01T00:00:00.000Z',
        createdTo: '2026-02-01T00:00:00.000Z',
        page: '3',
        questionId: '00000000-0000-4000-8000-000000000001',
        reason: 'AMBIGUOUS',
        sort: 'CREATED_DESC',
        status: 'TRIAGED',
        updatedFrom: '2026-03-01T00:00:00.000Z',
        updatedTo: '2026-04-01T00:00:00.000Z'
      })
    )

    expect(parsed.error).toBeUndefined()
    expect(parsed.query).toEqual({
      assigneeActorId: '00000000-0000-4000-8000-000000000002',
      createdFrom: '2026-01-01T00:00:00.000Z',
      createdTo: '2026-02-01T00:00:00.000Z',
      page: 3,
      pageSize: 20,
      questionId: '00000000-0000-4000-8000-000000000001',
      reason: 'AMBIGUOUS',
      sort: 'CREATED_DESC',
      status: 'TRIAGED',
      updatedFrom: '2026-03-01T00:00:00.000Z',
      updatedTo: '2026-04-01T00:00:00.000Z'
    })
  })

  it('fails closed without throwing for an unsafe page', () => {
    expect(() =>
      parseAdminQuestionReportSearch(
        new URLSearchParams({ page: String(Number.MAX_SAFE_INTEGER + 1) })
      )
    ).not.toThrow()

    expect(
      parseAdminQuestionReportSearch(
        new URLSearchParams({ page: String(Number.MAX_SAFE_INTEGER + 1) })
      )
    ).toEqual({
      error:
        'URL 신고 검색 조건이 허용 범위를 벗어났습니다. 안전한 기본 조건을 사용합니다.',
      query: { page: 1, pageSize: 20, sort: 'UPDATED_DESC' }
    })
  })
})
