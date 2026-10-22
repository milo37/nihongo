import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import {
  invalidatePhase7AdminMutation,
  type Phase7InvalidationTarget
} from '@app/admin-question/queries/phase7AdminInvalidation'

const collectInvalidations = async (
  target: Phase7InvalidationTarget
): Promise<ReadonlySet<string>> => {
  const queryClient = new QueryClient()
  const invalidation = vi.spyOn(queryClient, 'invalidateQueries')

  await invalidatePhase7AdminMutation(queryClient, target)

  return new Set(
    invalidation.mock.calls.map(([filters]) => {
      if (!filters) throw new Error('Invalidation filters are unavailable.')
      return JSON.stringify(filters.queryKey)
    })
  )
}

describe('Phase 7 admin cache invalidation', () => {
  it('publication refreshes current learner availability without invalidating immutable result families', async () => {
    const keys = await collectInvalidations({
      kind: 'PUBLICATION',
      questionIds: ['question-1'],
      versionIds: ['version-1', 'version-2']
    })

    expect(keys).toEqual(
      new Set([
        '["phase7-admin","audit-log","list"]',
        '["phase7-admin","questions","list"]',
        '["phase7-admin","questions","detail","question-1"]',
        '["phase7-admin","question-versions","history","question-1"]',
        '["phase7-admin","question-versions","preview","version-1"]',
        '["phase7-admin","question-versions","diff","version-1"]',
        '["phase7-admin","question-versions","preview","version-2"]',
        '["phase7-admin","question-versions","diff","version-2"]',
        '["phase7-admin","question-versions","reviews","version-1"]',
        '["phase7-admin","question-versions","reviews","version-2"]',
        '["question"]',
        '["study","candidates"]',
        '["bookmark","list"]',
        '["wrong-note","historical-list"]',
        '["wrong-note","detail"]',
        '["wrong-note","review-queue"]',
        '["dashboard"]'
      ])
    )
  })

  it('keeps content, review, and batch invalidation scoped to affected entities', async () => {
    const content = await collectInvalidations({
      kind: 'CONTENT_EDIT',
      questionIds: ['question-1'],
      versionIds: ['version-1']
    })
    const review = await collectInvalidations({
      kind: 'REVIEW',
      questionIds: ['question-1'],
      versionIds: ['version-1']
    })
    const batch = await collectInvalidations({
      kind: 'BATCH_REVIEW',
      questionIds: ['question-1', 'question-2'],
      versionIds: ['version-1', 'version-2']
    })

    expect(content).toEqual(
      new Set([
        '["phase7-admin","audit-log","list"]',
        '["phase7-admin","questions","list"]',
        '["phase7-admin","questions","detail","question-1"]',
        '["phase7-admin","question-versions","history","question-1"]',
        '["phase7-admin","question-versions","preview","version-1"]',
        '["phase7-admin","question-versions","diff","version-1"]'
      ])
    )
    expect(review).toEqual(
      new Set([
        '["phase7-admin","audit-log","list"]',
        '["phase7-admin","questions","list"]',
        '["phase7-admin","questions","detail","question-1"]',
        '["phase7-admin","question-versions","history","question-1"]',
        '["phase7-admin","question-versions","reviews","version-1"]'
      ])
    )
    expect(batch).toEqual(
      new Set([
        '["phase7-admin","audit-log","list"]',
        '["phase7-admin","questions","list"]',
        '["phase7-admin","questions","detail","question-1"]',
        '["phase7-admin","questions","detail","question-2"]',
        '["phase7-admin","question-versions","history","question-1"]',
        '["phase7-admin","question-versions","history","question-2"]',
        '["phase7-admin","question-versions","reviews","version-1"]',
        '["phase7-admin","question-versions","reviews","version-2"]'
      ])
    )
  })

  it('report creation updates open counts and queues without inventing an audit event', async () => {
    const keys = await collectInvalidations({
      kind: 'REPORT_CREATE',
      questionIds: ['question-1'],
      reportId: 'report-1'
    })

    expect(keys).toEqual(
      new Set([
        '["phase7-admin","questions","list"]',
        '["phase7-admin","questions","detail","question-1"]',
        '["phase7-admin","question-reports","list"]',
        '["phase7-admin","question-reports","detail","report-1"]'
      ])
    )
  })

  it('triage and export invalidate only their evidence-bearing families', async () => {
    const triage = await collectInvalidations({
      kind: 'REPORT_TRIAGE',
      reportId: 'report-1'
    })
    const exported = await collectInvalidations({ kind: 'EXPORT' })

    expect(triage).toEqual(
      new Set([
        '["phase7-admin","audit-log","list"]',
        '["phase7-admin","question-reports","list"]',
        '["phase7-admin","question-reports","detail","report-1"]'
      ])
    )
    expect(exported).toEqual(new Set(['["phase7-admin","audit-log","list"]']))
  })

  it('reauthentication refreshes the principal and only the pending command targets', async () => {
    const keys = await collectInvalidations({
      kind: 'REAUTHENTICATION',
      questionIds: ['question-1'],
      reportId: 'report-1'
    })

    expect(keys).toEqual(
      new Set([
        '["phase7-admin","audit-log","list"]',
        '["auth","get-current-user"]',
        '["phase7-admin","questions","detail","question-1"]',
        '["phase7-admin","question-reports","detail","report-1"]'
      ])
    )
  })
})
