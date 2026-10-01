import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import {
  digestCanonicalJson,
  deriveMigrationProfile,
  verifyBackupEvidence,
  verifyRecoveryContract,
  verifyRecoveryPlan,
  verifyRestoreEvidence
} from './recovery-contract.mjs'
import { createRecoveryFixtures } from './recovery-test-fixtures.mjs'

const root = resolve(import.meta.dirname, '../..')

test('recovery policy is closed and cross-linked to the environment registry', () => {
  const { contract } = createRecoveryFixtures()
  const environmentContract = JSON.parse(
    readFileSync(
      resolve(root, 'operations/environment-contract.v1.json'),
      'utf8'
    )
  )

  assert.equal(
    verifyRecoveryContract(contract, { environmentContract }),
    contract
  )
  assert.throws(
    () => verifyRecoveryContract({ ...contract, provider: 'invented' }),
    /invalid key set/u
  )
  const missingField = structuredClone(contract)
  missingField.requiredRegistryFields.pop()
  assert.throws(() => verifyRecoveryContract(missingField), /registry fields/u)
})

test('migration profiles separate all 31 TEST entries from the exact v1 runtime 27', () => {
  const { releaseManifest } = createRecoveryFixtures()

  assert.deepEqual(
    deriveMigrationProfile(releaseManifest, 'technical-current-test'),
    {
      count: 31,
      digestSha256: releaseManifest.migrations.digestSha256,
      name: 'technical-current-test'
    }
  )
  const runtime = deriveMigrationProfile(
    releaseManifest,
    'v1-runtime-pre-phase7'
  )
  assert.equal(runtime.count, 27)
  assert.notEqual(runtime.digestSha256, releaseManifest.migrations.digestSha256)

  const boundaryDrift = structuredClone(releaseManifest)
  boundaryDrift.migrations.entries[27].name = '20260827100001_wrong_boundary'
  boundaryDrift.migrations.digestSha256 = createHash('sha256')
    .update(
      boundaryDrift.migrations.entries
        .map(({ name, sha256 }) => `${name}\0${sha256}\n`)
        .join('')
    )
    .digest('hex')
  assert.throws(
    () => deriveMigrationProfile(boundaryDrift, 'v1-runtime-pre-phase7'),
    /migration inventory|boundary mismatch/u
  )

  const immutablePrefixDrift = structuredClone(releaseManifest)
  immutablePrefixDrift.migrations.entries[0].sha256 = 'a'.repeat(64)
  immutablePrefixDrift.migrations.digestSha256 = createHash('sha256')
    .update(
      immutablePrefixDrift.migrations.entries
        .map(({ name, sha256 }) => `${name}\0${sha256}\n`)
        .join('')
    )
    .digest('hex')
  assert.throws(
    () => deriveMigrationProfile(immutablePrefixDrift, 'v1-runtime-pre-phase7'),
    /profile inventory mismatch/u
  )
})

test('recovery plan is deterministic, target-bound and identity-separated', () => {
  const { contract, plan, releaseManifest } = createRecoveryFixtures()

  assert.equal(
    verifyRecoveryPlan(plan, {
      contract,
      expectedEnvironment: 'TEST',
      releaseManifest
    }),
    plan
  )
  assert.equal(
    digestCanonicalJson(plan),
    digestCanonicalJson(structuredClone(plan))
  )

  const extra = { ...plan, databaseUrl: 'forbidden' }
  assert.throws(
    () =>
      verifyRecoveryPlan(extra, {
        contract,
        expectedEnvironment: 'TEST',
        releaseManifest
      }),
    /invalid key set/u
  )
  const sameTarget = {
    ...plan,
    restoreTargetFingerprintSha256: plan.sourceTargetFingerprintSha256
  }
  assert.throws(
    () =>
      verifyRecoveryPlan(sameTarget, {
        contract,
        expectedEnvironment: 'TEST',
        releaseManifest
      }),
    /isolated/u
  )
  const sameIdentity = structuredClone(plan)
  sameIdentity.identities.administrationSha256 =
    sameIdentity.identities.runtimeSha256
  assert.throws(
    () =>
      verifyRecoveryPlan(sameIdentity, {
        contract,
        expectedEnvironment: 'TEST',
        releaseManifest
      }),
    /identities/u
  )
  assert.throws(
    () =>
      verifyRecoveryPlan(plan, {
        contract,
        expectedEnvironment: 'STAGING',
        releaseManifest
      }),
    /environment mismatch/u
  )
  const classificationDrift = {
    ...plan,
    classification: 'TEST'
  }
  assert.throws(
    () =>
      verifyRecoveryPlan(classificationDrift, {
        contract,
        expectedEnvironment: 'TEST',
        releaseManifest
      }),
    /environment mismatch/u
  )
  const placeholderDigest = {
    ...plan,
    environmentRegistrySha256: '0'.repeat(64)
  }
  assert.throws(
    () =>
      verifyRecoveryPlan(placeholderDigest, {
        contract,
        expectedEnvironment: 'TEST',
        releaseManifest
      }),
    /SHA-256 digest/u
  )
})

test('backup evidence enforces freshness, retention and TEST claim isolation', () => {
  const fixtures = createRecoveryFixtures()
  const { backupEvidence, contract, now, plan, releaseManifest } = fixtures
  const options = {
    contract,
    expectedEnvironment: 'TEST',
    now,
    plan,
    releaseManifest
  }

  assert.equal(verifyBackupEvidence(backupEvidence, options), backupEvidence)

  const stale = {
    ...backupEvidence,
    observedAt: '2026-09-30T23:00:00.000Z'
  }
  assert.throws(() => verifyBackupEvidence(stale, options), /timing/u)

  const shortRetention = {
    ...backupEvidence,
    expiresAt: '2026-10-01T00:10:00.000Z'
  }
  assert.throws(
    () => verifyBackupEvidence(shortRetention, options),
    /retention/u
  )

  const expired = {
    ...backupEvidence,
    expiresAt: '2026-10-01T00:04:59.999Z'
  }
  assert.throws(() => verifyBackupEvidence(expired, options), /retention/u)

  const staleCompletion = {
    ...backupEvidence,
    startedAt: '2026-09-30T23:59:00.000Z',
    completedAt: '2026-09-30T23:59:59.999Z'
  }
  assert.throws(() => verifyBackupEvidence(staleCompletion, options), /timing/u)

  const falseExternalClaim = structuredClone(backupEvidence)
  falseExternalClaim.externalClaims.stagingProof = true
  assert.throws(
    () => verifyBackupEvidence(falseExternalClaim, options),
    /TEST evidence/u
  )
})

test('self-attested external recovery chains fail closed without a trusted adapter', () => {
  const { backupEvidence, contract, now, plan, releaseManifest } =
    createRecoveryFixtures()
  const runtimeProfile = deriveMigrationProfile(
    releaseManifest,
    'v1-runtime-pre-phase7'
  )
  const stagingPlan = {
    ...plan,
    classification: contract.classifications.STAGING,
    environment: 'STAGING',
    migrationProfile: runtimeProfile.name,
    migrationDigestSha256: runtimeProfile.digestSha256,
    capabilities: {
      ...plan.capabilities,
      automaticBackups: true,
      pointInTimeRecovery: true
    }
  }
  assert.throws(
    () =>
      verifyRecoveryPlan(stagingPlan, {
        contract,
        expectedEnvironment: 'STAGING',
        releaseManifest
      }),
    /disabled for this environment/u
  )
  const stagingEvidence = {
    ...backupEvidence,
    classification: contract.classifications.STAGING,
    environment: 'STAGING',
    planSha256: digestCanonicalJson(stagingPlan),
    migrationProfile: runtimeProfile.name,
    migrationDigestSha256: runtimeProfile.digestSha256,
    externalClaims: {
      automaticBackupProof: true,
      pointInTimeRecoveryProof: true,
      productionProof: false,
      providerRpoRtoProof: true,
      stagingProof: true
    }
  }
  assert.throws(
    () =>
      verifyBackupEvidence(stagingEvidence, {
        contract,
        expectedEnvironment: 'STAGING',
        now,
        plan: stagingPlan,
        releaseManifest
      }),
    /disabled for this environment/u
  )
})

test('restore evidence proves isolated digest parity, timing and cleanup only', () => {
  const fixtures = createRecoveryFixtures()
  const {
    backupEvidence,
    contract,
    now,
    plan,
    releaseManifest,
    restoreEvidence
  } = fixtures
  const options = {
    backupEvidence,
    contract,
    expectedEnvironment: 'TEST',
    now,
    plan,
    releaseManifest
  }

  assert.equal(verifyRestoreEvidence(restoreEvidence, options), restoreEvidence)

  const dataDrift = structuredClone(restoreEvidence)
  dataDrift.digests.restoreDataSha256 = 'a'.repeat(64)
  assert.throws(
    () => verifyRestoreEvidence(dataDrift, options),
    /digest mismatch/u
  )

  const selfConsistentDataDrift = structuredClone(restoreEvidence)
  selfConsistentDataDrift.digests.sourceDataSha256 = 'a'.repeat(64)
  selfConsistentDataDrift.digests.restoreDataSha256 = 'a'.repeat(64)
  assert.throws(
    () => verifyRestoreEvidence(selfConsistentDataDrift, options),
    /digest mismatch/u
  )

  const selfConsistentLedgerDrift = structuredClone(restoreEvidence)
  selfConsistentLedgerDrift.digests.sourceLedgerSha256 = 'b'.repeat(64)
  selfConsistentLedgerDrift.digests.restoreLedgerSha256 = 'b'.repeat(64)
  assert.throws(
    () => verifyRestoreEvidence(selfConsistentLedgerDrift, options),
    /digest mismatch/u
  )

  const cleanupFailure = structuredClone(restoreEvidence)
  cleanupFailure.facts.cleanupCompleted = false
  assert.throws(
    () => verifyRestoreEvidence(cleanupFailure, options),
    /facts are incomplete/u
  )

  const durationDrift = { ...restoreEvidence, durationMs: 59_999 }
  assert.throws(
    () => verifyRestoreEvidence(durationDrift, options),
    /duration/u
  )

  const future = {
    ...restoreEvidence,
    startedAt: '2026-10-01T00:06:00.000Z',
    completedAt: '2026-10-01T00:07:00.000Z',
    durationMs: 60_000
  }
  assert.throws(() => verifyRestoreEvidence(future, options), /duration/u)

  const beforeBackupObservation = {
    ...restoreEvidence,
    startedAt: '2026-10-01T00:03:59.999Z',
    durationMs: 60_001
  }
  assert.throws(
    () => verifyRestoreEvidence(beforeBackupObservation, options),
    /duration/u
  )

  const expiredBackup = {
    ...backupEvidence,
    expiresAt: '2026-10-01T00:04:59.999Z'
  }
  assert.throws(
    () =>
      verifyRestoreEvidence(restoreEvidence, {
        ...options,
        backupEvidence: expiredBackup
      }),
    /retention/u
  )
})

test('tracked recovery surfaces contain no executable destructive operation', () => {
  const packageSource = readFileSync(resolve(root, 'package.json'), 'utf8')
  const workflow = readFileSync(
    resolve(root, '.github/workflows/ci.yml'),
    'utf8'
  )
  const executableSurface = `${packageSource}\n${workflow}`
  const verifierSource = [
    readFileSync(
      resolve(root, 'scripts/operations/recovery-contract.mjs'),
      'utf8'
    ),
    readFileSync(
      resolve(root, 'scripts/operations/recovery-evidence.mjs'),
      'utf8'
    )
  ].join('\n')

  for (const command of [
    'prisma migrate reset',
    'prisma db push',
    'pg_restore --clean',
    'dropdb',
    'recovery:verify -- --mode create'
  ]) {
    assert.equal(executableSurface.includes(command), false, command)
  }
  assert.doesNotMatch(
    verifierSource,
    /from ['"]node:(?:child_process|cluster|dgram|dns|http|https|net|tls|worker_threads)['"]/u
  )
  assert.doesNotMatch(
    verifierSource,
    /from ['"](?:@prisma|axios|pg|postgres|undici)/u
  )
  assert.doesNotMatch(
    verifierSource,
    /\b(?:appendFile|chmod|chown|copyFile|createWriteStream|fetch|link|mkdir|rename|rm|rmdir|symlink|truncate|unlink|writeFile)(?:Sync)?\s*\(/u
  )
})
