import { describe, expect, it } from 'vitest'
import type { BrowserContext, TestInfo } from '@playwright/test'
import {
  assertAndAttachLedger,
  selectRequestLedger,
  trackRequestLedger,
  waitForLedgerSelectionToQuiesce,
  waitForLedgerToSettle
} from '../e2e/request-ledger'
import type { RequestLedger, RequestLedgerEntry } from '../e2e/request-ledger'

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

describe('Request ledger quiescence', () => {
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

type Listener = (value: unknown) => void
const createEmitter = () => {
  const listeners = new Map<string, Listener[]>()
  return {
    on: (event: string, listener: Listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
    },
    emit: (event: string, value?: unknown) => {
      for (const listener of listeners.get(event) ?? []) listener(value)
    }
  }
}

const createBrowser = () => {
  const mainFrame = { name: 'main' }
  const childFrame = { name: 'child' }
  const page = { ...createEmitter(), mainFrame: () => mainFrame }
  const context = { ...createEmitter(), pages: () => [page] }
  const request = (
    path: string,
    { frame = mainFrame, navigation = false } = {}
  ) => ({
    url: () => `http://127.0.0.1:4173${path}`,
    postData: () => null,
    headers: () => ({}),
    method: () => 'GET',
    frame: () => frame,
    isNavigationRequest: () => navigation
  })
  const respond = (target: ReturnType<typeof request>, status = 200) => {
    context.emit('response', {
      request: () => target,
      status: () => status,
      headers: () => ({}),
      fromServiceWorker: () => false
    })
  }
  const navigate = (path: string) => {
    const document = request(path, { navigation: true })
    context.emit('request', document)
    respond(document)
    context.emit('requestfinished', document)
    page.emit('domcontentloaded')
  }
  const ledger = trackRequestLedger(context as unknown as BrowserContext)
  return { childFrame, context, ledger, navigate, page, request, respond }
}

describe('Request ledger document replacement', () => {
  it('settles an old-document request the next document aborted without requestfailed', async () => {
    const browser = createBrowser()
    browser.context.emit('request', browser.request('/api/v1/me'))
    browser.navigate('/practice')

    expect(browser.ledger.entries).toMatchObject([
      {
        path: '/api/v1/me',
        status: 'NETWORK_ERROR',
        provenance: 'network-failure'
      }
    ])
    await waitForLedgerToSettle(browser.ledger)
  })

  it('keeps a request of the new document pending until it really settles', () => {
    const browser = createBrowser()
    const document = browser.request('/practice', { navigation: true })
    browser.context.emit('request', document)
    browser.respond(document)
    browser.context.emit('request', browser.request('/api/v1/me'))
    browser.page.emit('domcontentloaded')

    expect(browser.ledger.entries).toMatchObject([
      { path: '/api/v1/me', status: null, provenance: 'pending' }
    ])
  })

  it('keeps a pending request when the route changes inside the same document', () => {
    const browser = createBrowser()
    browser.context.emit('request', browser.request('/api/v1/me'))
    // Same-document history changes produce no navigation request or new document.
    browser.page.emit('framenavigated', browser.page.mainFrame())

    expect(browser.ledger.entries).toMatchObject([
      { status: null, finishSequence: null, provenance: 'pending' }
    ])
  })

  it('keeps a real API error and a received status across document replacement', () => {
    const browser = createBrowser()
    const failed = browser.request('/api/v1/study-sessions')
    browser.context.emit('request', failed)
    browser.respond(failed, 500)
    browser.context.emit('requestfinished', failed)
    const answered = browser.request('/api/v1/me')
    browser.context.emit('request', answered)
    browser.respond(answered, 200)
    browser.navigate('/practice')

    expect(browser.ledger.entries).toMatchObject([
      { path: '/api/v1/study-sessions', status: 500 },
      { path: '/api/v1/me', status: 200, provenance: 'canonical-real-network' }
    ])
  })

  it('settles open requests of a detached frame only', () => {
    const browser = createBrowser()
    browser.context.emit(
      'request',
      browser.request('/api/v1/embedded', { frame: browser.childFrame })
    )
    browser.context.emit('request', browser.request('/api/v1/me'))
    browser.page.emit('framedetached', browser.childFrame)

    expect(browser.ledger.entries).toMatchObject([
      { path: '/api/v1/embedded', status: 'NETWORK_ERROR' },
      { path: '/api/v1/me', status: null }
    ])
  })
})
