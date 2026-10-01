import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runRecoveryEvidenceCli } from './recovery-evidence.mjs'
import { createRecoveryFixtures } from './recovery-test-fixtures.mjs'

const writeJson = (directory, name, value) => {
  const path = join(directory, name)
  writeFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 })
  return path
}

const createCliFixture = () => {
  const directory = mkdtempSync(join(tmpdir(), 'nihongo-recovery-evidence-'))
  const fixtures = createRecoveryFixtures()
  return {
    ...fixtures,
    backupPath: writeJson(directory, 'backup.json', fixtures.backupEvidence),
    contractPath: writeJson(directory, 'contract.json', fixtures.contract),
    directory,
    manifestPath: writeJson(
      directory,
      'release-manifest.json',
      fixtures.releaseManifest
    ),
    planPath: writeJson(directory, 'plan.json', fixtures.plan),
    restorePath: writeJson(directory, 'restore.json', fixtures.restoreEvidence)
  }
}

const commonArguments = (fixture, evidencePath, mode) => [
  '--mode',
  mode,
  '--contract',
  fixture.contractPath,
  '--plan',
  fixture.planPath,
  '--release-manifest',
  fixture.manifestPath,
  '--evidence',
  evidencePath,
  '--expected-environment',
  'TEST'
]

test('verify-only CLI validates the complete backup and restore evidence chain', () => {
  const fixture = createCliFixture()
  try {
    assert.doesNotThrow(() =>
      runRecoveryEvidenceCli(
        commonArguments(fixture, fixture.backupPath, 'verify-backup'),
        { now: () => fixture.now }
      )
    )
    assert.doesNotThrow(() =>
      runRecoveryEvidenceCli(
        [
          ...commonArguments(fixture, fixture.restorePath, 'verify-restore'),
          '--backup-evidence',
          fixture.backupPath
        ],
        { now: () => fixture.now }
      )
    )
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true })
  }
})

test('CLI rejects create modes, unknown or duplicate arguments and environment drift', () => {
  const fixture = createCliFixture()
  try {
    assert.throws(
      () =>
        runRecoveryEvidenceCli(
          commonArguments(fixture, fixture.backupPath, 'create'),
          { now: () => fixture.now }
        ),
      /verify-only/u
    )
    assert.throws(
      () =>
        runRecoveryEvidenceCli(
          [
            ...commonArguments(fixture, fixture.backupPath, 'verify-backup'),
            '--provider',
            'invented'
          ],
          { now: () => fixture.now }
        ),
      /argument set/u
    )
    assert.throws(
      () =>
        runRecoveryEvidenceCli(
          [
            ...commonArguments(fixture, fixture.backupPath, 'verify-backup'),
            '--plan',
            fixture.planPath
          ],
          { now: () => fixture.now }
        ),
      /unique/u
    )
    const stagingArguments = commonArguments(
      fixture,
      fixture.backupPath,
      'verify-backup'
    )
    stagingArguments[stagingArguments.length - 1] = 'STAGING'
    assert.throws(
      () =>
        runRecoveryEvidenceCli(stagingArguments, { now: () => fixture.now }),
      /environment mismatch/u
    )
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true })
  }
})

test('CLI rejects symlinked and oversized evidence inputs', () => {
  const fixture = createCliFixture()
  try {
    const symlinkPath = join(fixture.directory, 'backup-link.json')
    symlinkSync(fixture.backupPath, symlinkPath)
    assert.throws(
      () =>
        runRecoveryEvidenceCli(
          commonArguments(fixture, symlinkPath, 'verify-backup'),
          { now: () => fixture.now }
        ),
      /bounded regular JSON file/u
    )

    const oversizedPath = join(fixture.directory, 'oversized.json')
    writeFileSync(oversizedPath, ' '.repeat(1_048_577), { mode: 0o600 })
    assert.throws(
      () =>
        runRecoveryEvidenceCli(
          commonArguments(fixture, oversizedPath, 'verify-backup'),
          { now: () => fixture.now }
        ),
      /bounded regular JSON file/u
    )
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true })
  }
})
