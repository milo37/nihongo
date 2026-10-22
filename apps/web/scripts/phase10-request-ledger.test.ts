import { describe, expect, it } from 'vitest'
import type { TestInfo } from '@playwright/test'
import {
  assertAndAttachLedger,
  selectRequestLedger,
  waitForLedgerSelectionToQuiesce
} from '../e2e/phase10-request-ledger'
import type {
  RequestLedger,
  RequestLedgerEntry
} from '../e2e/phase10-request-ledger'

const entry = (startSequence: number, path: string): RequestLedgerEntry => ({
  bodyDigest: null,
  finishSequence: startSequence + 1,
  idempotencyKeyDigest: null,
  method: 'GET',
  path,
  provenance: 'canonical-real-network',
  startSequence,
  status: 200
})

const captureAttachment = () => {
  let attachedBody = ''
  const testInfo = {
    attach: async (
      _name: string,
      options: { readonly body?: string | Buffer }
    ): Promise<void> => {
      attachedBody = String(options.body ?? '')
    }
  } as Pick<TestInfo, 'attach'>
  return {
    readBody: (): string => attachedBody,
    readEntries: (): unknown[] =>
      (JSON.parse(attachedBody) as { entries: unknown[] }).entries,
    testInfo
  }
}

describe('Phase 10 request ledger quiescence', () => {
  it('includes a delayed request that starts before the quiet window closes', async () => {
    const ledger: RequestLedger = {
      entries: [entry(1, '/api/v1/me')]
    }
    const capture = captureAttachment()
    setTimeout(() => {
      ledger.entries.push(entry(3, '/api/v1/study-sessions'))
    }, 50)

    await assertAndAttachLedger(ledger, capture.testInfo, 'delayed-ledger')

    expect(capture.readEntries()).toHaveLength(2)
  })

  it('quiesces the live source before freezing a selected ledger', async () => {
    const source: RequestLedger = {
      entries: [
        {
          ...entry(1, '/api/v1/admin/questions'),
          finishSequence: null,
          provenance: 'pending',
          status: null
        }
      ]
    }
    setTimeout(() => {
      source.entries.push({
        ...entry(3, '/api/v1/admin/question-versions/:id'),
        method: 'PATCH'
      })
    }, 50)

    const isAdminCommand = ({ method, path }: RequestLedgerEntry) =>
      method !== 'GET' && path.startsWith('/api/v1/admin/')
    await waitForLedgerSelectionToQuiesce(source, isAdminCommand)
    const snapshot = selectRequestLedger(source, isAdminCommand)
    const capture = captureAttachment()
    await assertAndAttachLedger(snapshot, capture.testInfo, 'selected-ledger')

    expect(capture.readEntries()).toHaveLength(1)
  })

  it('keeps request digests in memory and excludes them from evidence', async () => {
    const sensitiveEntry: RequestLedgerEntry = {
      ...entry(1, '/api/v1/study-sessions/:id/submission'),
      bodyDigest: 'credential-body-digest-canary',
      idempotencyKeyDigest: 'idempotency-key-digest-canary',
      method: 'POST',
      status: 201
    }
    const ledger: RequestLedger = { entries: [sensitiveEntry] }
    const capture = captureAttachment()

    await assertAndAttachLedger(ledger, capture.testInfo, 'redacted-ledger')

    expect(sensitiveEntry.bodyDigest).toBe('credential-body-digest-canary')
    expect(sensitiveEntry.idempotencyKeyDigest).toBe(
      'idempotency-key-digest-canary'
    )
    expect(capture.readEntries()).toEqual([
      {
        finishSequence: 2,
        method: 'POST',
        path: '/api/v1/study-sessions/:id/submission',
        provenance: 'canonical-real-network',
        startSequence: 1,
        status: 201
      }
    ])
    expect(capture.readBody()).not.toContain('credential-body-digest-canary')
    expect(capture.readBody()).not.toContain('idempotency-key-digest-canary')
  })
})
