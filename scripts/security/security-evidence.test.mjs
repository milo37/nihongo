import assert from 'node:assert/strict'
import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Phase10PlaywrightSummaryReporter from './phase10-playwright-summary-reporter.mjs'
import {
  assertEvidenceValueSafe,
  assertPlaywrightPerformanceMeasurement,
  assertPlaywrightRequestLedger,
  assertWorkflowArtifactPolicy,
  canonicalizeEvidence,
  verifyArtifactDirectory,
  writeCanonicalEvidence
} from './security-evidence.mjs'

const phase8AdminLedgerOperations = [
  ['POST', '/api/v1/admin/questions/import-validation', 200],
  ['POST', '/api/v1/admin/questions/import-application', 201],
  ['POST', '/api/v1/admin/questions/export', 200],
  ['POST', '/api/v1/admin/question-versions/:id/review-request', 200],
  ['POST', '/api/v1/admin/question-versions/:id/approval', 409],
  ['POST', '/api/v1/admin/question-versions/:id/approval', 200],
  ['POST', '/api/v1/admin/question-versions/:id/publication', 401],
  ['POST', '/api/v1/admin/reauthentication', 401],
  ['POST', '/api/v1/admin/reauthentication', 200],
  ['POST', '/api/v1/admin/question-versions/:id/approval', 409],
  ['POST', '/api/v1/admin/question-versions/:id/publication', 200],
  ['POST', '/api/v1/admin/questions/:id/versions', 201],
  ['PATCH', '/api/v1/admin/question-versions/:id', 200],
  ['PATCH', '/api/v1/admin/question-versions/:id', 409],
  ['PATCH', '/api/v1/admin/question-versions/:id', 200],
  ['PATCH', '/api/v1/admin/question-versions/:id', 200],
  ['PATCH', '/api/v1/admin/question-versions/:id', 409]
]

const createRequestLedgerEntries = (name, pathName) => {
  const provenance = name.includes('-mock-')
    ? 'canonical-mock-service-worker'
    : 'canonical-real-network'
  if (name.startsWith('phase8-dashboard-')) {
    return Array.from({ length: 21 }, (_, triggerIndex) => {
      const sequence = triggerIndex * 4
      return [
        {
          finishSequence: sequence + 3,
          method: 'GET',
          path: '/api/v1/dashboard',
          provenance,
          startSequence: sequence + 1,
          status: 200
        },
        {
          finishSequence: sequence + 4,
          method: 'GET',
          path: '/api/v1/dashboard/insights',
          provenance,
          startSequence: sequence + 2,
          status: 200
        }
      ]
    }).flat()
  }
  if (name.startsWith('phase8-admin-lifecycle-')) {
    return phase8AdminLedgerOperations.map(
      ([method, operationPath, status], index) => ({
        finishSequence: index < 15 ? index * 2 + 2 : index + 18,
        method,
        path: operationPath,
        provenance,
        startSequence: index < 15 ? index * 2 + 1 : index + 16,
        status
      })
    )
  }
  if (name.startsWith('phase10-user-journey-')) {
    const operations = [
      ...Array.from({ length: 6 }, () => [
        'PUT',
        '/api/v1/study-sessions/:id/draft-answers',
        200
      ]),
      ...Array.from({ length: 2 }, () => [
        'POST',
        '/api/v1/study-sessions/:id/submission',
        201
      ]),
      ['POST', '/api/v1/wrong-notes/:id/review-session', 201]
    ]
    return operations.map(([method, operationPath, status], index) => ({
      finishSequence: index * 2 + 2,
      method,
      path: operationPath,
      provenance,
      startSequence: index * 2 + 1,
      status
    }))
  }
  return [
    {
      finishSequence: 2,
      method: 'GET',
      path: pathName,
      provenance,
      startSequence: 1,
      status: 200
    }
  ]
}

const createRequestLedgerAttachment = (name, pathName = '/api/v1/me') => ({
  name,
  contentType: 'application/json',
  body: Buffer.from(
    JSON.stringify({ entries: createRequestLedgerEntries(name, pathName) }),
    'utf8'
  )
})

const createPerformanceMeasurement = (mode) => {
  const baselineP95Milliseconds = mode === 'mock' ? 952.266 : 875.085
  const samplesMs = Array.from({ length: 20 }, () => baselineP95Milliseconds)
  const ratioCeilingMilliseconds = mode === 'mock' ? 7_618.128 : 7_000.68
  return {
    label: `phase8-dashboard-${mode}-performance`,
    schemaVersion: 1,
    kind: 'nihongo.phase10.browser-performance',
    surface: 'dashboard-navigation',
    mode,
    warmupCount: 1,
    sampleCount: 20,
    samplesMs,
    statisticsMs: {
      max: baselineP95Milliseconds,
      median: baselineP95Milliseconds,
      min: baselineP95Milliseconds,
      p95: baselineP95Milliseconds
    },
    budget: {
      absoluteCeilingMilliseconds: 10_000,
      baselineP95Milliseconds,
      effectiveCeilingMilliseconds: ratioCeilingMilliseconds,
      observedToBaselineRatio: 1,
      passed: true,
      ratioCeilingMilliseconds,
      ratioLimit: 8
    }
  }
}

const createPerformanceAttachment = (mode) => {
  const { label, ...payload } = createPerformanceMeasurement(mode)
  return {
    name: label,
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify(payload), 'utf8')
  }
}

test('canonical evidence has deterministic recursive key ordering', () => {
  assert.deepEqual(
    canonicalizeEvidence({ z: 1, a: { y: 2, b: 3 } }),
    canonicalizeEvidence({ a: { b: 3, y: 2 }, z: 1 })
  )
})

test('environment values and strong credential shapes are rejected without echoing them', () => {
  const secret = ['ghp_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'].join('')
  assert.throws(() => assertEvidenceValueSafe({ value: { value: secret } }), {
    message: 'SECURITY_EVIDENCE_SENSITIVE_PATTERN'
  })
  assert.throws(
    () =>
      assertEvidenceValueSafe({
        value: { safeKey: 'fixture-password-value' },
        additionalSecrets: ['fixture-password-value']
      }),
    { message: 'SECURITY_EVIDENCE_ENVIRONMENT_SECRET' }
  )
})

test('safe reporter supports exact Phase 7 runner labels and rejects unsafe labels', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'phase7-reporter-'))
  for (const mode of ['real', 'mock']) {
    const label = `phase7-${mode}`
    const reporter = new Phase10PlaywrightSummaryReporter({
      outputDirectory: directory,
      label
    })
    reporter.onBegin()
    await reporter.onEnd({ status: 'passed' })
    const summary = JSON.parse(
      await readFile(path.join(directory, `${label}.json`), 'utf8')
    )
    assert.equal(summary.label, label)
    assert.equal(summary.status, 'passed')
  }
  for (const label of ['phase6-real', 'phase7-live', '../phase7-real']) {
    assert.throws(
      () =>
        new Phase10PlaywrightSummaryReporter({
          outputDirectory: directory,
          label
        }),
      /PHASE10_PLAYWRIGHT_REPORTER_OPTIONS_INVALID/
    )
  }
})

test('safe Playwright reporter hashes identity and ignores title, errors, output and attachments', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'phase10-reporter-'))
  const sentinel = 'phase10-verification-token-sentinel'
  const reporter = new Phase10PlaywrightSummaryReporter({
    outputDirectory: directory,
    label: 'phase10-real'
  })
  const requestLedgerAttachments = [
    'guest-auth',
    'resilience',
    'user-journey'
  ].map((journey) =>
    createRequestLedgerAttachment(`phase10-${journey}-real-request-ledger`)
  )
  reporter.onBegin()
  for (let index = 0; index < 3; index += 1) {
    reporter.onTestEnd(
      {
        location: {
          file: `/private/${sentinel}/spec.ts`,
          line: index + 12
        },
        titlePath: () => ['suite', `${sentinel}-${index}`]
      },
      {
        status: 'passed',
        duration: 10,
        retry: 0,
        error: new Error(`/verify-email#token=${sentinel}`),
        stdout: [`#token=${sentinel}`],
        attachments:
          index === 0
            ? [
                { name: sentinel, body: Buffer.from(sentinel) },
                ...requestLedgerAttachments
              ]
            : []
      }
    )
  }
  await reporter.onEnd({ status: 'passed' })
  const raw = await readFile(path.join(directory, 'phase10-real.json'), 'utf8')
  const value = JSON.parse(raw)

  assert.equal(raw.includes(sentinel), false)
  assert.equal(raw.includes('#token='), false)
  assert.match(value.tests[0].testId, /^[0-9a-f]{64}$/u)
  assert.deepEqual(
    value.requestLedgers.map(({ label }) => label),
    [
      'phase10-guest-auth-real-request-ledger',
      'phase10-resilience-real-request-ledger',
      'phase10-user-journey-real-request-ledger'
    ]
  )
  assert.deepEqual(value.counts, {
    passed: 3,
    failed: 0,
    skipped: 0,
    timedOut: 0,
    interrupted: 0,
    total: 3
  })
  const manifest = await verifyArtifactDirectory({
    directory,
    profile: 'playwright',
    requiredLabels: ['phase10-real']
  })
  assert.equal(manifest.files.length, 1)

  value.tests.pop()
  value.counts.passed -= 1
  value.counts.total -= 1
  await writeCanonicalEvidence({
    filePath: path.join(directory, 'phase10-real.json'),
    value
  })
  await assert.rejects(() =>
    verifyArtifactDirectory({
      directory,
      profile: 'playwright',
      requiredLabels: ['phase10-real']
    })
  )
})

test('Phase 9 evidence rejects a partial all-passing suite', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'phase9-reporter-'))
  const filePath = path.join(directory, 'phase9-real.json')
  const value = {
    schemaVersion: 2,
    kind: 'nihongo.playwright-safe-summary',
    label: 'phase9-real',
    status: 'passed',
    durationMs: 1,
    counts: {
      passed: 3,
      failed: 0,
      skipped: 0,
      timedOut: 0,
      interrupted: 0,
      total: 3
    },
    performanceMeasurements: [],
    requestLedgers: [],
    tests: Array.from({ length: 3 }, (_, index) => ({
      testId: String(index + 1).repeat(64),
      status: 'passed',
      durationMs: 1,
      retry: 0
    }))
  }
  await writeCanonicalEvidence({ filePath, value })
  await assert.doesNotReject(() =>
    verifyArtifactDirectory({
      directory,
      profile: 'playwright',
      requiredLabels: ['phase9-real']
    })
  )

  value.tests.pop()
  value.counts.passed -= 1
  value.counts.total -= 1
  await writeCanonicalEvidence({ filePath, value })
  await assert.rejects(() =>
    verifyArtifactDirectory({
      directory,
      profile: 'playwright',
      requiredLabels: ['phase9-real']
    })
  )
})

test('Phase 8 reporter retains exact ledger and performance evidence', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'phase8-reporter-'))
  const reporter = new Phase10PlaywrightSummaryReporter({
    outputDirectory: directory,
    label: 'phase8-real'
  })
  reporter.onBegin()
  for (let index = 0; index < 5; index += 1) {
    reporter.onTestEnd(
      {
        location: { file: `/private/spec-${index}.ts`, line: index + 1 },
        titlePath: () => ['phase8', `test-${index}`]
      },
      {
        status: 'passed',
        duration: 10,
        retry: 0,
        attachments:
          index === 0
            ? [
                createRequestLedgerAttachment(
                  'phase8-admin-lifecycle-real-request-ledger'
                ),
                createRequestLedgerAttachment(
                  'phase8-dashboard-real-request-ledger'
                ),
                createPerformanceAttachment('real')
              ]
            : []
      }
    )
  }
  await reporter.onEnd({ status: 'passed' })

  const value = JSON.parse(
    await readFile(path.join(directory, 'phase8-real.json'), 'utf8')
  )
  assert.equal(value.schemaVersion, 2)
  assert.equal(value.tests.length, 5)
  assert.deepEqual(
    value.requestLedgers.map(({ label }) => label),
    [
      'phase8-admin-lifecycle-real-request-ledger',
      'phase8-dashboard-real-request-ledger'
    ]
  )
  assert.deepEqual(
    value.performanceMeasurements.map(({ label }) => label),
    ['phase8-dashboard-real-performance']
  )
  const manifest = await verifyArtifactDirectory({
    directory,
    profile: 'playwright',
    requiredLabels: ['phase8-real']
  })
  assert.equal(manifest.files.length, 1)
})

test('browser performance and request ledger evidence fail closed on forgery', () => {
  for (const mode of ['mock', 'real']) {
    const measurement = createPerformanceMeasurement(mode)
    assert.doesNotThrow(() =>
      assertPlaywrightPerformanceMeasurement(measurement, `phase8-${mode}`)
    )
    for (const mutate of [
      (candidate) => candidate.samplesMs.pop(),
      (candidate) => {
        candidate.statisticsMs.p95 += 1
      },
      (candidate) => {
        candidate.budget.baselineP95Milliseconds += 1
      },
      (candidate) => {
        candidate.budget.passed = false
      },
      (candidate) => {
        candidate.unexpected = true
      }
    ]) {
      const candidate = structuredClone(measurement)
      mutate(candidate)
      assert.throws(() =>
        assertPlaywrightPerformanceMeasurement(candidate, `phase8-${mode}`)
      )
    }
  }

  assert.throws(() =>
    assertPlaywrightRequestLedger(
      {
        label: 'phase8-dashboard-real-request-ledger',
        entries: [
          {
            finishSequence: 2,
            method: 'GET',
            path: '/api/v1/dashboard/123e4567-e89b-12d3-a456-426614174000',
            provenance: 'canonical-real-network',
            startSequence: 1,
            status: 200
          }
        ]
      },
      'phase8-real'
    )
  )

  const dashboardLedger = {
    label: 'phase8-dashboard-real-request-ledger',
    entries: createRequestLedgerEntries(
      'phase8-dashboard-real-request-ledger',
      '/api/v1/dashboard'
    )
  }
  assert.doesNotThrow(() =>
    assertPlaywrightRequestLedger(dashboardLedger, 'phase8-real')
  )
  const duplicateDashboardLedger = structuredClone(dashboardLedger)
  duplicateDashboardLedger.entries.push({
    ...duplicateDashboardLedger.entries.at(-1),
    finishSequence: 86,
    path: '/api/v1/dashboard',
    startSequence: 85
  })
  assert.throws(() =>
    assertPlaywrightRequestLedger(duplicateDashboardLedger, 'phase8-real')
  )

  assert.throws(() =>
    assertPlaywrightRequestLedger(
      {
        label: 'phase10-user-journey-real-request-ledger',
        entries: [
          {
            finishSequence: 2,
            method: 'GET',
            path: '/api/v1/study-sessions/018f6b7a-1f4b-7d5e-8a9b-123456789abc',
            provenance: 'canonical-real-network',
            startSequence: 1,
            status: 200
          }
        ]
      },
      'phase10-real'
    )
  )

  const adminLedger = {
    label: 'phase8-admin-lifecycle-real-request-ledger',
    entries: createRequestLedgerEntries(
      'phase8-admin-lifecycle-real-request-ledger',
      '/api/v1/me'
    )
  }
  assert.doesNotThrow(() =>
    assertPlaywrightRequestLedger(adminLedger, 'phase8-real')
  )
  const forgedAdminStatus = structuredClone(adminLedger)
  forgedAdminStatus.entries[0].status = 500
  assert.throws(() =>
    assertPlaywrightRequestLedger(forgedAdminStatus, 'phase8-real')
  )
  const forgedAdminOrder = structuredClone(adminLedger)
  const firstEntry = forgedAdminOrder.entries[0]
  forgedAdminOrder.entries[0] = forgedAdminOrder.entries[1]
  forgedAdminOrder.entries[1] = firstEntry
  assert.throws(() =>
    assertPlaywrightRequestLedger(forgedAdminOrder, 'phase8-real')
  )
  const userJourneyLedger = {
    label: 'phase10-user-journey-real-request-ledger',
    entries: createRequestLedgerEntries(
      'phase10-user-journey-real-request-ledger',
      '/api/v1/me'
    )
  }
  assert.doesNotThrow(() =>
    assertPlaywrightRequestLedger(userJourneyLedger, 'phase10-real')
  )
  for (const forbiddenField of ['bodyDigest', 'idempotencyKeyDigest']) {
    const forgedDigest = structuredClone(userJourneyLedger)
    forgedDigest.entries[0][forbiddenField] = 'a'.repeat(64)
    assert.throws(
      () => assertPlaywrightRequestLedger(forgedDigest, 'phase10-real'),
      /SECURITY_EVIDENCE_LEDGER_ENTRY_SHAPE_INVALID/u
    )
  }
})

test('Playwright evidence rejects empty and skipped-only summaries', async () => {
  for (const [name, tests, counts] of [
    [
      'empty',
      [],
      {
        passed: 0,
        failed: 0,
        skipped: 0,
        timedOut: 0,
        interrupted: 0,
        total: 0
      }
    ],
    [
      'skipped',
      [
        {
          testId: 'b'.repeat(64),
          status: 'skipped',
          durationMs: 0,
          retry: 0
        }
      ],
      {
        passed: 0,
        failed: 0,
        skipped: 1,
        timedOut: 0,
        interrupted: 0,
        total: 1
      }
    ]
  ]) {
    const directory = await mkdtemp(
      path.join(tmpdir(), `phase10-${name}-evidence-`)
    )
    await writeCanonicalEvidence({
      filePath: path.join(directory, 'phase8-real.json'),
      value: {
        schemaVersion: 2,
        kind: 'nihongo.playwright-safe-summary',
        label: 'phase8-real',
        status: 'passed',
        durationMs: 0,
        counts,
        performanceMeasurements: [],
        requestLedgers: [],
        tests
      }
    })
    await assert.rejects(() =>
      verifyArtifactDirectory({
        directory,
        profile: 'playwright',
        requiredLabels: ['phase8-real']
      })
    )
  }
})

test('artifact verifier accepts only complete closed-schema security JSON', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'phase10-evidence-'))
  const lockfileSha256 = 'a'.repeat(64)
  await writeCanonicalEvidence({
    filePath: path.join(directory, 'tracked-source-security.json'),
    value: {
      schemaVersion: 1,
      kind: 'nihongo.tracked-source-security',
      status: 'passed',
      scannedFileCount: 10,
      activeSecretFindings: [],
      suppressedSecretFindingCount: 0,
      unusedAllowlistEntryCount: 0,
      unsafeHtmlFindings: []
    }
  })
  for (const scope of ['production', 'development']) {
    await writeCanonicalEvidence({
      filePath: path.join(directory, `dependency-${scope}.json`),
      value: {
        schemaVersion: 1,
        kind: 'nihongo.dependency-audit',
        scope,
        status: 'passed',
        lockfileSha256,
        severityCounts: {
          critical: 0,
          high: 0,
          moderate: 0,
          low: 0,
          info: 0,
          unknown: 0
        },
        findings: [],
        appliedDispositionCount: 0
      }
    })
  }
  const manifest = await verifyArtifactDirectory({
    directory,
    profile: 'security'
  })
  assert.equal(manifest.files.length, 3)
  assert.equal(
    JSON.parse(await readFile(path.join(directory, 'artifact-manifest.json')))
      .profile,
    'security'
  )

  const unsafeDirectory = await mkdtemp(
    path.join(tmpdir(), 'phase10-unsafe-evidence-')
  )
  await writeFile(path.join(unsafeDirectory, 'unknown.json'), '{}')
  await assert.rejects(() =>
    verifyArtifactDirectory({
      directory: unsafeDirectory,
      profile: 'security'
    })
  )
  await symlink(
    path.join(directory, 'tracked-source-security.json'),
    path.join(unsafeDirectory, 'linked.json')
  )
  await assert.rejects(() =>
    verifyArtifactDirectory({
      directory: unsafeDirectory,
      profile: 'security'
    })
  )
})

test('workflow artifact policy rejects raw/broad Playwright paths and permits exact safe evidence', () => {
  assert.throws(() =>
    assertWorkflowArtifactPolicy('path: playwright-report/phase9-real/')
  )
  assert.throws(() => assertWorkflowArtifactPolicy('path: test-results/'))
  assert.throws(() =>
    assertWorkflowArtifactPolicy(`
      - name: Upload raw Playwright output
        uses: actions/upload-artifact@v4
        with:
          path: test-results/phase10-raw/

      - name: Upload safe Playwright evidence
        uses: actions/upload-artifact@v4
        with:
          path: test-results/phase10-evidence/playwright/
    `)
  )
  assert.throws(() =>
    assertWorkflowArtifactPolicy(`
      - name: Upload Phase 9 diagnostics
        uses: actions/upload-artifact@v4
        with:
          path: test-results/playwright-phase9-real/

      - name: Upload safe Playwright evidence
        uses: actions/upload-artifact@v4
        with:
          path: test-results/phase10-evidence/playwright/
    `)
  )
  assert.doesNotThrow(() =>
    assertWorkflowArtifactPolicy(`
      - name: Clean Phase 9 diagnostics
        if: \${{ always() }}
        run: rm -rf -- test-results/playwright-phase9-real

      - name: Upload safe Playwright evidence
        uses: actions/upload-artifact@v4
        with:
          path: test-results/phase10-evidence/playwright/
    `)
  )
  assert.doesNotThrow(() =>
    assertWorkflowArtifactPolicy(
      'path: test-results/phase10-evidence/playwright/'
    )
  )
})
