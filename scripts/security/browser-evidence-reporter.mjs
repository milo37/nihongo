import { createHash } from 'node:crypto'
import path from 'node:path'
import {
  assertPlaywrightPerformanceMeasurement,
  assertPlaywrightRequestLedger,
  projectLedgerDiagnosticEntries,
  writeCanonicalEvidence
} from './security-evidence.mjs'

const VALID_LABEL =
  /^(?:admin|admin-dashboard|accessibility|journey)-(?:real|mock)$/u
const VALID_STATUS = new Set([
  'passed',
  'failed',
  'skipped',
  'timedOut',
  'interrupted'
])
const REQUEST_LEDGER_ATTACHMENT =
  /^(?:admin-(?:cms-real-request-ledger|(?:guest|user)-denial)|(?:admin-lifecycle|dashboard|guest-auth|user-journey|resilience)-(?:real|mock)-request-ledger|journey-(?:real|mock)-(?:ko|ja)-handoff)$/u
const PERFORMANCE_ATTACHMENT = /^dashboard-(?:real|mock)-performance$/u
// JLP-788: a spec attaches the entries that failed its own ledger check. Only
// a diagnostic: it never enters the evidence and never changes the verdict.
const LEDGER_CHECK_DIAGNOSTIC_ATTACHMENT =
  /^(?:guest-auth|user-journey)-(?:real|mock)-ledger-diagnostic$/u
const LEGACY_DASHBOARD_ATTACHMENT =
  /^[a-z]+[0-9]+-dashboard-(?:real|mock)-(?:request-ledger|performance)$/u

const normalizeStatus = (status) =>
  VALID_STATUS.has(status) ? status : 'failed'

export default class PlaywrightEvidenceReporter {
  constructor(options = {}) {
    if (
      typeof options.outputDirectory !== 'string' ||
      typeof options.label !== 'string' ||
      !VALID_LABEL.test(options.label)
    ) {
      throw new Error('PLAYWRIGHT_EVIDENCE_REPORTER_OPTIONS_INVALID')
    }
    if (
      options.diagnosticDirectory !== undefined &&
      (typeof options.diagnosticDirectory !== 'string' ||
        options.diagnosticDirectory === '' ||
        path.resolve(options.diagnosticDirectory) ===
          path.resolve(options.outputDirectory))
    ) {
      throw new Error('PLAYWRIGHT_EVIDENCE_REPORTER_OPTIONS_INVALID')
    }
    this.outputDirectory = options.outputDirectory
    this.diagnosticDirectory = options.diagnosticDirectory
    this.label = options.label
    this.performanceMeasurements = []
    this.requestLedgers = []
    this.invalidSafeAttachments = new Map()
    this.invalidLedgerDiagnostics = []
    this.ledgerCheckDiagnostics = []
    this.startedAt = 0
    this.tests = []
  }

  printsToStdio() {
    return false
  }

  onBegin() {
    this.startedAt = Date.now()
    this.performanceMeasurements = []
    this.requestLedgers = []
    this.invalidSafeAttachments = new Map()
    this.invalidLedgerDiagnostics = []
    this.ledgerCheckDiagnostics = []
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
      const attachmentName = attachment.name ?? ''
      if (LEGACY_DASHBOARD_ATTACHMENT.test(attachmentName)) {
        this.invalidSafeAttachments.set(
          attachmentName,
          'SECURITY_EVIDENCE_LEGACY_ATTACHMENT_FORBIDDEN'
        )
        continue
      }
      if (LEDGER_CHECK_DIAGNOSTIC_ATTACHMENT.test(attachmentName)) {
        let entries
        try {
          entries =
            attachment.contentType === 'application/json' &&
            Buffer.isBuffer(attachment.body)
              ? JSON.parse(attachment.body.toString('utf8'))?.entries
              : undefined
        } catch {
          entries = undefined
        }
        this.ledgerCheckDiagnostics.push({
          entries: projectLedgerDiagnosticEntries(entries),
          name: attachmentName
        })
        continue
      }
      const isRequestLedger = REQUEST_LEDGER_ATTACHMENT.test(attachmentName)
      const isPerformance = PERFORMANCE_ATTACHMENT.test(attachmentName)
      if (!isRequestLedger && !isPerformance) continue
      let payload
      try {
        if (
          attachment.contentType !== 'application/json' ||
          !Buffer.isBuffer(attachment.body)
        ) {
          throw new Error('invalid attachment transport')
        }
        payload = JSON.parse(attachment.body.toString('utf8'))
        if (isRequestLedger && Object.hasOwn(payload, 'label')) {
          throw new Error('SECURITY_EVIDENCE_LEDGER_SOURCE_INVALID')
        }
        const ledger = { label: attachment.name, ...payload }
        if (isRequestLedger) {
          assertPlaywrightRequestLedger(ledger, this.label)
          this.requestLedgers.push(ledger)
        } else {
          assertPlaywrightPerformanceMeasurement(ledger, this.label)
          this.performanceMeasurements.push(ledger)
        }
      } catch (error) {
        const errorCode =
          error instanceof Error &&
          /^SECURITY_EVIDENCE_[A-Z0-9_]+$/u.test(error.message)
            ? error.message
            : 'SECURITY_EVIDENCE_ATTACHMENT_INVALID'
        this.invalidSafeAttachments.set(attachmentName, errorCode)
        if (isRequestLedger) {
          this.invalidLedgerDiagnostics.push({
            entries: projectLedgerDiagnosticEntries(payload?.entries),
            errorCode,
            name: attachmentName
          })
        }
      }
    }
  }

  async onEnd(result) {
    if (this.diagnosticDirectory && this.ledgerCheckDiagnostics.length > 0) {
      await writeCanonicalEvidence({
        filePath: path.join(
          this.diagnosticDirectory,
          `${this.label}-ledger-check-failures.json`
        ),
        value: {
          schemaVersion: 1,
          kind: 'nihongo.playwright-ledger-check-diagnostic',
          label: this.label,
          ledgers: this.ledgerCheckDiagnostics
        }
      })
    }
    if (this.invalidSafeAttachments.size > 0) {
      if (
        this.diagnosticDirectory &&
        this.invalidLedgerDiagnostics.length > 0
      ) {
        await writeCanonicalEvidence({
          filePath: path.join(
            this.diagnosticDirectory,
            `${this.label}-invalid-ledgers.json`
          ),
          value: {
            schemaVersion: 1,
            kind: 'nihongo.playwright-invalid-ledger-diagnostic',
            label: this.label,
            ledgers: this.invalidLedgerDiagnostics
          }
        })
      }
      throw new Error(
        `PLAYWRIGHT_EVIDENCE_SAFE_ATTACHMENT_INVALID:${[
          ...this.invalidSafeAttachments
        ]
          .toSorted(([leftName], [rightName]) =>
            leftName.localeCompare(rightName)
          )
          .map(([name, errorCode]) => `${name}=${errorCode}`)
          .join(',')}`
      )
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
    const performanceMeasurements = this.performanceMeasurements.toSorted(
      (left, right) => left.label.localeCompare(right.label)
    )
    await writeCanonicalEvidence({
      filePath: path.join(this.outputDirectory, `${this.label}.json`),
      value: {
        schemaVersion: 2,
        kind: 'nihongo.playwright-safe-summary',
        label: this.label,
        status: result.status === 'passed' ? 'passed' : 'failed',
        durationMs: Math.max(0, Date.now() - this.startedAt),
        counts,
        performanceMeasurements,
        requestLedgers,
        tests
      }
    })
  }
}
