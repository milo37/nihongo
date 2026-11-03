import { beforeEach, expect, it } from 'vitest'
import {
  saveReportContext,
  readReportReturn,
  consumeReportListFocus
} from '@app/admin-report/navigation/reportListFocus'
const actor = '10000000-0000-4000-8000-000000000001'
const report = '10000000-0000-4000-8000-000000000002'
const other = '10000000-0000-4000-8000-000000000003'
beforeEach(() => window.sessionStorage.clear())
it('restores normalized list context and consumes Back focus only once', () => {
  saveReportContext(actor, report, '/admin/reports?status=RECEIVED&page=3')
  const href = readReportReturn(actor, report)
  expect(href).toContain('status=RECEIVED')
  expect(href).toContain('page=3')
  expect(consumeReportListFocus(actor, href)).toBe(report)
  expect(consumeReportListFocus(actor, href)).toBeNull()
  expect(readReportReturn(other, report)).toBe('/admin/reports')
})
it('normalizes unsafe stored returns and rejects mismatching focus destinations', () => {
  saveReportContext(actor, report, 'https://evil.test/')
  expect(
    new URL(readReportReturn(actor, report), 'https://app.test').pathname
  ).toBe('/admin/reports')
  saveReportContext(actor, report, '/admin/reports?page=2')
  expect(consumeReportListFocus(actor, '/admin/reports?page=1')).toBeNull()
})
