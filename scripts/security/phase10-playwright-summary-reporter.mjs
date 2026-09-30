import { createHash } from 'node:crypto'
import path from 'node:path'
import {
  assertPlaywrightRequestLedger,
  writeCanonicalEvidence
} from './security-evidence.mjs'

const VALID_LABEL = /^phase(?:8|9|10)-(?:real|mock)$/u
const VALID_STATUS = new Set([
  'passed',
  'failed',
  'skipped',
  'timedOut',
  'interrupted'
])
const REQUEST_LEDGER_ATTACHMENT =
  /^phase10-(?:guest-auth|user-journey|resilience)-(?:real|mock)-request-ledger$/u

const normalizeStatus = (status) =>
  VALID_STATUS.has(status) ? status : 'failed'

export default class Phase10PlaywrightSummaryReporter {
  constructor(options = {}) {
    if (
      typeof options.outputDirectory !== 'string' ||
      typeof options.label !== 'string' ||
      !VALID_LABEL.test(options.label)
    ) {
      throw new Error('PHASE10_PLAYWRIGHT_REPORTER_OPTIONS_INVALID')
    }
    this.outputDirectory = options.outputDirectory
    this.label = options.label
    this.requestLedgers = []
    this.requestLedgerError = false
    this.startedAt = 0
    this.tests = []
  }

  printsToStdio() {
    return false
  }

  onBegin() {
    this.startedAt = Date.now()
    this.requestLedgers = []
    this.requestLedgerError = false
    this.tests = []
  }

  onTestEnd(test, result) {
    const location = test.location ?? { file: '', line: 0 }
    const relativeFile = path.relative(process.cwd(), location.file ?? '')
    const identity = [
      relativeFile,
      String(location.line ?? 0),
      ...test.titlePath()
    ].join('\0')
    this.tests.push({
      testId: createHash('sha256').update(identity, 'utf8').digest('hex'),
      status: normalizeStatus(result.status),
      durationMs: Math.max(0, Math.round(result.duration ?? 0)),
      retry: Math.max(0, Math.round(result.retry ?? 0))
    })
    for (const attachment of result.attachments ?? []) {
      if (!REQUEST_LEDGER_ATTACHMENT.test(attachment.name ?? '')) continue
      try {
        if (
          attachment.contentType !== 'application/json' ||
          !Buffer.isBuffer(attachment.body)
        ) {
          throw new Error('invalid attachment transport')
        }
        const payload = JSON.parse(attachment.body.toString('utf8'))
        const ledger = { label: attachment.name, ...payload }
        assertPlaywrightRequestLedger(ledger, this.label)
        this.requestLedgers.push(ledger)
      } catch {
        this.requestLedgerError = true
      }
    }
  }

  async onEnd(result) {
    if (this.requestLedgerError) {
      throw new Error('PHASE10_PLAYWRIGHT_REQUEST_LEDGER_INVALID')
    }
    const tests = this.tests.toSorted(
      (left, right) =>
        left.testId.localeCompare(right.testId) || left.retry - right.retry
    )
    const counts = {
      passed: 0,
      failed: 0,
      skipped: 0,
      timedOut: 0,
      interrupted: 0,
      total: tests.length
    }
    for (const test of tests) counts[test.status] += 1
    const requestLedgers = this.requestLedgers.toSorted((left, right) =>
      left.label.localeCompare(right.label)
    )
    await writeCanonicalEvidence({
      filePath: path.join(this.outputDirectory, `${this.label}.json`),
      value: {
        schemaVersion: 1,
        kind: 'nihongo.playwright-safe-summary',
        label: this.label,
        status: result.status === 'passed' ? 'passed' : 'failed',
        durationMs: Math.max(0, Date.now() - this.startedAt),
        counts,
        requestLedgers,
        tests
      }
    })
  }
}
