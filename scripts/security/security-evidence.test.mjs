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
  const sentinel = 'reporter-secret-sentinel'
  const reporter = new Phase10PlaywrightSummaryReporter({
    outputDirectory: directory,
    label: 'phase10-real'
  })
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
      error: new Error(sentinel),
      stdout: [sentinel],
      attachments: [{ name: sentinel, body: Buffer.from(sentinel) }]
    }
  )
  await reporter.onEnd({ status: 'passed' })
  const raw = await readFile(path.join(directory, 'phase10-real.json'), 'utf8')
  const value = JSON.parse(raw)

  assert.equal(raw.includes(sentinel), false)
  assert.match(value.tests[0].testId, /^[0-9a-f]{64}$/u)
  assert.deepEqual(value.counts, {
    passed: 1,
    failed: 0,
    skipped: 0,
    timedOut: 0,
    interrupted: 0,
    total: 1
  })
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
  assert.doesNotThrow(() =>
    assertWorkflowArtifactPolicy(
      'path: test-results/phase10-evidence/playwright/'
    )
  )
})
