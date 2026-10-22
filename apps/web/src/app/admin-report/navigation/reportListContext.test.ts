import { describe, expect, it } from 'vitest'
import {
  parseReportListSearch,
  reportDetailHref,
  reportListHref,
  reportReturnHref
} from '@app/admin-report/navigation/reportListContext'
const id = '018f6b7a-1f4b-7d5e-8a91-4c27df9c7101'
describe('report list navigation contract', () => {
  it('normalizes transport filters with fixed page20 and excludes UI parameters', () => {
    expect(
      parseReportListSearch(
        new URLSearchParams(
          `page=3&status=TRIAGED&focusReport=${id}&returnTo=evil&pageSize=100&q=ignored`
        )
      )
    ).toEqual({
      valid: true,
      query: { page: 3, pageSize: 20, status: 'TRIAGED', sort: 'UPDATED_DESC' }
    })
  })
  it.each([
    'page=0',
    'page=',
    'page=9007199254740992',
    'status=UNKNOWN',
    'reason=UNKNOWN',
    'sort=UNKNOWN',
    'page=1&page=2',
    'createdFrom=not-date',
    'createdFrom=2026-10-03T00%3A00%3A00.000Z&createdTo=2026-10-02T00%3A00%3A00.000Z'
  ])(
    'rejects malformed URL criteria %s instead of silently applying them',
    (search) => {
      expect(parseReportListSearch(new URLSearchParams(search)).valid).toBe(
        false
      )
    }
  )
  it('round-trips detail, explicit return, row focus, filter/page state and reload', () => {
    const query = parseReportListSearch(
      new URLSearchParams(
        `page=3&status=TRIAGED&reason=OTHER&questionId=${id}&sort=CREATED_DESC`
      )
    ).query
    const detail = new URL(reportDetailHref(id, query), 'https://example.test')
    const returned = reportReturnHref(detail.searchParams)
    const reloaded = new URL(returned, 'https://example.test')
    expect(detail.pathname).toBe(`/admin/reports/${id}`)
    expect(reloaded.pathname).toBe('/admin/reports')
    expect(parseReportListSearch(reloaded.searchParams).query).toEqual(query)
    expect(reloaded.searchParams.get('focusReport')).toBe(id)
    expect(reportListHref({ ...query, page: 1 })).toContain('status=TRIAGED')
  })
  it.each([
    'https://evil.test/admin/reports?page=1',
    '//evil.test/admin/reports?page=1',
    '/admin/questions?page=1',
    '/admin/reports/other?page=1',
    '/admin/reports?page=0',
    '/admin/reports?page=1#external',
    'javascript:alert(1)'
  ])('rejects unsafe or non-list return destinations %s', (returnTo) => {
    expect(reportReturnHref(new URLSearchParams({ returnTo }))).toBe(
      '/admin/reports'
    )
  })
})
