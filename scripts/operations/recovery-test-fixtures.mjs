import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  digestCanonicalJson,
  deriveMigrationProfile
} from './recovery-contract.mjs'
import { summarizeInventory } from './release-contract.mjs'

const root = resolve(import.meta.dirname, '../..')
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

const migrationRoot = resolve(root, 'apps/api/prisma/migrations')
const migrationEntries = readdirSync(migrationRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map(({ name }) => ({
    name,
    sha256: sha256(readFileSync(resolve(migrationRoot, name, 'migration.sql')))
  }))
  .sort((left, right) => left.name.localeCompare(right.name))

const migrationDigest = sha256(
  migrationEntries
    .map(({ name, sha256: digest }) => `${name}\0${digest}\n`)
    .join('')
)

const fileEntry = (path, value) => ({
  bytes: Buffer.byteLength(value),
  path,
  sha256: sha256(value),
  type: 'file'
})

export const createRecoveryFixtures = () => {
  const contract = JSON.parse(
    readFileSync(resolve(root, 'operations/recovery-contract.v1.json'), 'utf8')
  )
  const releaseId = '1234567890abcdef1234567890abcdef12345678'
  const releaseManifest = {
    schemaVersion: 1,
    releaseId,
    source: {
      commit: releaseId,
      lockfileSha256: sha256('lockfile')
    },
    runtime: { node: '22.23.0', pnpm: '10.2.1' },
    artifacts: {
      api: summarizeInventory([fileEntry('dist/server.js', 'api')]),
      web: summarizeInventory([fileEntry('index.html', 'web')])
    },
    migrations: {
      count: migrationEntries.length,
      digestSha256: migrationDigest,
      entries: migrationEntries
    },
    environmentContract: {
      path: 'operations/environment-contract.v1.json',
      sha256: sha256('environment-contract')
    }
  }
  const migrationProfile = deriveMigrationProfile(
    releaseManifest,
    'technical-current-test'
  )
  const falseClaims = {
    automaticBackupProof: false,
    pointInTimeRecoveryProof: false,
    productionProof: false,
    providerRpoRtoProof: false,
    stagingProof: false
  }
  const plan = {
    schemaVersion: 1,
    classification: contract.classifications.TEST,
    environment: 'TEST',
    releaseId,
    contractSha256: digestCanonicalJson(contract),
    environmentRegistrySha256: sha256('test-registry'),
    releaseManifestSha256: digestCanonicalJson(releaseManifest),
    migrationProfile: migrationProfile.name,
    migrationDigestSha256: migrationProfile.digestSha256,
    sourceTargetFingerprintSha256: sha256('source-target'),
    restoreTargetFingerprintSha256: sha256('restore-target'),
    identities: {
      runtimeSha256: sha256('runtime-identity'),
      migrationSha256: sha256('migration-identity'),
      administrationSha256: sha256('administration-identity')
    },
    recoveryObjectives: {
      rpoSeconds: 300,
      rtoSeconds: 600,
      retentionSeconds: 86_400
    },
    capabilities: {
      adapterSlug: 'test-fixture',
      automaticBackups: false,
      isolatedRestore: true,
      pointInTimeRecovery: false
    },
    externalClaims: falseClaims
  }
  const backupEvidence = {
    schemaVersion: 1,
    classification: contract.classifications.TEST,
    environment: 'TEST',
    releaseId,
    planSha256: digestCanonicalJson(plan),
    migrationProfile: plan.migrationProfile,
    migrationDigestSha256: plan.migrationDigestSha256,
    sourceTargetFingerprintSha256: plan.sourceTargetFingerprintSha256,
    backupReferenceSha256: sha256('backup-reference'),
    adapterObservationSha256: sha256('adapter-observation'),
    contentDigestSha256: sha256('data'),
    schemaDigestSha256: sha256('schema'),
    migrationLedgerDigestSha256: plan.migrationDigestSha256,
    startedAt: '2026-10-01T00:00:00.000Z',
    completedAt: '2026-10-01T00:01:00.000Z',
    observedAt: '2026-10-01T00:04:00.000Z',
    expiresAt: '2026-10-02T00:01:00.000Z',
    status: 'SUCCEEDED',
    facts: {
      backupReadable: true,
      sourceQuiesced: true,
      zeroSourceMutations: true
    },
    externalClaims: falseClaims
  }
  const sharedSchema = sha256('schema')
  const sharedData = sha256('data')
  const sharedLedger = plan.migrationDigestSha256
  const restoreEvidence = {
    schemaVersion: 1,
    classification: contract.classifications.TEST,
    environment: 'TEST',
    releaseId,
    planSha256: digestCanonicalJson(plan),
    backupEvidenceSha256: digestCanonicalJson(backupEvidence),
    releaseManifestSha256: digestCanonicalJson(releaseManifest),
    migrationProfile: plan.migrationProfile,
    migrationDigestSha256: plan.migrationDigestSha256,
    sourceTargetFingerprintSha256: plan.sourceTargetFingerprintSha256,
    restoreTargetFingerprintSha256: plan.restoreTargetFingerprintSha256,
    startedAt: '2026-10-01T00:04:00.000Z',
    completedAt: '2026-10-01T00:05:00.000Z',
    durationMs: 60_000,
    digests: {
      sourceSchemaSha256: sharedSchema,
      restoreSchemaSha256: sharedSchema,
      sourceDataSha256: sharedData,
      restoreDataSha256: sharedData,
      sourceLedgerSha256: sharedLedger,
      restoreLedgerSha256: sharedLedger
    },
    facts: {
      cleanupCompleted: true,
      emptyTargetVerified: true,
      isolatedTarget: true,
      migrationLedgerCompatible: true,
      privateDataObserved: false,
      readinessCompatible: true,
      runtimeRoleReadVerified: true,
      zeroSourceMutations: true
    },
    externalClaims: falseClaims
  }

  return {
    backupEvidence,
    contract,
    now: new Date('2026-10-01T00:05:00.000Z'),
    plan,
    releaseManifest,
    restoreEvidence
  }
}
