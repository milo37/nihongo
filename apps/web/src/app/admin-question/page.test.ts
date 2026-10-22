import { describe, expect, it } from 'vitest'
import { parseAdminQuestionSearch } from '@app/admin-question/page'

describe('admin question URL query boundary', () => {
  it('accepts the complete canonical filter set', () => {
    const parsed = parseAdminQuestionSearch(
      new URLSearchParams({
        q: '日本語',
        level: 'N3',
        subject: 'GRAMMAR',
        questionType: 'GRAMMAR_SELECT',
        difficulty: 'NORMAL',
        lifecycleStatus: 'ACTIVE',
        versionStatus: 'IN_REVIEW',
        tag: '조사',
        authorActorId: '00000000-0000-4000-8000-000000000001',
        reviewerActorId: '00000000-0000-4000-8000-000000000002',
        createdFrom: '2026-01-01T00:00:00.000Z',
        createdTo: '2026-02-01T00:00:00.000Z',
        updatedFrom: '2026-03-01T00:00:00.000Z',
        updatedTo: '2026-04-01T00:00:00.000Z'
      })
    )

    expect(parsed.error).toBeUndefined()
    expect(parsed.query).toMatchObject({
      questionType: 'GRAMMAR_SELECT',
      difficulty: 'NORMAL',
      lifecycleStatus: 'ACTIVE',
      tag: '조사'
    })
  })

  it('fails closed to a bounded query for hostile URL values', () => {
    const parsed = parseAdminQuestionSearch(
      new URLSearchParams({
        page: String(Number.MAX_SAFE_INTEGER + 1),
        q: '가'.repeat(101)
      })
    )

    expect(parsed.error).toBeDefined()
    expect(parsed.query).toEqual({
      page: 1,
      pageSize: 20,
      sort: 'UPDATED_DESC'
    })
  })
})
