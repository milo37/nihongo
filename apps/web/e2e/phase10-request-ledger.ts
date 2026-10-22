import { createHash } from 'node:crypto'
import { expect } from '@playwright/test'
import type { BrowserContext, Request, TestInfo } from '@playwright/test'

export interface RequestLedgerEntry {
  readonly bodyDigest: string | null
  finishSequence: number | null
  readonly idempotencyKeyDigest: string | null
  readonly method: string
  readonly path: string
  provenance:
    | 'canonical-mock-service-worker'
    | 'canonical-real-network'
    | 'injected-test-fault'
    | 'network-failure'
    | 'pending'
  readonly startSequence: number
  status: number | 'NETWORK_ERROR' | null
}

export interface RequestLedger {
  readonly entries: RequestLedgerEntry[]
}

type RequestLedgerEvidenceEntry = Pick<
  RequestLedgerEntry,
  | 'finishSequence'
  | 'method'
  | 'path'
  | 'provenance'
  | 'startSequence'
  | 'status'
>

export interface RequestLedgerContractEntry {
  readonly method: string
  readonly path: string
  readonly statuses: ReadonlyArray<number | 'NETWORK_ERROR'>
}

const normalizeApiPath = (request: Request): string =>
  new URL(request.url()).pathname.replace(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu,
    ':id'
  )

const digest = (value: string | null): string | null =>
  value === null
    ? null
    : createHash('sha256').update(value, 'utf8').digest('hex')

export const trackRequestLedger = (context: BrowserContext): RequestLedger => {
  const entries: RequestLedgerEntry[] = []
  const entryByRequest = new WeakMap<Request, RequestLedgerEntry>()
  let sequence = 0

  context.on('request', (request) => {
    const path = normalizeApiPath(request)
    if (!path.startsWith('/api/')) return
    const entry: RequestLedgerEntry = {
      bodyDigest: digest(request.postData()),
      finishSequence: null,
      idempotencyKeyDigest: digest(
        request.headers()['idempotency-key'] ?? null
      ),
      method: request.method(),
      path,
      provenance: 'pending',
      startSequence: ++sequence,
      status: null
    }
    entries.push(entry)
    entryByRequest.set(request, entry)
  })
  context.on('response', (response) => {
    const entry = entryByRequest.get(response.request())
    if (!entry) return
    entry.status = response.status()
    entry.provenance = response.headers()['x-phase10-test-fault']
      ? 'injected-test-fault'
      : response.fromServiceWorker()
        ? 'canonical-mock-service-worker'
        : 'canonical-real-network'
  })
  context.on('requestfinished', (request) => {
    const entry = entryByRequest.get(request)
    if (!entry) return
    entry.finishSequence = ++sequence
  })
  context.on('requestfailed', (request) => {
    const entry = entryByRequest.get(request)
    if (!entry) return
    entry.finishSequence = ++sequence
    entry.status = 'NETWORK_ERROR'
    entry.provenance = 'network-failure'
  })

  return { entries }
}

export const selectRequestLedger = (
  ledger: RequestLedger,
  predicate: (entry: RequestLedgerEntry) => boolean,
  startIndex = 0,
  endIndex = ledger.entries.length
): RequestLedger => ({
  entries: ledger.entries.slice(startIndex, endIndex).filter(predicate)
})

export const ledgerEntriesFor = (
  ledger: RequestLedger,
  method: string,
  path: string,
  startIndex = 0
): RequestLedgerEntry[] =>
  ledger.entries
    .slice(startIndex)
    .filter((entry) => entry.method === method && entry.path === path)

export const assertExactRequestMultiset = (
  ledger: RequestLedger,
  contract: readonly RequestLedgerContractEntry[]
): void => {
  const keyOf = ({
    method,
    path
  }: {
    readonly method: string
    readonly path: string
  }) => `${method} ${path}`
  expect([...new Set(ledger.entries.map(keyOf))].toSorted()).toEqual(
    contract.map(keyOf).toSorted()
  )
  expect(ledger.entries).toHaveLength(
    contract.reduce((total, entry) => total + entry.statuses.length, 0)
  )
  for (const expected of contract) {
    expect(
      ledgerEntriesFor(ledger, expected.method, expected.path).map(
        ({ status }) => status
      )
    ).toEqual(expected.statuses)
  }
}

const unsettledLedgerEntries = (ledger: RequestLedger) =>
  ledger.entries
    .filter(
      ({ finishSequence, provenance, startSequence, status }) =>
        finishSequence === null ||
        finishSequence <= startSequence ||
        provenance === 'pending' ||
        status === null
    )
    .map(
      ({
        finishSequence,
        method,
        path,
        provenance,
        startSequence,
        status
      }) => ({
        finishSequence,
        method,
        path,
        provenance,
        startSequence,
        status
      })
    )

export const waitForLedgerToSettle = async (
  ledger: RequestLedger
): Promise<void> => {
  await expect
    .poll(() => unsettledLedgerEntries(ledger), { timeout: 10_000 })
    .toEqual([])
}

export const waitForLedgerToQuiesce = async (
  ledger: RequestLedger,
  startIndex = 0,
  quietMilliseconds = 250
): Promise<void> => {
  let lastEntryCount = -1
  let stableSince = Date.now()
  await expect
    .poll(
      () => {
        const activeLedger: RequestLedger = {
          entries: ledger.entries.slice(startIndex)
        }
        if (activeLedger.entries.length !== lastEntryCount) {
          lastEntryCount = activeLedger.entries.length
          stableSince = Date.now()
        }
        const unsettled = unsettledLedgerEntries(activeLedger)
        if (unsettled.length > 0) stableSince = Date.now()
        return {
          quiet:
            unsettled.length === 0 &&
            Date.now() - stableSince >= quietMilliseconds,
          unsettled
        }
      },
      { intervals: [50, 100, 100, 100], timeout: 10_000 }
    )
    .toEqual({ quiet: true, unsettled: [] })
}

export const waitForLedgerSelectionToQuiesce = async (
  ledger: RequestLedger,
  predicate: (entry: RequestLedgerEntry) => boolean,
  startIndex = 0,
  quietMilliseconds = 250
): Promise<void> => {
  const liveSelection: RequestLedger = {
    get entries() {
      return ledger.entries.slice(startIndex).filter(predicate)
    }
  }
  await waitForLedgerToQuiesce(liveSelection, 0, quietMilliseconds)
}

export const assertAndAttachLedger = async (
  ledger: RequestLedger,
  testInfo: Pick<TestInfo, 'attach'>,
  label: string
): Promise<void> => {
  await waitForLedgerToQuiesce(ledger)
  const snapshot: RequestLedger = {
    entries: ledger.entries.map((entry) => ({ ...entry }))
  }
  await waitForLedgerToSettle(snapshot)
  await testInfo.attach(label, {
    body: JSON.stringify(
      {
        entries: snapshot.entries.map<RequestLedgerEvidenceEntry>(
          ({
            finishSequence,
            method,
            path,
            provenance,
            startSequence,
            status
          }) => ({
            finishSequence,
            method,
            path,
            provenance,
            startSequence,
            status
          })
        )
      },
      null,
      2
    ),
    contentType: 'application/json'
  })
}
