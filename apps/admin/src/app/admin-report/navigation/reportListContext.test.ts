import { describe, expect, it } from 'vitest'
import {
  parseReportListSearch,
  reportDetailHref,
  reportListHref,
  safeReportListHref
} from '@app/admin-report/navigation/reportListContext'
const id = '10000000-0000-4000-8000-000000000001'
it('round trips status, kind, page and an allowed page size', () => {
  const input = new URLSearchParams({
    status: 'RECEIVED',
    kind: 'APP_ERROR',
    page: '3',
    pageSize: '50'
  })
  const result = parseReportListSearch(input)
  expect(result.valid).toBe(true)
  expect(
    parseReportListSearch(
      new URLSearchParams(reportListHref(result.query).split('?')[1])
    )
  ).toEqual(result)
})
it('omits the default page size from the canonical link', () => {
  expect(reportListHref({ page: 2, pageSize: 25 })).toBe(
    '/admin/reports?page=2'
  )
})
describe('strict filters', () => {
  it.each([
    'page=0',
    'page=',
    'page=2&page=3',
    'status=RECEIVED&status=RECEIVED',
    'status=OPEN',
    'kind=OTHER',
    'q=secret',
    'pageSize=30',
    'returnTo=%2Fadmin%2Freports',
    'reason=OTHER'
  ])('rejects %s without forwarding unsafe input', (search) => {
    expect(parseReportListSearch(new URLSearchParams(search))).toEqual({
      valid: false,
      query: { page: 1, pageSize: 25 }
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
  '/admin/reports?page=1\n',
  '/admin/reports?returnTo=//evil.test',
  '/admin/reports?page=1&page=2',
  '/admin/reports?focusReport=' + id
])('rejects unsafe return %s', (value) => {
  expect(safeReportListHref(value)).toBe('/admin/reports')
})
it('detail links are bare local IDs and cannot carry nested returns', () => {
  expect(reportDetailHref(id)).toBe('/reports/' + id)
  expect(() => reportDetailHref('../bad')).toThrow()
  expect(safeReportListHref('/admin/reports?status=ANSWERED&page=2')).toContain(
    'status=ANSWERED'
  )
})
