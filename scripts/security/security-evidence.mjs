import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, readdir, rename, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const SAFE_LABEL_PATTERN = /^phase(?:8|9|10)-(?:real|mock)$/u
const SAFE_TEST_STATUS = new Set([
  'passed',
  'failed',
  'skipped',
  'timedOut',
  'interrupted'
])
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

const assertPlaywrightEvidence = (value) => {
  if (
    !exactKeys(value, [
      'schemaVersion',
      'kind',
      'label',
      'status',
      'durationMs',
      'counts',
      'tests'
    ]) ||
    value.schemaVersion !== 1 ||
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
    !Array.isArray(value.tests)
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
  if (JSON.stringify(calculatedCounts) !== JSON.stringify(value.counts)) {
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
    /test-results\/playwright-/u,
    /^\s*path:\s*test-results\/?\s*$/gmu,
    /^\s*path:\s*[|>]\s*$[\s\S]*?^\s+(?:playwright-report|test-results)\//gmu,
    /^\s*path:.*[*?]/gmu
  ]
  if (banned.some((pattern) => pattern.test(workflowText))) {
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
