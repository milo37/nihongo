import { describe, expect, it } from 'vitest'
import {
  parseReportListSearch,
  reportDetailHref,
  reportListHref,
  safeReportListHref
} from '@app/admin-report/navigation/reportListContext'
const id = '10000000-0000-4000-8000-000000000001'
it('round trips every existing structured field with fixed pageSize20', () => {
  const input = new URLSearchParams({
    status: 'TRIAGED',
    reason: 'OTHER',
    questionId: id,
    assigneeActorId: id,
    createdFrom: '2026-10-01T00:00:00Z',
    createdTo: '2026-10-02T00:00:00Z',
    updatedFrom: '2026-10-01T00:00:00Z',
    updatedTo: '2026-10-02T00:00:00Z',
    page: '3',
    sort: 'CREATED_DESC',
    pageSize: '20'
  })
  const result = parseReportListSearch(input)
  expect(result.valid).toBe(true)
  expect(
    parseReportListSearch(
      new URLSearchParams(reportListHref(result.query).split('?')[1])
    )
  ).toEqual(result)
})
describe('strict filters', () => {
  it.each([
    'page=0',
    'page=',
    'page=2&page=3',
    'status=OPEN&status=OPEN',
    'status=OTHER',
    'q=secret',
    'pageSize=30',
    'returnTo=%2Fadmin%2Freports',
    'createdFrom=2026-10-02T00:00:00Z&createdTo=2026-10-01T00:00:00Z',
    'questionId=bad'
  ])('rejects %s without forwarding unsafe input', (search) => {
    expect(parseReportListSearch(new URLSearchParams(search))).toEqual({
      valid: false,
      query: { page: 1, pageSize: 20, sort: 'UPDATED_DESC' }
    })
  })
})
it.each([
  'https://evil.test/admin/reports',
  '//evil.test/admin/reports',
  '/admin/questions',
  '/admin/x/../reports',
  '/admin/%72eports',
  '/admin/reports#x',
  '/admin/reports?sort=UPDATED_DESC\n',
  '/admin/reports?returnTo=//evil.test',
  '/admin/reports?page=1&page=2',
  '/admin/reports?focusReport=' + id
])('rejects unsafe return %s', (value) => {
  expect(safeReportListHref(value)).toBe('/admin/reports')
})
it('detail links are bare local IDs and cannot carry nested returns', () => {
  expect(reportDetailHref(id)).toBe('/reports/' + id)
  expect(() => reportDetailHref('../bad')).toThrow()
  expect(safeReportListHref('/admin/reports?status=OPEN&page=2')).toContain(
    'status=OPEN'
  )
})
