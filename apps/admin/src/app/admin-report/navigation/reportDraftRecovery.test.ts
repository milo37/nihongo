import { beforeEach, expect, it, vi } from 'vitest'
import { cachedSessionStorage } from '@nihongo/browser/libs/storage'
import { advanceAuthTransitionEpoch } from '@nihongo/browser/libs/authTransitionFence'
import {
  saveReportContext,
  readReportReturn,
  consumeReportListFocus,
  saveReportDraft,
  restoreReportDraft,
  discardReportDraft
} from '@app/admin-report/navigation/reportDraftRecovery'
const actor = '10000000-0000-4000-8000-000000000001'
const report = '10000000-0000-4000-8000-000000000002'
const other = '10000000-0000-4000-8000-000000000003'
const draft = {
  outcome: 'RESOLVED' as const,
  reason: '해설 확인',
  remediationVersionId: ''
}
beforeEach(() => {
  discardReportDraft(actor, report)
  discardReportDraft(other, report)
  vi.restoreAllMocks()
})
it('restores a valid draft for the new canonical same actor/report/version without requiring the old document epoch', () => {
  expect(saveReportDraft(actor, report, 2, draft)).toBe(true)
  advanceAuthTransitionEpoch()
  expect(restoreReportDraft(actor, report, 2)).toEqual(draft)
})
it('never restores across actors, reports, or CAS versions', () => {
  saveReportDraft(actor, report, 2, draft)
  expect(restoreReportDraft(other, report, 2)).toBeNull()
  expect(restoreReportDraft(actor, other, 2)).toBeNull()
  expect(restoreReportDraft(actor, report, 3)).toBeNull()
})
it('preserves only the resolution fields and discards explicitly', () => {
  const write = vi.spyOn(cachedSessionStorage, 'setItem')
  saveReportDraft(actor, report, 2, draft)
  const stored = JSON.parse(String(write.mock.calls[0]?.[1]))
  expect(Object.keys(stored).sort()).toEqual([
    'actorId',
    'draft',
    'reportId',
    'rowVersion',
    'version'
  ])
  expect(stored.draft).toEqual(draft)
  discardReportDraft(actor, report)
  expect(restoreReportDraft(actor, report, 2)).toBeNull()
})
it('does not report success after storage failure or invalid input', () => {
  vi.spyOn(cachedSessionStorage, 'setItem').mockReturnValue(false)
  expect(saveReportDraft(actor, report, 2, draft)).toBe(false)
  expect(
    saveReportDraft(actor, report, 2, { ...draft, reason: '😀'.repeat(1001) })
  ).toBe(false)
  expect(saveReportDraft('invalid', report, 2, draft)).toBe(false)
})
it('rejects malformed and poisoned storage without throwing', () => {
  vi.spyOn(cachedSessionStorage, 'getItem').mockReturnValue('{')
  expect(restoreReportDraft(actor, report, 2)).toBeNull()
  vi.mocked(cachedSessionStorage.getItem).mockReturnValue(
    JSON.stringify({
      version: 1,
      actorId: other,
      reportId: report,
      rowVersion: 2,
      draft
    })
  )
  expect(restoreReportDraft(actor, report, 2)).toBeNull()
})
it('restores normalized list context and consumes Back focus only once', () => {
  saveReportContext(actor, report, '/admin/reports?status=TRIAGED&page=3')
  const href = readReportReturn(actor, report)
  expect(href).toContain('status=TRIAGED')
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
