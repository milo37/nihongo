import { spawn as spawnDefault } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeCanonicalEvidence } from './security-evidence.mjs'

const SEVERITIES = ['critical', 'high', 'moderate', 'low', 'info', 'unknown']
const DISPOSITION_RATIONALES = new Set([
  'FALSE_POSITIVE',
  'NOT_AFFECTED_CONFIGURATION'
])
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u
const EXACT_VALUE_PATTERN = /^[^*?[\]\\]+$/u

const normalizeSeverity = (value) => {
  const normalized = String(value ?? 'unknown').toLowerCase()
  return SEVERITIES.includes(normalized) ? normalized : 'unknown'
}

const compareFindings = (left, right) =>
  left.severity.localeCompare(right.severity) ||
  left.package.localeCompare(right.package) ||
  left.advisoryId.localeCompare(right.advisoryId) ||
  left.installedVersion.localeCompare(right.installedVersion) ||
  left.dependencyPath.localeCompare(right.dependencyPath)

const deduplicateFindings = (findings) => {
  const byIdentity = new Map()
  for (const finding of findings) {
    const identity = [
      finding.advisoryId,
      finding.package,
      finding.severity,
      finding.installedVersion,
      finding.dependencyPath
    ].join('\0')
    byIdentity.set(identity, finding)
  }
  return [...byIdentity.values()].toSorted(compareFindings)
}

const normalizeLegacyPnpmReport = (rawReport) => {
  const findings = []
  for (const [rawAdvisoryId, advisory] of Object.entries(
    rawReport.advisories ?? {}
  )) {
    if (!advisory || typeof advisory !== 'object') continue
    const advisoryId = String(advisory.id ?? rawAdvisoryId)
    const packageName = String(
      advisory.module_name ?? advisory.name ?? 'unknown-package'
    )
    const severity = normalizeSeverity(advisory.severity)
    const advisoryFindings = Array.isArray(advisory.findings)
      ? advisory.findings
      : []
    if (advisoryFindings.length === 0) {
      findings.push({
        advisoryId,
        package: packageName,
        severity,
        installedVersion: String(advisory.installed_version ?? 'unknown'),
        dependencyPath: packageName
      })
      continue
    }
    for (const finding of advisoryFindings) {
      const paths = Array.isArray(finding?.paths) ? finding.paths : []
      const installedVersion = String(finding?.version ?? 'unknown')
      for (const dependencyPath of paths.length > 0 ? paths : [packageName]) {
        findings.push({
          advisoryId,
          package: packageName,
          severity,
          installedVersion,
          dependencyPath: String(dependencyPath)
        })
      }
    }
  }
  return findings
}

const normalizeNpmV2Report = (rawReport) => {
  const findings = []
  for (const [packageName, vulnerability] of Object.entries(
    rawReport.vulnerabilities ?? {}
  )) {
    if (!vulnerability || typeof vulnerability !== 'object') continue
    const nodes = Array.isArray(vulnerability.nodes)
      ? vulnerability.nodes
      : [packageName]
    const advisoryEntries = Array.isArray(vulnerability.via)
      ? vulnerability.via.filter(
          (entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
        )
      : []
    const normalizedAdvisories =
      advisoryEntries.length > 0
        ? advisoryEntries
        : [
            {
              source: vulnerability.source ?? packageName,
              severity: vulnerability.severity
            }
          ]
    for (const advisory of normalizedAdvisories) {
      const advisoryId = String(
        advisory.source ?? advisory.id ?? advisory.name ?? packageName
      )
      const severity = normalizeSeverity(
        advisory.severity ?? vulnerability.severity
      )
      for (const dependencyPath of nodes) {
        const installedVersion = String(
          rawReport.packages?.[dependencyPath]?.version ??
            vulnerability.installedVersion ??
            'unknown'
        )
        findings.push({
          advisoryId,
          package: packageName,
          severity,
          installedVersion,
          dependencyPath: String(dependencyPath)
        })
      }
    }
  }
  return findings
}

export const normalizePnpmAuditReport = ({ rawReport }) => {
  if (!rawReport || typeof rawReport !== 'object' || Array.isArray(rawReport)) {
    throw new Error('SECURITY_DEPENDENCY_AUDIT_UNAVAILABLE')
  }
  if ('error' in rawReport) {
    throw new Error('SECURITY_DEPENDENCY_AUDIT_UNAVAILABLE')
  }
  if ('advisories' in rawReport) {
    return deduplicateFindings(normalizeLegacyPnpmReport(rawReport))
  }
  if ('vulnerabilities' in rawReport) {
    return deduplicateFindings(normalizeNpmV2Report(rawReport))
  }
  throw new Error('SECURITY_DEPENDENCY_AUDIT_UNAVAILABLE')
}

const assertExactKeys = (value, expected, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  if (
    JSON.stringify(Object.keys(value).toSorted()) !==
    JSON.stringify([...expected].toSorted())
  ) {
    throw new Error(`${label} has unknown or missing fields.`)
  }
}

export const validateDependencyDispositions = ({ document, now }) => {
  assertExactKeys(document, ['schemaVersion', 'entries'], 'dispositions')
  if (document.schemaVersion !== 1 || !Array.isArray(document.entries)) {
    throw new Error('dependency disposition schema is invalid.')
  }
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`)
  const latestExpiry = today + 30 * 24 * 60 * 60 * 1_000
  const identities = new Set()
  return document.entries.map((entry, index) => {
    assertExactKeys(
      entry,
      [
        'scope',
        'advisoryId',
        'package',
        'installedVersion',
        'dependencyPath',
        'rationale',
        'expiresOn'
      ],
      `dependency disposition ${index}`
    )
    const exactValues = [
      entry.advisoryId,
      entry.package,
      entry.installedVersion,
      entry.dependencyPath
    ]
    const expiry = Date.parse(`${entry.expiresOn}T00:00:00.000Z`)
    if (
      !['production', 'development'].includes(entry.scope) ||
      !exactValues.every(
        (value) =>
          typeof value === 'string' &&
          value.length > 0 &&
          EXACT_VALUE_PATTERN.test(value)
      ) ||
      !DISPOSITION_RATIONALES.has(entry.rationale) ||
      typeof entry.expiresOn !== 'string' ||
      !DATE_PATTERN.test(entry.expiresOn) ||
      !Number.isFinite(expiry) ||
      expiry < today ||
      expiry > latestExpiry
    ) {
      throw new Error(`dependency disposition ${index} is invalid.`)
    }
    const identity = [entry.scope, ...exactValues].join('\0')
    if (identities.has(identity)) {
      throw new Error(`dependency disposition ${index} is duplicated.`)
    }
    identities.add(identity)
    return { ...entry }
  })
}

const matchesDisposition = (finding, disposition, scope) =>
  disposition.scope === scope &&
  disposition.advisoryId === finding.advisoryId &&
  disposition.package === finding.package &&
  disposition.installedVersion === finding.installedVersion &&
  disposition.dependencyPath === finding.dependencyPath

export const evaluateDependencyAudit = ({ findings, dispositions, scope }) => {
  if (!['production', 'development'].includes(scope)) {
    throw new Error('SECURITY_DEPENDENCY_SCOPE_INVALID')
  }
  const severityCounts = Object.fromEntries(
    SEVERITIES.map((severity) => [severity, 0])
  )
  const usedDispositionIndexes = new Set()
  const blockingFindings = []
  for (const finding of findings) {
    severityCounts[finding.severity] += 1
    const dispositionIndex = dispositions.findIndex((entry) =>
      matchesDisposition(finding, entry, scope)
    )
    const mayDispose = scope === 'development' && finding.severity === 'high'
    if (mayDispose && dispositionIndex !== -1) {
      usedDispositionIndexes.add(dispositionIndex)
      continue
    }
    const isBlocker =
      finding.severity === 'critical' ||
      finding.severity === 'unknown' ||
      finding.severity === 'high'
    if (isBlocker) blockingFindings.push(finding)
  }
  const unusedDispositions = dispositions.filter(
    (entry, index) =>
      entry.scope === scope && !usedDispositionIndexes.has(index)
  )
  return {
    status:
      blockingFindings.length === 0 && unusedDispositions.length === 0
        ? 'passed'
        : 'failed',
    scope,
    findings: [...findings].toSorted(compareFindings),
    severityCounts,
    appliedDispositionCount: usedDispositionIndexes.size,
    blockingFindings,
    unusedDispositions
  }
}

export const parseDependencyAuditArguments = (argv) => {
  if (argv.length !== 2 || argv[0] !== '--scope') {
    throw new Error('SECURITY_DEPENDENCY_ARGUMENTS_INVALID')
  }
  const scope = argv[1]
  if (!['production', 'development'].includes(scope)) {
    throw new Error('SECURITY_DEPENDENCY_ARGUMENTS_INVALID')
  }
  return { scope }
}

export const runPnpmAudit = async ({
  repositoryRoot,
  scope,
  spawnImpl = spawnDefault,
  timeoutMs = 60_000,
  maximumOutputBytes = 8 * 1024 * 1024
}) => {
  const args = [
    'audit',
    scope === 'production' ? '--prod' : '--dev',
    '--json',
    '--audit-level',
    'low'
  ]
  return await new Promise((resolve, reject) => {
    let settled = false
    let stdout = ''
    let outputBytes = 0
    const child = spawnImpl('pnpm', args, {
      cwd: repositoryRoot,
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const finish = (callback) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback()
    }
    const consume = (chunk, capture) => {
      outputBytes += chunk.length
      if (outputBytes > maximumOutputBytes) {
        child.kill('SIGKILL')
        finish(() => reject(new Error('SECURITY_DEPENDENCY_AUDIT_UNAVAILABLE')))
        return
      }
      if (capture) stdout += chunk.toString('utf8')
    }
    child.stdout.on('data', (chunk) => consume(chunk, true))
    child.stderr.on('data', (chunk) => consume(chunk, false))
    child.once('error', () =>
      finish(() => reject(new Error('SECURITY_DEPENDENCY_AUDIT_UNAVAILABLE')))
    )
    child.once('close', (code) => {
      finish(() => {
        if (code !== 0 && code !== 1) {
          reject(new Error('SECURITY_DEPENDENCY_AUDIT_UNAVAILABLE'))
          return
        }
        let rawReport
        try {
          rawReport = JSON.parse(stdout)
        } catch {
          reject(new Error('SECURITY_DEPENDENCY_AUDIT_UNAVAILABLE'))
          return
        }
        resolve({ rawReport, exitCode: code, args })
      })
    })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(() => reject(new Error('SECURITY_DEPENDENCY_AUDIT_UNAVAILABLE')))
    }, timeoutMs)
    timer.unref?.()
  })
}

const sha256File = async (filePath) =>
  createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex')

export const runDependencyAuditGate = async ({
  repositoryRoot,
  scope,
  dispositionPath,
  evidenceDirectory,
  now = new Date(),
  spawnImpl = spawnDefault
}) => {
  const lockfilePath = path.join(repositoryRoot, 'pnpm-lock.yaml')
  const beforeDigest = await sha256File(lockfilePath)
  const dispositions = validateDependencyDispositions({
    document: JSON.parse(await readFile(dispositionPath, 'utf8')),
    now
  })
  const execution = await runPnpmAudit({
    repositoryRoot,
    scope,
    spawnImpl
  })
  const findings = normalizePnpmAuditReport({
    rawReport: execution.rawReport,
    scope
  })
  const afterDigest = await sha256File(lockfilePath)
  if (beforeDigest !== afterDigest) {
    throw new Error('SECURITY_DEPENDENCY_LOCKFILE_CHANGED')
  }
  const decision = evaluateDependencyAudit({ findings, dispositions, scope })
  const evidence = {
    schemaVersion: 1,
    kind: 'nihongo.dependency-audit',
    scope,
    status: decision.status,
    lockfileSha256: afterDigest,
    severityCounts: decision.severityCounts,
    findings: decision.findings,
    appliedDispositionCount: decision.appliedDispositionCount
  }
  await writeCanonicalEvidence({
    filePath: path.join(evidenceDirectory, `dependency-${scope}.json`),
    value: evidence
  })
  if (decision.status !== 'passed') {
    throw new Error('SECURITY_DEPENDENCY_AUDIT_BLOCKED')
  }
  return evidence
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (isDirectExecution) {
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
  )
  Promise.resolve()
    .then(async () => {
      const { scope } = parseDependencyAuditArguments(process.argv.slice(2))
      const evidence = await runDependencyAuditGate({
        repositoryRoot,
        scope,
        dispositionPath: path.join(
          repositoryRoot,
          'scripts/security/dependency-audit-dispositions.v1.json'
        ),
        evidenceDirectory:
          process.env.PHASE10_SECURITY_EVIDENCE_DIR ??
          path.join(repositoryRoot, 'test-results/phase10-evidence/security')
      })
      process.stdout.write(
        `${JSON.stringify({
          event: 'phase10.dependency_audit.passed',
          scope,
          findingCount: evidence.findings.length
        })}\n`
      )
    })
    .catch((error) => {
      process.stderr.write(
        `${JSON.stringify({
          event: 'phase10.dependency_audit.failed',
          errorCode:
            error instanceof Error ? error.message : 'SECURITY_UNKNOWN_FAILURE'
        })}\n`
      )
      process.exitCode = 1
    })
}
