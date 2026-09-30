import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, readdir, rename, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const SAFE_LABEL_PATTERN = /^phase(?:8|9|10)-(?:real|mock)$/u
const SAFE_LEDGER_LABEL_PATTERN =
  /^(?:phase8-(?:admin-lifecycle|dashboard)|phase10-(?:guest-auth|user-journey|resilience))-(?:real|mock)-request-ledger$/u
const SAFE_PERFORMANCE_LABEL_PATTERN =
  /^phase8-dashboard-(?:real|mock)-performance$/u
const SAFE_LEDGER_PATH_PATTERN = /^\/api\/[a-z0-9._~:/-]+$/iu
const RAW_UUID_PATH_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/iu
const SAFE_TEST_STATUS = new Set([
  'passed',
  'failed',
  'skipped',
  'timedOut',
  'interrupted'
])
const SAFE_LEDGER_METHOD = new Set(['DELETE', 'GET', 'PATCH', 'POST', 'PUT'])
const SAFE_LEDGER_PROVENANCE = new Set([
  'canonical-mock-service-worker',
  'canonical-real-network',
  'injected-test-fault',
  'network-failure'
])
const PHASE10_IDEMPOTENT_REQUESTS = new Set([
  'POST /api/v1/study-sessions/:id/submission',
  'POST /api/v1/wrong-notes/:id/review-session',
  'PUT /api/v1/study-sessions/:id/draft-answers'
])
const PLAYWRIGHT_BROWSER_PERFORMANCE_BUDGETS = {
  mock: {
    absoluteCeilingMilliseconds: 10_000,
    baselineP95Milliseconds: 952.266,
    ratioLimit: 8
  },
  real: {
    absoluteCeilingMilliseconds: 10_000,
    baselineP95Milliseconds: 875.085,
    ratioLimit: 8
  }
}
const PLAYWRIGHT_EXPECTED_TEST_COUNTS = {
  'phase8-mock': 5,
  'phase8-real': 5,
  'phase9-mock': 3,
  'phase9-real': 3,
  'phase10-mock': 3,
  'phase10-real': 3
}
const PHASE8_ADMIN_LEDGER_CONTRACT = [
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
  ['PATCH', '/api/v1/admin/question-versions/:id', null],
  ['PATCH', '/api/v1/admin/question-versions/:id', null]
]
const SENSITIVE_ENVIRONMENT_KEY =
  /(?:_SECRET|_PASSWORD|_TOKEN|DATABASE_URL|COOKIE|AUTHORIZATION|PHASE\d+_BROWSER_FIXTURE)/iu
const STRONG_SENSITIVE_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})\b/u,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/u,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/u,
  /\bsk_live_[A-Za-z0-9]{16,}\b/u,
  /\bAIza[0-9A-Za-z_-]{35}\b/u,
  /\bnpm_[A-Za-z0-9]{30,}\b/u,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/iu,
  /\bBasic\s+[A-Za-z0-9+/=]{8,}\b/iu,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/iu,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu
]

const exactKeys = (value, expected) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return (
    JSON.stringify(Object.keys(value).toSorted()) ===
    JSON.stringify([...expected].toSorted())
  )
}

export const canonicalizeEvidence = (value) => {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('SECURITY_EVIDENCE_NONFINITE')
    return value
  }
  if (Array.isArray(value)) return value.map(canonicalizeEvidence)
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .toSorted()
        .map((key) => [key, canonicalizeEvidence(value[key])])
    )
  }
  throw new Error('SECURITY_EVIDENCE_UNSUPPORTED_VALUE')
}

const collectNestedStrings = (value, output) => {
  if (typeof value === 'string') {
    if (value.length >= 8) output.add(value)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectNestedStrings(item, output))
    return
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collectNestedStrings(item, output))
  }
}

export const collectSensitiveEnvironmentValues = (environment) => {
  const values = new Set()
  for (const [key, rawValue] of Object.entries(environment)) {
    if (!SENSITIVE_ENVIRONMENT_KEY.test(key) || typeof rawValue !== 'string') {
      continue
    }
    if (rawValue.length >= 8) values.add(rawValue)
    if (/PHASE\d+_BROWSER_FIXTURE/iu.test(key)) {
      try {
        collectNestedStrings(JSON.parse(rawValue), values)
      } catch {
        // The exact raw fixture value is still checked above.
      }
    }
  }
  return [...values].toSorted()
}

export const assertEvidenceValueSafe = ({ value, additionalSecrets = [] }) => {
  const serialized = JSON.stringify(canonicalizeEvidence(value))
  if (STRONG_SENSITIVE_PATTERNS.some((pattern) => pattern.test(serialized))) {
    throw new Error('SECURITY_EVIDENCE_SENSITIVE_PATTERN')
  }
  for (const secret of additionalSecrets) {
    if (
      typeof secret === 'string' &&
      secret.length >= 8 &&
      serialized.includes(secret)
    ) {
      throw new Error('SECURITY_EVIDENCE_ENVIRONMENT_SECRET')
    }
  }
}

export const writeCanonicalEvidence = async ({ filePath, value }) => {
  const canonical = canonicalizeEvidence(value)
  const content = `${JSON.stringify(canonical, null, 2)}\n`
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${randomUUID()}.tmp`
  )
  const { writeFile } = await import('node:fs/promises')
  await writeFile(temporaryPath, content, { encoding: 'utf8', mode: 0o600 })
  await chmod(temporaryPath, 0o600)
  await rename(temporaryPath, filePath)
}

const assertFinding = (finding) => {
  if (
    !exactKeys(finding, [
      'kind',
      'ruleId',
      'path',
      'line',
      'column',
      'fingerprint'
    ]) ||
    !['SECRET', 'UNSAFE_HTML'].includes(finding.kind) ||
    typeof finding.ruleId !== 'string' ||
    typeof finding.path !== 'string' ||
    !Number.isSafeInteger(finding.line) ||
    finding.line < 1 ||
    !Number.isSafeInteger(finding.column) ||
    finding.column < 1 ||
    typeof finding.fingerprint !== 'string' ||
    !SHA256_PATTERN.test(finding.fingerprint)
  ) {
    throw new Error('SECURITY_EVIDENCE_SCHEMA_INVALID')
  }
}

const assertTrackedSourceEvidence = (value) => {
  if (
    !exactKeys(value, [
      'schemaVersion',
      'kind',
      'status',
      'scannedFileCount',
      'activeSecretFindings',
      'suppressedSecretFindingCount',
      'unusedAllowlistEntryCount',
      'unsafeHtmlFindings'
    ]) ||
    value.schemaVersion !== 1 ||
    value.kind !== 'nihongo.tracked-source-security' ||
    value.status !== 'passed' ||
    !Number.isSafeInteger(value.scannedFileCount) ||
    value.scannedFileCount < 1 ||
    !Array.isArray(value.activeSecretFindings) ||
    !Array.isArray(value.unsafeHtmlFindings) ||
    value.activeSecretFindings.length !== 0 ||
    value.unsafeHtmlFindings.length !== 0 ||
    !Number.isSafeInteger(value.suppressedSecretFindingCount) ||
    !Number.isSafeInteger(value.unusedAllowlistEntryCount) ||
    value.unusedAllowlistEntryCount !== 0
  ) {
    throw new Error('SECURITY_EVIDENCE_SCHEMA_INVALID')
  }
  value.activeSecretFindings.forEach(assertFinding)
  value.unsafeHtmlFindings.forEach(assertFinding)
}

const assertDependencyFinding = (finding) => {
  if (
    !exactKeys(finding, [
      'advisoryId',
      'package',
      'severity',
      'installedVersion',
      'dependencyPath'
    ]) ||
    !['critical', 'high', 'moderate', 'low', 'info', 'unknown'].includes(
      finding.severity
    ) ||
    ![
      finding.advisoryId,
      finding.package,
      finding.installedVersion,
      finding.dependencyPath
    ].every((item) => typeof item === 'string' && item.length > 0)
  ) {
    throw new Error('SECURITY_EVIDENCE_SCHEMA_INVALID')
  }
}

const assertDependencyEvidence = (value) => {
  if (
    !exactKeys(value, [
      'schemaVersion',
      'kind',
      'scope',
      'status',
      'lockfileSha256',
      'severityCounts',
      'findings',
      'appliedDispositionCount'
    ]) ||
    value.schemaVersion !== 1 ||
    value.kind !== 'nihongo.dependency-audit' ||
    !['production', 'development'].includes(value.scope) ||
    value.status !== 'passed' ||
    typeof value.lockfileSha256 !== 'string' ||
    !SHA256_PATTERN.test(value.lockfileSha256) ||
    !exactKeys(value.severityCounts, [
      'critical',
      'high',
      'moderate',
      'low',
      'info',
      'unknown'
    ]) ||
    !Object.values(value.severityCounts).every(
      (count) => Number.isSafeInteger(count) && count >= 0
    ) ||
    !Array.isArray(value.findings) ||
    !Number.isSafeInteger(value.appliedDispositionCount) ||
    value.appliedDispositionCount < 0
  ) {
    throw new Error('SECURITY_EVIDENCE_SCHEMA_INVALID')
  }
  value.findings.forEach(assertDependencyFinding)
}

export const assertPlaywrightRequestLedger = (ledger, summaryLabel) => {
  if (
    !exactKeys(ledger, ['label', 'entries']) ||
    typeof ledger.label !== 'string' ||
    !SAFE_LEDGER_LABEL_PATTERN.test(ledger.label) ||
    !ledger.label.includes(`-${summaryLabel.split('-').at(-1)}-`) ||
    !Array.isArray(ledger.entries) ||
    ledger.entries.length === 0
  ) {
    throw new Error('SECURITY_EVIDENCE_SCHEMA_INVALID')
  }
  const sequences = new Set()
  for (const entry of ledger.entries) {
    if (
      !exactKeys(entry, [
        'finishSequence',
        'method',
        'path',
        'provenance',
        'startSequence',
        'status'
      ])
    ) {
      throw new Error('SECURITY_EVIDENCE_LEDGER_ENTRY_SHAPE_INVALID')
    }
    if (
      typeof entry.method !== 'string' ||
      !SAFE_LEDGER_METHOD.has(entry.method)
    ) {
      throw new Error('SECURITY_EVIDENCE_LEDGER_METHOD_INVALID')
    }
    if (
      typeof entry.path !== 'string' ||
      !SAFE_LEDGER_PATH_PATTERN.test(entry.path)
    ) {
      throw new Error('SECURITY_EVIDENCE_LEDGER_PATH_INVALID')
    }
    if (RAW_UUID_PATH_PATTERN.test(entry.path)) {
      throw new Error('SECURITY_EVIDENCE_LEDGER_RAW_ID_INVALID')
    }
    if (!Number.isSafeInteger(entry.startSequence) || entry.startSequence < 1) {
      throw new Error('SECURITY_EVIDENCE_LEDGER_START_SEQUENCE_INVALID')
    }
    if (
      !Number.isSafeInteger(entry.finishSequence) ||
      entry.finishSequence <= entry.startSequence
    ) {
      throw new Error('SECURITY_EVIDENCE_LEDGER_FINISH_SEQUENCE_INVALID')
    }
    if (
      entry.status !== 'NETWORK_ERROR' &&
      (!Number.isSafeInteger(entry.status) ||
        entry.status < 100 ||
        entry.status > 599)
    ) {
      throw new Error('SECURITY_EVIDENCE_LEDGER_STATUS_INVALID')
    }
    if (
      typeof entry.provenance !== 'string' ||
      !SAFE_LEDGER_PROVENANCE.has(entry.provenance)
    ) {
      throw new Error('SECURITY_EVIDENCE_LEDGER_PROVENANCE_INVALID')
    }
    if (
      sequences.has(entry.startSequence) ||
      sequences.has(entry.finishSequence)
    ) {
      throw new Error('SECURITY_EVIDENCE_LEDGER_SEQUENCE_DUPLICATE')
    }
    sequences.add(entry.startSequence)
    sequences.add(entry.finishSequence)
  }

  const mode = summaryLabel.split('-').at(-1)
  const canonicalProvenance =
    mode === 'mock' ? 'canonical-mock-service-worker' : 'canonical-real-network'
  if (ledger.label === `phase8-admin-lifecycle-${mode}-request-ledger`) {
    if (ledger.entries.length !== PHASE8_ADMIN_LEDGER_CONTRACT.length) {
      throw new Error('SECURITY_EVIDENCE_SCHEMA_INVALID')
    }
    for (const [index, entry] of ledger.entries.entries()) {
      const [expectedMethod, expectedPath, expectedStatus] =
        PHASE8_ADMIN_LEDGER_CONTRACT[index]
      if (entry.method !== expectedMethod || entry.path !== expectedPath) {
        throw new Error('SECURITY_EVIDENCE_PHASE8_ADMIN_COMMAND_INVALID')
      }
      if (entry.provenance !== canonicalProvenance) {
        throw new Error('SECURITY_EVIDENCE_PHASE8_ADMIN_PROVENANCE_INVALID')
      }
      if (expectedStatus !== null && entry.status !== expectedStatus) {
        throw new Error('SECURITY_EVIDENCE_PHASE8_ADMIN_STATUS_INVALID')
      }
      if (
        index > 0 &&
        ledger.entries[index - 1].startSequence >= entry.startSequence
      ) {
        throw new Error('SECURITY_EVIDENCE_PHASE8_ADMIN_ORDER_INVALID')
      }
    }
    const concurrentRace = ledger.entries.slice(-2)
    if (
      JSON.stringify(concurrentRace.map(({ status }) => status).toSorted()) !==
      JSON.stringify([200, 409])
    ) {
      throw new Error('SECURITY_EVIDENCE_PHASE8_ADMIN_RACE_STATUS_INVALID')
    }
    if (
      Math.max(...concurrentRace.map(({ startSequence }) => startSequence)) >=
      Math.min(...concurrentRace.map(({ finishSequence }) => finishSequence))
    ) {
      throw new Error('SECURITY_EVIDENCE_PHASE8_ADMIN_RACE_OVERLAP_INVALID')
    }
  }
  if (ledger.label === `phase8-dashboard-${mode}-request-ledger`) {
    if (ledger.entries.length !== 42) {
      throw new Error('SECURITY_EVIDENCE_SCHEMA_INVALID')
    }
    for (let index = 0; index < ledger.entries.length; index += 2) {
      const pair = ledger.entries.slice(index, index + 2)
      const paths = pair.map(({ path: pathName }) => pathName).toSorted()
      const startSequences = pair.map(({ startSequence }) => startSequence)
      const finishSequences = pair.map(({ finishSequence }) => finishSequence)
      if (
        JSON.stringify(paths) !==
          JSON.stringify(
            ['/api/v1/dashboard', '/api/v1/dashboard/insights'].toSorted()
          ) ||
        pair.some(
          ({ method, provenance, status }) =>
            method !== 'GET' ||
            provenance !== canonicalProvenance ||
            status !== 200
        ) ||
        Math.max(...startSequences) >= Math.min(...finishSequences) ||
        (index > 0 &&
          ledger.entries[index - 1].startSequence >= pair[0].startSequence)
      ) {
        throw new Error('SECURITY_EVIDENCE_SCHEMA_INVALID')
      }
    }
  }
  if (ledger.label === `phase10-user-journey-${mode}-request-ledger`) {
    const idempotentEntries = ledger.entries.filter(({ method, path }) =>
      PHASE10_IDEMPOTENT_REQUESTS.has(`${method} ${path}`)
    )
    const expectedCounts = new Map([
      ['POST /api/v1/study-sessions/:id/submission', 2],
      ['POST /api/v1/wrong-notes/:id/review-session', 1],
      ['PUT /api/v1/study-sessions/:id/draft-answers', 6]
    ])
    if (
      idempotentEntries.length !== 9 ||
      [...expectedCounts].some(
        ([requestKey, expectedCount]) =>
          idempotentEntries.filter(
            ({ method, path }) => `${method} ${path}` === requestKey
          ).length !== expectedCount
      )
    ) {
      throw new Error('SECURITY_EVIDENCE_PHASE10_MUTATION_CONTRACT_INVALID')
    }
  }
}

const roundMilliseconds = (value) => Math.round(value * 1_000) / 1_000

const isSafeMillisecondValue = (value) =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  roundMilliseconds(value) === value

const calculateTimingStatistics = (samples) => {
  const sorted = samples.toSorted((left, right) => left - right)
  return {
    max: sorted.at(-1),
    median: roundMilliseconds((sorted[9] + sorted[10]) / 2),
    min: sorted[0],
    p95: sorted[18]
  }
}

export const assertPlaywrightPerformanceMeasurement = (
  measurement,
  summaryLabel
) => {
  if (
    !exactKeys(measurement, [
      'label',
      'schemaVersion',
      'kind',
      'surface',
      'mode',
      'warmupCount',
      'sampleCount',
      'samplesMs',
      'statisticsMs',
      'budget'
    ]) ||
    typeof measurement.label !== 'string' ||
    !SAFE_PERFORMANCE_LABEL_PATTERN.test(measurement.label) ||
    measurement.schemaVersion !== 1 ||
    measurement.kind !== 'nihongo.phase10.browser-performance' ||
    measurement.surface !== 'dashboard-navigation' ||
    !['mock', 'real'].includes(measurement.mode) ||
    measurement.label !== `phase8-dashboard-${measurement.mode}-performance` ||
    measurement.mode !== summaryLabel.split('-').at(-1) ||
    measurement.warmupCount !== 1 ||
    measurement.sampleCount !== 20 ||
    !Array.isArray(measurement.samplesMs) ||
    measurement.samplesMs.length !== measurement.sampleCount ||
    !measurement.samplesMs.every(isSafeMillisecondValue) ||
    !exactKeys(measurement.statisticsMs, ['max', 'median', 'min', 'p95']) ||
    !Object.values(measurement.statisticsMs).every(isSafeMillisecondValue) ||
    !exactKeys(measurement.budget, [
      'absoluteCeilingMilliseconds',
      'baselineP95Milliseconds',
      'effectiveCeilingMilliseconds',
      'observedToBaselineRatio',
      'passed',
      'ratioCeilingMilliseconds',
      'ratioLimit'
    ])
  ) {
    throw new Error('SECURITY_EVIDENCE_SCHEMA_INVALID')
  }

  const statistics = calculateTimingStatistics(measurement.samplesMs)
  const expectedBudget =
    PLAYWRIGHT_BROWSER_PERFORMANCE_BUDGETS[measurement.mode]
  const ratioCeilingMilliseconds = roundMilliseconds(
    expectedBudget.baselineP95Milliseconds * expectedBudget.ratioLimit
  )
  const effectiveCeilingMilliseconds = Math.min(
    ratioCeilingMilliseconds,
    expectedBudget.absoluteCeilingMilliseconds
  )
  const observedToBaselineRatio = roundMilliseconds(
    statistics.p95 / expectedBudget.baselineP95Milliseconds
  )
  const passed =
    statistics.p95 <= ratioCeilingMilliseconds &&
    statistics.p95 <= expectedBudget.absoluteCeilingMilliseconds

  if (
    JSON.stringify(measurement.statisticsMs) !== JSON.stringify(statistics) ||
    measurement.budget.absoluteCeilingMilliseconds !==
      expectedBudget.absoluteCeilingMilliseconds ||
    measurement.budget.baselineP95Milliseconds !==
      expectedBudget.baselineP95Milliseconds ||
    measurement.budget.ratioLimit !== expectedBudget.ratioLimit ||
    measurement.budget.ratioCeilingMilliseconds !== ratioCeilingMilliseconds ||
    measurement.budget.effectiveCeilingMilliseconds !==
      effectiveCeilingMilliseconds ||
    measurement.budget.observedToBaselineRatio !== observedToBaselineRatio ||
    measurement.budget.passed !== passed ||
    !passed
  ) {
    throw new Error('SECURITY_EVIDENCE_SCHEMA_INVALID')
  }
}

const assertPlaywrightEvidence = (value) => {
  if (
    !exactKeys(value, [
      'schemaVersion',
      'kind',
      'label',
      'status',
      'durationMs',
      'counts',
      'tests',
      'requestLedgers',
      'performanceMeasurements'
    ]) ||
    value.schemaVersion !== 2 ||
    value.kind !== 'nihongo.playwright-safe-summary' ||
    typeof value.label !== 'string' ||
    !SAFE_LABEL_PATTERN.test(value.label) ||
    value.status !== 'passed' ||
    !Number.isSafeInteger(value.durationMs) ||
    value.durationMs < 0 ||
    !exactKeys(value.counts, [
      'passed',
      'failed',
      'skipped',
      'timedOut',
      'interrupted',
      'total'
    ]) ||
    !Object.values(value.counts).every(
      (count) => Number.isSafeInteger(count) && count >= 0
    ) ||
    !Array.isArray(value.tests) ||
    !Array.isArray(value.requestLedgers) ||
    !Array.isArray(value.performanceMeasurements)
  ) {
    throw new Error('SECURITY_EVIDENCE_SCHEMA_INVALID')
  }
  for (const test of value.tests) {
    if (
      !exactKeys(test, ['testId', 'status', 'durationMs', 'retry']) ||
      typeof test.testId !== 'string' ||
      !SHA256_PATTERN.test(test.testId) ||
      !SAFE_TEST_STATUS.has(test.status) ||
      !Number.isSafeInteger(test.durationMs) ||
      test.durationMs < 0 ||
      !Number.isSafeInteger(test.retry) ||
      test.retry < 0
    ) {
      throw new Error('SECURITY_EVIDENCE_SCHEMA_INVALID')
    }
  }
  const calculatedCounts = {
    passed: 0,
    failed: 0,
    skipped: 0,
    timedOut: 0,
    interrupted: 0,
    total: value.tests.length
  }
  for (const test of value.tests) calculatedCounts[test.status] += 1
  const expectedTestCount = PLAYWRIGHT_EXPECTED_TEST_COUNTS[value.label]
  if (
    !Object.entries(calculatedCounts).every(
      ([status, count]) => value.counts[status] === count
    ) ||
    calculatedCounts.total === 0 ||
    calculatedCounts.passed !== calculatedCounts.total ||
    calculatedCounts.failed !== 0 ||
    calculatedCounts.skipped !== 0 ||
    calculatedCounts.timedOut !== 0 ||
    calculatedCounts.interrupted !== 0 ||
    calculatedCounts.total !== expectedTestCount ||
    new Set(value.tests.map(({ testId }) => testId)).size !==
      calculatedCounts.total ||
    value.tests.some(({ retry }) => retry !== 0)
  ) {
    throw new Error('SECURITY_EVIDENCE_SCHEMA_INVALID')
  }
  const mode = value.label.split('-').at(-1)
  const expectedLedgerLabels = value.label.startsWith('phase8-')
    ? [
        `phase8-admin-lifecycle-${mode}-request-ledger`,
        `phase8-dashboard-${mode}-request-ledger`
      ]
    : value.label.startsWith('phase10-')
      ? [
          `phase10-guest-auth-${mode}-request-ledger`,
          `phase10-resilience-${mode}-request-ledger`,
          `phase10-user-journey-${mode}-request-ledger`
        ]
      : []
  const expectedPerformanceLabels = value.label.startsWith('phase8-')
    ? [`phase8-dashboard-${mode}-performance`]
    : []
  value.requestLedgers.forEach((ledger) =>
    assertPlaywrightRequestLedger(ledger, value.label)
  )
  value.performanceMeasurements.forEach((measurement) =>
    assertPlaywrightPerformanceMeasurement(measurement, value.label)
  )
  if (
    JSON.stringify(
      value.requestLedgers.map(({ label }) => label).toSorted()
    ) !== JSON.stringify(expectedLedgerLabels.toSorted()) ||
    JSON.stringify(
      value.performanceMeasurements.map(({ label }) => label).toSorted()
    ) !== JSON.stringify(expectedPerformanceLabels.toSorted())
  ) {
    throw new Error('SECURITY_EVIDENCE_SCHEMA_INVALID')
  }
}

const assertKnownEvidenceSchema = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('SECURITY_EVIDENCE_SCHEMA_INVALID')
  }
  if (value.kind === 'nihongo.tracked-source-security') {
    assertTrackedSourceEvidence(value)
  } else if (value.kind === 'nihongo.dependency-audit') {
    assertDependencyEvidence(value)
  } else if (value.kind === 'nihongo.playwright-safe-summary') {
    assertPlaywrightEvidence(value)
  } else {
    throw new Error('SECURITY_EVIDENCE_SCHEMA_UNKNOWN')
  }
}

export const verifyArtifactDirectory = async ({
  directory,
  profile,
  additionalSecrets = [],
  requiredLabels = []
}) => {
  const entries = await readdir(directory, { withFileTypes: true })
  const inputEntries = entries.filter(
    (entry) => entry.name !== 'artifact-manifest.json'
  )
  if (inputEntries.length === 0 || inputEntries.length > 32) {
    throw new Error('SECURITY_EVIDENCE_FILE_COUNT')
  }
  let totalBytes = 0
  const manifestFiles = []
  const observedLabels = new Set()
  const observedScopes = new Set()
  let observedTrackedSource = false

  for (const entry of inputEntries.toSorted((left, right) =>
    left.name.localeCompare(right.name)
  )) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      throw new Error('SECURITY_EVIDENCE_FILE_TYPE')
    }
    const filePath = path.join(directory, entry.name)
    const fileStats = await stat(filePath)
    if (fileStats.size > 256 * 1024) {
      throw new Error('SECURITY_EVIDENCE_FILE_SIZE')
    }
    totalBytes += fileStats.size
    if (totalBytes > 2 * 1024 * 1024) {
      throw new Error('SECURITY_EVIDENCE_TOTAL_SIZE')
    }
    const raw = await readFile(filePath, 'utf8')
    let value
    try {
      value = JSON.parse(raw)
    } catch {
      throw new Error('SECURITY_EVIDENCE_JSON_INVALID')
    }
    assertKnownEvidenceSchema(value)
    assertEvidenceValueSafe({ value, additionalSecrets })
    if (value.kind === 'nihongo.playwright-safe-summary') {
      if (entry.name !== `${value.label}.json`) {
        throw new Error('SECURITY_EVIDENCE_FILENAME_MISMATCH')
      }
      observedLabels.add(value.label)
    }
    if (value.kind === 'nihongo.dependency-audit') {
      if (entry.name !== `dependency-${value.scope}.json`) {
        throw new Error('SECURITY_EVIDENCE_FILENAME_MISMATCH')
      }
      observedScopes.add(value.scope)
    }
    if (value.kind === 'nihongo.tracked-source-security') {
      if (entry.name !== 'tracked-source-security.json') {
        throw new Error('SECURITY_EVIDENCE_FILENAME_MISMATCH')
      }
      observedTrackedSource = true
    }
    manifestFiles.push({
      path: entry.name,
      bytes: fileStats.size,
      sha256: createHash('sha256').update(raw, 'utf8').digest('hex')
    })
  }

  if (
    profile === 'security' &&
    (!observedTrackedSource ||
      !observedScopes.has('production') ||
      !observedScopes.has('development') ||
      inputEntries.length !== 3)
  ) {
    throw new Error('SECURITY_EVIDENCE_INCOMPLETE')
  }
  if (profile === 'playwright') {
    const expected = [...requiredLabels].toSorted()
    if (
      expected.length === 0 ||
      JSON.stringify([...observedLabels].toSorted()) !==
        JSON.stringify(expected) ||
      inputEntries.length !== expected.length
    ) {
      throw new Error('SECURITY_EVIDENCE_INCOMPLETE')
    }
  }
  if (!['security', 'playwright'].includes(profile)) {
    throw new Error('SECURITY_EVIDENCE_PROFILE_INVALID')
  }

  const manifest = {
    schemaVersion: 1,
    kind: 'nihongo.artifact-manifest',
    profile,
    files: manifestFiles
  }
  await writeCanonicalEvidence({
    filePath: path.join(directory, 'artifact-manifest.json'),
    value: manifest
  })
  return manifest
}

export const assertWorkflowArtifactPolicy = (workflowText) => {
  const banned = [
    /playwright-report\//u,
    /^\s*path:\s*test-results\/?\s*$/gmu,
    /^\s*path:\s*[|>]\s*$[\s\S]*?^\s+(?:playwright-report|test-results)\//gmu,
    /^\s*path:.*[*?]/gmu
  ]
  if (banned.some((pattern) => pattern.test(workflowText))) {
    throw new Error('SECURITY_WORKFLOW_ARTIFACT_POLICY')
  }
  const workflowSteps = workflowText.split(/(?=^\s*-\s+(?:name|uses):)/gmu)
  const uploadsRawPlaywrightOutput = workflowSteps.some(
    (step) =>
      /uses:\s*actions\/upload-artifact@/u.test(step) &&
      (step.includes('test-results/phase10-raw') ||
        /test-results\/playwright-/u.test(step))
  )
  if (uploadsRawPlaywrightOutput) {
    throw new Error('SECURITY_WORKFLOW_ARTIFACT_POLICY')
  }
  if (!workflowText.includes('test-results/phase10-evidence/')) {
    throw new Error('SECURITY_WORKFLOW_ARTIFACT_POLICY')
  }
}

const parseCli = (argv) => {
  const [command, ...rest] = argv
  const options = new Map()
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index]
    const value = rest[index + 1]
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error('SECURITY_EVIDENCE_ARGUMENTS_INVALID')
    }
    options.set(key.slice(2), value)
  }
  return { command, options }
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (isDirectExecution) {
  Promise.resolve()
    .then(async () => {
      const { command, options } = parseCli(process.argv.slice(2))
      if (command === 'verify') {
        const directory = options.get('directory')
        const profile = options.get('profile')
        if (!directory || !profile) {
          throw new Error('SECURITY_EVIDENCE_ARGUMENTS_INVALID')
        }
        const requiredLabels = (options.get('required') ?? '')
          .split(',')
          .filter(Boolean)
        const manifest = await verifyArtifactDirectory({
          directory: path.resolve(directory),
          profile,
          requiredLabels,
          additionalSecrets: collectSensitiveEnvironmentValues(process.env)
        })
        process.stdout.write(
          `${JSON.stringify({
            event: 'phase10.security_evidence.verified',
            fileCount: manifest.files.length,
            profile
          })}\n`
        )
        return
      }
      if (command === 'verify-workflow') {
        const file = options.get('file')
        if (!file) throw new Error('SECURITY_EVIDENCE_ARGUMENTS_INVALID')
        assertWorkflowArtifactPolicy(await readFile(path.resolve(file), 'utf8'))
        process.stdout.write(
          `${JSON.stringify({ event: 'phase10.workflow_artifact_policy.passed' })}\n`
        )
        return
      }
      throw new Error('SECURITY_EVIDENCE_ARGUMENTS_INVALID')
    })
    .catch((error) => {
      process.stderr.write(
        `${JSON.stringify({
          event: 'phase10.security_evidence.failed',
          errorCode:
            error instanceof Error ? error.message : 'SECURITY_UNKNOWN_FAILURE'
        })}\n`
      )
      process.exitCode = 1
    })
}
