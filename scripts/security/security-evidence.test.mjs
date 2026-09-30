import assert from 'node:assert/strict'
import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Phase10PlaywrightSummaryReporter from './phase10-playwright-summary-reporter.mjs'
import {
  assertEvidenceValueSafe,
  assertWorkflowArtifactPolicy,
  canonicalizeEvidence,
  verifyArtifactDirectory,
  writeCanonicalEvidence
} from './security-evidence.mjs'

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
  ].map((journey) => ({
    name: `phase10-${journey}-real-request-ledger`,
    contentType: 'application/json',
    body: Buffer.from(
      JSON.stringify({
        entries: [
          {
            finishSequence: 2,
            method: 'GET',
            path: '/api/v1/me',
            provenance: 'canonical-real-network',
            startSequence: 1,
            status: 200
          }
        ]
      }),
      'utf8'
    )
  }))
  reporter.onBegin()
  reporter.onTestEnd(
    {
      location: { file: `/private/${sentinel}/spec.ts`, line: 12 },
      titlePath: () => ['suite', sentinel]
    },
    {
      status: 'passed',
      duration: 10,
      retry: 0,
      error: new Error(`/verify-email#token=${sentinel}`),
      stdout: [`#token=${sentinel}`],
      attachments: [
        { name: sentinel, body: Buffer.from(sentinel) },
        ...requestLedgerAttachments
      ]
    }
  )
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
    passed: 1,
    failed: 0,
    skipped: 0,
    timedOut: 0,
    interrupted: 0,
    total: 1
  })
  const manifest = await verifyArtifactDirectory({
    directory,
    profile: 'playwright',
    requiredLabels: ['phase10-real']
  })
  assert.equal(manifest.files.length, 1)
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
        schemaVersion: 1,
        kind: 'nihongo.playwright-safe-summary',
        label: 'phase8-real',
        status: 'passed',
        durationMs: 0,
        counts,
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
  assert.doesNotThrow(() =>
    assertWorkflowArtifactPolicy(
      'path: test-results/phase10-evidence/playwright/'
    )
  )
})
