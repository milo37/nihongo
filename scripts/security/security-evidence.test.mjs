import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
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

const createCurrentCmsEntries = () =>
  [
    ['POST', '/api/auth/sign-in/social', 200],
    ['GET', '/api/auth/callback/google', 303],
    ['GET', '/api/v1/me', 200],
    ['GET', '/api/v1/admin/questions', 200],
    ['POST', '/api/v1/admin/questions', 201],
    ['GET', '/api/v1/admin/questions/:id', 200],
    ['GET', '/api/v1/admin/question-versions/:id/preview', 200],
    ['PATCH', '/api/v1/admin/question-versions/:id', 200],
    ['PATCH', '/api/v1/admin/question-versions/:id', 409],
    ['GET', '/api/v1/admin/questions/:id', 200],
    ['POST', '/api/v1/admin/questions/:id/archive', 401],
    ['GET', '/api/v1/me', 200],
    ['POST', '/api/auth/sign-in/social', 200],
    ['GET', '/api/auth/callback/google', 303],
    ['GET', '/api/auth/sso/admin-fresh/complete', 303],
    ['GET', '/api/v1/me', 200],
    ['GET', '/api/v1/admin/questions', 200],
    ['POST', '/api/v1/admin/questions/:id/archive', 200],
    ['GET', '/api/v1/admin/questions/:id', 200]
  ].map(([method, path, status], index) => ({
    method,
    path,
    status,
    provenance: 'canonical-real-network',
    startSequence: index === 8 ? 16 : index * 2 + 1,
    finishSequence: index === 7 ? 17 : index === 8 ? 18 : index * 2 + 2
  }))

const createRequestLedgerEntries = (name, pathName) => {
  const provenance = name.includes('-mock-')
    ? 'canonical-mock-service-worker'
    : 'canonical-real-network'
  if (name === 'phase7-a1-a8-real-request-ledger')
    return createCurrentCmsEntries()
  if (name === 'phase7-guest-denial' || name === 'phase7-user-denial')
    return [
      {
        method: 'GET',
        path: '/api/v1/admin/questions',
        status: name === 'phase7-guest-denial' ? 401 : 403,
        provenance: 'canonical-real-network',
        startSequence: 1,
        finishSequence: 2
      }
    ]
  if (name.startsWith('phase8-dashboard-')) {
    return Array.from({ length: 21 }, (_, triggerIndex) => {
      const sequence = triggerIndex * 4
      return [
        {
          finishSequence: sequence + 2,
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
          startSequence: sequence + 3,
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

  if (/^phase10-(?:real|mock)-(?:ko|ja)-handoff$/u.test(name)) {
    const mock = name.startsWith('phase10-mock-')
    const operations = [
      ['GET', '/api/v1/me', 200],
      ['POST', '/api/auth/sign-in/social', 200],
      mock
        ? ['POST', '/api/_mock/auth/social/callback', 200]
        : ['GET', '/api/auth/callback/google', 303],
      ['GET', '/api/v1/me', 200],
      ['GET', '/api/v1/questions', 200]
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

const createPhase10AttachmentNames = (mode) => [
  'phase10-' + mode + '-ko-handoff',
  'phase10-' + mode + '-ja-handoff',
  'phase10-guest-auth-' + mode + '-request-ledger',
  'phase10-user-journey-' + mode + '-request-ledger',
  'phase10-resilience-' + mode + '-request-ledger'
]
const createPhase10Attachments = (mode) =>
  createPhase10AttachmentNames(mode).map((name) =>
    createRequestLedgerAttachment(name)
  )

const createCurrentPhase8Attachments = (mode, index) => {
  if (mode === 'real' && index === 0)
    return [
      createRequestLedgerAttachment('phase7-guest-denial'),
      createRequestLedgerAttachment('phase7-user-denial')
    ]
  if (mode === 'real' && index === 1)
    return [createRequestLedgerAttachment('phase7-a1-a8-real-request-ledger')]
  return [
    createRequestLedgerAttachment(`phase8-dashboard-${mode}-request-ledger`),
    createPerformanceAttachment(mode)
  ]
}

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
  const requestLedgerAttachments = createPhase10Attachments('real')
  reporter.onBegin()
  for (let index = 0; index < 5; index += 1) {
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
    createPhase10AttachmentNames('real').toSorted()
  )
  assert.deepEqual(value.counts, {
    passed: 5,
    failed: 0,
    skipped: 0,
    timedOut: 0,
    interrupted: 0,
    total: 5
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

for (const mode of ['real', 'mock']) {
  test(`Phase 9 ${mode} evidence accepts four tests and rejects unsafe suites`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'phase9-count-'))
    const label = `phase9-${mode}`
    const filePath = path.join(directory, `${label}.json`)
    const makeSummary = (count) => ({
      schemaVersion: 2,
      kind: 'nihongo.playwright-safe-summary',
      label,
      status: 'passed',
      durationMs: 1,
      counts: {
        passed: count,
        failed: 0,
        skipped: 0,
        timedOut: 0,
        interrupted: 0,
        total: count
      },
      performanceMeasurements: [],
      requestLedgers: [],
      tests: Array.from({ length: count }, (_, index) => ({
        testId: String(index + 1).repeat(64),
        status: 'passed',
        durationMs: 1,
        retry: 0
      }))
    })
    const verify = async (value) => {
      await writeCanonicalEvidence({ filePath, value })
      return verifyArtifactDirectory({
        directory,
        profile: 'playwright',
        requiredLabels: [label]
      })
    }
    await assert.doesNotReject(() => verify(makeSummary(4)))
    for (const count of [3, 5]) {
      await assert.rejects(
        () => verify(makeSummary(count)),
        /SECURITY_EVIDENCE_SCHEMA_INVALID/
      )
    }
    const skipped = makeSummary(4)
    skipped.tests[0].status = 'skipped'
    skipped.counts.passed = 3
    skipped.counts.skipped = 1
    await assert.rejects(
      () => verify(skipped),
      /SECURITY_EVIDENCE_SCHEMA_INVALID/
    )
    const retried = makeSummary(4)
    retried.tests[0].retry = 1
    await assert.rejects(
      () => verify(retried),
      /SECURITY_EVIDENCE_SCHEMA_INVALID/
    )
    const extra = makeSummary(4)
    extra.rawColor = 'black'
    await assert.rejects(
      () => verify(extra),
      /SECURITY_EVIDENCE_SCHEMA_INVALID/
    )
    await assert.rejects(
      () =>
        verify(makeSummary(4)).then(() =>
          verifyArtifactDirectory({
            directory,
            profile: 'playwright',
            requiredLabels: [label],
            additionalSecrets: [makeSummary(4).tests[0].testId]
          })
        ),
      /SECURITY_EVIDENCE_ENVIRONMENT_SECRET/
    )
  })
}

test('all six safe suites retain exact current counts and approved attachments', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'six-safe-suites-'))
  const labels = []
  for (const mode of ['real', 'mock']) {
    for (const [phase, count] of [
      [8, mode === 'real' ? 3 : 1],
      [9, 4],
      [10, 5]
    ]) {
      const label = `phase${phase}-${mode}`
      labels.push(label)
      const reporter = new Phase10PlaywrightSummaryReporter({
        outputDirectory: directory,
        label
      })
      const attachments = phase === 10 ? createPhase10Attachments(mode) : []
      reporter.onBegin()
      for (let index = 0; index < count; index += 1) {
        reporter.onTestEnd(
          {
            location: { file: '/private/safe-suite.ts', line: index + 1 },
            titlePath: () => [label, `test-${index}`]
          },
          {
            status: 'passed',
            duration: 1,
            retry: 0,
            attachments:
              phase === 8
                ? createCurrentPhase8Attachments(mode, index)
                : index === 0
                  ? attachments
                  : []
          }
        )
      }
      await reporter.onEnd({ status: 'passed' })
    }
  }
  const manifest = await verifyArtifactDirectory({
    directory,
    profile: 'playwright',
    requiredLabels: labels
  })
  assert.equal(manifest.files.length, 6)
})

test('Phase 8 reporter retains exact ledger and performance evidence', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'phase8-reporter-'))
  const reporter = new Phase10PlaywrightSummaryReporter({
    outputDirectory: directory,
    label: 'phase8-real'
  })
  reporter.onBegin()
  for (let index = 0; index < 3; index += 1) {
    reporter.onTestEnd(
      {
        location: { file: `/private/spec-${index}.ts`, line: index + 1 },
        titlePath: () => ['phase8', `test-${index}`]
      },
      {
        status: 'passed',
        duration: 10,
        retry: 0,
        attachments: createCurrentPhase8Attachments('real', index)
      }
    )
  }
  await reporter.onEnd({ status: 'passed' })

  const value = JSON.parse(
    await readFile(path.join(directory, 'phase8-real.json'), 'utf8')
  )
  assert.equal(value.schemaVersion, 2)
  assert.equal(value.tests.length, 3)
  assert.deepEqual(
    value.requestLedgers.map(({ label }) => label),
    [
      'phase7-a1-a8-real-request-ledger',
      'phase7-guest-denial',
      'phase7-user-denial',
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

test('current A1-A8 evidence rejects forged commands, denials, provenance and races', () => {
  const valid = {
    label: 'phase7-a1-a8-real-request-ledger',
    entries: createCurrentCmsEntries()
  }
  assert.doesNotThrow(() => assertPlaywrightRequestLedger(valid, 'phase8-real'))
  const otherWinner = structuredClone(valid)
  otherWinner.entries[7].status = 409
  otherWinner.entries[8].status = 200
  assert.doesNotThrow(() =>
    assertPlaywrightRequestLedger(otherWinner, 'phase8-real')
  )
  assert.throws(() => assertPlaywrightRequestLedger(valid, 'phase8-mock'))
  for (const [name, mutate] of [
    ['missing creation', (entries) => entries.splice(4, 1)],
    [
      'duplicated archive',
      (entries) =>
        entries.push({ ...entries[17], startSequence: 39, finishSequence: 40 })
    ],
    [
      'wrong provenance',
      (entries) => {
        entries[4].provenance = 'canonical-mock-service-worker'
      }
    ],
    [
      'failed read',
      (entries) => {
        entries[5].status = 503
      }
    ],
    [
      'forged creation',
      (entries) => {
        entries[4].status = 200
      }
    ],
    [
      'no PATCH loser',
      (entries) => {
        entries[8].status = 200
      }
    ],
    [
      'unasserted PATCH 412',
      (entries) => {
        entries[8].status = 412
      }
    ],
    [
      'unasserted archive 412',
      (entries) => {
        entries[17].status = 412
      }
    ],
    [
      'archive without fresh denial',
      (entries) => {
        entries[10].status = 200
      }
    ],
    [
      'serialized PATCH race',
      (entries) => {
        entries[7].finishSequence = 16
        entries[8].startSequence = 17
      }
    ],
    ['missing fresh completion', (entries) => entries.splice(14, 1)],
    [
      'fresh completion after archive',
      (entries) => {
        entries[14].startSequence = 35
        entries[14].finishSequence = 36
        entries[17].startSequence = 29
        entries[17].finishSequence = 30
      }
    ],
    [
      'duplicate sign-in',
      (entries) =>
        entries.push({ ...entries[0], startSequence: 39, finishSequence: 40 })
    ],
    ['missing preview', (entries) => entries.splice(6, 1)]
  ]) {
    const candidate = structuredClone(valid)
    mutate(candidate.entries)
    assert.throws(
      () => assertPlaywrightRequestLedger(candidate, 'phase8-real'),
      /SECURITY_EVIDENCE_/u,
      name
    )
  }
  for (const [label, status] of [
    ['phase7-guest-denial', 401],
    ['phase7-user-denial', 403]
  ]) {
    const denied = {
      label,
      entries: [
        {
          method: 'GET',
          path: '/api/v1/admin/questions',
          status,
          provenance: 'canonical-real-network',
          startSequence: 1,
          finishSequence: 2
        }
      ]
    }
    assert.doesNotThrow(() =>
      assertPlaywrightRequestLedger(denied, 'phase8-real')
    )
    for (const mutate of [
      (entry) => {
        entry.status = 200
      },
      (entry) => {
        entry.provenance = 'canonical-mock-service-worker'
      },
      (entry) => {
        entry.method = 'POST'
      },
      (entry) => {
        entry.path = '/api/v1/me'
      }
    ]) {
      const candidate = structuredClone(denied)
      mutate(candidate.entries[0])
      assert.throws(() =>
        assertPlaywrightRequestLedger(candidate, 'phase8-real')
      )
    }
  }
})

test('current Phase 8 summaries reject missing, duplicate, forged and obsolete evidence', async () => {
  for (const mode of ['real', 'mock']) {
    const label = `phase8-${mode}`
    const directory = await mkdtemp(
      path.join(tmpdir(), 'phase8-current-summary-')
    )
    const reporter = new Phase10PlaywrightSummaryReporter({
      outputDirectory: directory,
      label
    })
    const count = mode === 'real' ? 3 : 1
    reporter.onBegin()
    for (let index = 0; index < count; index += 1) {
      reporter.onTestEnd(
        {
          location: { file: '/private/current-spec.ts', line: index + 1 },
          titlePath: () => [label, String(index)]
        },
        {
          status: 'passed',
          duration: 1,
          retry: 0,
          attachments: createCurrentPhase8Attachments(mode, index)
        }
      )
    }
    await reporter.onEnd({ status: 'passed' })
    const filePath = path.join(directory, `${label}.json`)
    const valid = JSON.parse(await readFile(filePath, 'utf8'))
    await assert.doesNotReject(() =>
      verifyArtifactDirectory({
        directory,
        profile: 'playwright',
        requiredLabels: [label]
      })
    )
    const verify = async (value) => {
      await writeCanonicalEvidence({ filePath, value })
      return verifyArtifactDirectory({
        directory,
        profile: 'playwright',
        requiredLabels: [label]
      })
    }
    for (const [name, mutate] of [
      ['missing ledger', (candidate) => candidate.requestLedgers.pop()],
      [
        'duplicate ledger',
        (candidate) =>
          candidate.requestLedgers.push(
            structuredClone(candidate.requestLedgers[0])
          )
      ],
      [
        'forged provenance',
        (candidate) => {
          candidate.requestLedgers[0].entries[0].provenance =
            'injected-test-fault'
        }
      ],
      [
        'forged status',
        (candidate) => {
          candidate.requestLedgers[0].entries[0].status = 500
        }
      ],
      [
        'old test count',
        (candidate) => {
          candidate.tests = Array.from({ length: 5 }, (_, index) => ({
            ...candidate.tests[0],
            testId: index.toString(16).padStart(64, '0')
          }))
          candidate.counts.passed = 5
          candidate.counts.total = 5
        }
      ],
      [
        'missing test',
        (candidate) => {
          candidate.tests.pop()
          candidate.counts.passed -= 1
          candidate.counts.total -= 1
        }
      ],
      [
        'retry',
        (candidate) => {
          candidate.tests[0].retry = 1
        }
      ]
    ]) {
      const candidate = structuredClone(valid)
      mutate(candidate)
      await assert.rejects(
        () => verify(candidate),
        /SECURITY_EVIDENCE_/u,
        `${mode}: ${name}`
      )
    }
  }
})

test('Phase 8 dashboard ledgers require ordered sequential user journeys', () => {
  for (const mode of ['real', 'mock']) {
    const label = `phase8-dashboard-${mode}-request-ledger`
    const valid = {
      label,
      entries: createRequestLedgerEntries(label, '/api/v1/dashboard')
    }
    assert.doesNotThrow(() =>
      assertPlaywrightRequestLedger(valid, `phase8-${mode}`)
    )
    for (const [name, mutate] of [
      [
        'reversed reads',
        (entries) => entries.splice(0, 2, entries[1], entries[0])
      ],
      ['missing read', (entries) => entries.pop()],
      [
        'extra read',
        (entries) =>
          entries.push({
            ...entries.at(-1),
            startSequence: 85,
            finishSequence: 86
          })
      ],
      [
        'duplicated read kind',
        (entries) => {
          entries[1].path = '/api/v1/dashboard'
        }
      ],
      [
        'wrong provenance',
        (entries) => {
          entries[0].provenance =
            mode === 'real'
              ? 'canonical-mock-service-worker'
              : 'canonical-real-network'
        }
      ],
      [
        'unsuccessful read',
        (entries) => {
          entries[0].status = 503
        }
      ],
      [
        'unexpected method',
        (entries) => {
          entries[0].method = 'POST'
        }
      ],
      [
        'overlapping reads',
        (entries) => {
          entries[0].finishSequence = 3
          entries[1].startSequence = 2
        }
      ],
      [
        'overlapping journeys',
        (entries) => {
          entries[1].finishSequence = 5
          entries[2].startSequence = 4
        }
      ]
    ]) {
      const candidate = structuredClone(valid)
      mutate(candidate.entries)
      assert.throws(
        () => assertPlaywrightRequestLedger(candidate, `phase8-${mode}`),
        /SECURITY_EVIDENCE_/u,
        `${mode}: ${name}`
      )
    }
  }
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

for (const mode of ['real', 'mock']) {
  test(
    'Phase 10 ' +
      mode +
      ' requires all five tests and exact five source ledgers',
    async () => {
      const directory = await mkdtemp(path.join(tmpdir(), 'phase10-five-'))
      const label = 'phase10-' + mode
      const makeSummary = (count = 5) => ({
        schemaVersion: 2,
        kind: 'nihongo.playwright-safe-summary',
        label,
        status: 'passed',
        durationMs: 1,
        counts: {
          passed: count,
          failed: 0,
          skipped: 0,
          timedOut: 0,
          interrupted: 0,
          total: count
        },
        performanceMeasurements: [],
        requestLedgers: createPhase10Attachments(mode).map(
          ({ name, body }) => ({
            label: name,
            ...JSON.parse(body.toString('utf8'))
          })
        ),
        tests: Array.from({ length: count }, (_, index) => ({
          testId: String(index + 1).repeat(64),
          status: 'passed',
          durationMs: 1,
          retry: 0
        }))
      })
      const verify = async (value) => {
        await writeCanonicalEvidence({
          filePath: path.join(directory, label + '.json'),
          value
        })
        return await verifyArtifactDirectory({
          directory,
          profile: 'playwright',
          requiredLabels: [label]
        })
      }
      try {
        await assert.doesNotReject(() => verify(makeSummary()))
        for (const count of [0, 2, 3, 4, 6]) {
          await assert.rejects(
            () => verify(makeSummary(count)),
            /SECURITY_EVIDENCE_SCHEMA_INVALID/u
          )
        }
        for (const status of ['failed', 'skipped', 'timedOut', 'interrupted']) {
          const value = makeSummary()
          value.tests[0].status = status
          value.counts.passed -= 1
          value.counts[status] += 1
          await assert.rejects(
            () => verify(value),
            /SECURITY_EVIDENCE_SCHEMA_INVALID/u
          )
        }
        for (const mutate of [
          (value) => {
            value.status = 'failed'
          },
          (value) => {
            value.tests[0].retry = 1
          },
          (value) => {
            value.tests[0].testId = value.tests[1].testId
          },
          (value) => {
            value.requestLedgers.push(structuredClone(value.requestLedgers[0]))
          },
          (value) => {
            value.requestLedgers[0].label = 'phase10-' + mode + '-other-handoff'
          },
          (value) => {
            value.requestLedgers[0].label =
              'phase10-' + (mode === 'real' ? 'mock' : 'real') + '-ko-handoff'
          },
          (value) => {
            value.requestLedgers[0].entries[0].bodyDigest = 'a'.repeat(64)
          },
          (value) => {
            value.requestLedgers[0].entries[0].idempotencyKeyDigest =
              'a'.repeat(64)
          },
          (value) => {
            value.requestLedgers[0].entries[0].requestBody = 'private-token'
          },
          (value) => {
            value.extra = 'private-token'
          }
        ]) {
          const value = makeSummary()
          mutate(value)
          await assert.rejects(() => verify(value), /SECURITY_EVIDENCE_/u)
        }
        for (let index = 0; index < 5; index += 1) {
          const value = makeSummary()
          value.requestLedgers.splice(index, 1)
          await assert.rejects(
            () => verify(value),
            /SECURITY_EVIDENCE_SCHEMA_INVALID/u
          )
        }
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    }
  )
}

test('both handoff sources reject missing, duplicated, forged and noncanonical requests', () => {
  for (const mode of ['real', 'mock']) {
    for (const locale of ['ko', 'ja']) {
      const label = 'phase10-' + mode + '-' + locale + '-handoff'
      const valid = { label, entries: createRequestLedgerEntries(label) }
      assert.doesNotThrow(() =>
        assertPlaywrightRequestLedger(valid, 'phase10-' + mode)
      )
      for (const mutate of [
        (entries) => entries.splice(1, 1),
        (entries) => entries.splice(2, 1),
        (entries) => entries.splice(3, 1),
        (entries) => entries.splice(4, 1),
        (entries) => {
          entries[2].status = 500
        },
        (entries) => {
          entries[0].provenance = 'injected-test-fault'
        },
        (entries) => {
          entries[0].status = 'NETWORK_ERROR'
          entries[0].provenance = 'network-failure'
        },
        (entries) => {
          entries[2].method = mode === 'real' ? 'POST' : 'GET'
        },
        (entries) => {
          entries[4].path = '/api/v1/study-sessions'
        },
        (entries) => {
          entries[0].path =
            '/api/v1/study-sessions/018f6b7a-1f4b-7d5e-8a9b-123456789abc'
        },
        (entries) =>
          entries.push({ ...entries[1], startSequence: 11, finishSequence: 12 })
      ]) {
        const candidate = structuredClone(valid)
        mutate(candidate.entries)
        assert.throws(
          () => assertPlaywrightRequestLedger(candidate, 'phase10-' + mode),
          /SECURITY_EVIDENCE_/u
        )
      }
    }
  }
})

test('handoff attachment payload cannot override its source label', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'phase10-source-label-'))
  try {
    const reporter = new Phase10PlaywrightSummaryReporter({
      outputDirectory: directory,
      label: 'phase10-real'
    })
    const source = createRequestLedgerAttachment('phase10-real-ko-handoff')
    source.body = Buffer.from(
      JSON.stringify({
        label: 'phase10-real-ja-handoff',
        ...JSON.parse(source.body.toString('utf8'))
      })
    )
    reporter.onBegin()
    reporter.onTestEnd(
      {
        location: { file: '/private/spec.ts', line: 1 },
        titlePath: () => ['source']
      },
      { status: 'passed', duration: 1, retry: 0, attachments: [source] }
    )
    await assert.rejects(
      () => reporter.onEnd({ status: 'passed' }),
      /PHASE10_PLAYWRIGHT_SAFE_ATTACHMENT_INVALID/u
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
