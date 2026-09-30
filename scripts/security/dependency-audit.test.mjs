import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import {
  evaluateDependencyAudit,
  normalizePnpmAuditReport,
  parseDependencyAuditArguments,
  runPnpmAudit,
  validateDependencyDispositions
} from './dependency-audit.mjs'

const finding = {
  advisoryId: '1100',
  package: 'affected-package',
  severity: 'high',
  installedVersion: '1.2.3',
  dependencyPath: 'apps/web>affected-package'
}

test('legacy pnpm and npm v2 reports normalize to the same exact finding', () => {
  const legacy = normalizePnpmAuditReport({
    rawReport: {
      advisories: {
        1100: {
          id: 1100,
          module_name: finding.package,
          severity: finding.severity,
          findings: [
            {
              version: finding.installedVersion,
              paths: [finding.dependencyPath]
            }
          ]
        }
      }
    }
  })
  const npmV2 = normalizePnpmAuditReport({
    rawReport: {
      auditReportVersion: 2,
      vulnerabilities: {
        [finding.package]: {
          severity: finding.severity,
          nodes: [finding.dependencyPath],
          via: [{ source: 1100, severity: finding.severity }]
        }
      },
      packages: {
        [finding.dependencyPath]: { version: finding.installedVersion }
      }
    }
  })
  assert.deepEqual(legacy, [finding])
  assert.deepEqual(npmV2, [finding])
})

test('production high and critical always block while moderate remains evidence only', () => {
  const result = evaluateDependencyAudit({
    scope: 'production',
    dispositions: [],
    findings: [
      finding,
      { ...finding, advisoryId: '1101', severity: 'critical' },
      { ...finding, advisoryId: '1102', severity: 'moderate' }
    ]
  })
  assert.equal(result.status, 'failed')
  assert.equal(result.blockingFindings.length, 2)
  assert.deepEqual(result.severityCounts, {
    critical: 1,
    high: 1,
    moderate: 1,
    low: 0,
    info: 0,
    unknown: 0
  })
})

test('development high needs an exact unexpired disposition and critical cannot be disposed', () => {
  const disposition = {
    scope: 'development',
    advisoryId: finding.advisoryId,
    package: finding.package,
    installedVersion: finding.installedVersion,
    dependencyPath: finding.dependencyPath,
    rationale: 'NOT_AFFECTED_CONFIGURATION',
    expiresOn: '2026-10-15'
  }
  const parsed = validateDependencyDispositions({
    document: { schemaVersion: 1, entries: [disposition] },
    now: new Date('2026-09-29T00:00:00.000Z')
  })
  assert.equal(
    evaluateDependencyAudit({
      scope: 'development',
      findings: [finding],
      dispositions: parsed
    }).status,
    'passed'
  )
  assert.equal(
    evaluateDependencyAudit({
      scope: 'development',
      findings: [{ ...finding, severity: 'critical' }],
      dispositions: parsed
    }).status,
    'failed'
  )
  assert.throws(() =>
    validateDependencyDispositions({
      document: {
        schemaVersion: 1,
        entries: [{ ...disposition, dependencyPath: 'apps/*' }]
      },
      now: new Date('2026-09-29T00:00:00.000Z')
    })
  )
})

test('valid advisory JSON with exit 1 is parsed and command scopes stay exact', async () => {
  let observed
  const spawnImpl = (command, args, options) => {
    observed = { command, args, options }
    const child = new EventEmitter()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = () => true
    queueMicrotask(() => {
      child.stdout.write(JSON.stringify({ advisories: {} }))
      child.stdout.end()
      child.stderr.end()
      child.emit('close', 1)
    })
    return child
  }
  const result = await runPnpmAudit({
    repositoryRoot: '/tmp/repository',
    scope: 'production',
    spawnImpl
  })
  assert.equal(result.exitCode, 1)
  assert.deepEqual(observed.args, [
    'audit',
    '--prod',
    '--json',
    '--audit-level',
    'low'
  ])
  assert.equal(observed.options.shell, false)
})

test('scope arguments and unavailable reports fail closed', () => {
  assert.deepEqual(parseDependencyAuditArguments(['--scope', 'development']), {
    scope: 'development'
  })
  assert.throws(() => parseDependencyAuditArguments(['--scope', 'all']))
  assert.throws(() => normalizePnpmAuditReport({ rawReport: { error: {} } }))
  assert.throws(() => normalizePnpmAuditReport({ rawReport: {} }))
})
