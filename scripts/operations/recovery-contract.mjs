import { createHash } from 'node:crypto'
import { verifyReleaseManifest } from './release-contract.mjs'

const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const ADAPTER_SLUG_PATTERN = /^[a-z][a-z0-9-]{0,62}$/u
const ENVIRONMENTS = ['TEST', 'STAGING', 'PRODUCTION']
const PROFILE_NAMES = ['technical-current-test', 'v1-runtime-pre-phase7']
const EXTERNAL_CLAIM_KEYS = [
  'automaticBackupProof',
  'pointInTimeRecoveryProof',
  'productionProof',
  'providerRpoRtoProof',
  'stagingProof'
]

const expectedRegistryFields = [
  'database.runtimeIdentity',
  'database.migrationIdentity',
  'database.administrationIdentity',
  'database.targetFingerprint',
  'backup.capability',
  'backup.evidenceAdapter',
  'backup.rpo',
  'backup.rto',
  'backup.retention',
  'backup.restoreTarget',
  'governance.deploymentApprover',
  'governance.incidentOwner'
]

const expectedSequence = [
  'release-manifest-verified',
  'quality-gates-green',
  'exact-backup-proof-accepted',
  'migration-profile-preflight-green',
  'migration-applied',
  'artifact-deployed',
  'liveness-green',
  'readiness-green',
  'post-deploy-smoke-green',
  'recovery-evidence-verified'
]

const expectedForbiddenOperations = [
  'prisma migrate reset',
  'prisma db push',
  'prisma migrate dev',
  'reverse migration',
  'ad-hoc production sql',
  'restore over source target'
]

const expectedForbiddenMaterial = [
  'url',
  'credential',
  'database-name',
  'dump-or-backup-path',
  'sql',
  'provider-output',
  'private-row',
  'request-body',
  'raw-error'
]

const assertObject = (value, label) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  return value
}

export const assertExactKeys = (value, expectedKeys, label) => {
  const object = assertObject(value, label)
  if (
    JSON.stringify(Object.keys(object).sort()) !==
    JSON.stringify([...expectedKeys].sort())
  ) {
    throw new Error(`${label} has an invalid key set.`)
  }
  return object
}

const assertExactArray = (value, expected, label) => {
  if (
    !Array.isArray(value) ||
    JSON.stringify(value) !== JSON.stringify(expected)
  ) {
    throw new Error(`${label} is invalid.`)
  }
}

const assertSha256 = (value, label) => {
  if (
    typeof value !== 'string' ||
    !SHA256_PATTERN.test(value) ||
    value === '0'.repeat(64)
  ) {
    throw new Error(`${label} must be a SHA-256 digest.`)
  }
  return value
}

const assertEnvironment = (value, label = 'Environment') => {
  if (!ENVIRONMENTS.includes(value)) {
    throw new Error(`${label} is invalid.`)
  }
  return value
}

const assertPositiveInteger = (value, maximum, label) => {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`${label} is invalid.`)
  }
  return value
}

const assertBooleanObject = (value, keys, label) => {
  const object = assertExactKeys(value, keys, label)
  for (const key of keys) {
    if (typeof object[key] !== 'boolean') {
      throw new Error(`${label} must contain booleans.`)
    }
  }
  return object
}

const assertCanonicalTimestamp = (value, label) => {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error(`${label} must be a canonical UTC timestamp.`)
  }
  return Date.parse(value)
}

const assertSafeEvidenceMaterial = (value) => {
  const visit = (current) => {
    if (typeof current === 'string') {
      if (
        /:\/\//u.test(current) ||
        /@/u.test(current) ||
        /BEGIN (?:RSA |OPENSSH )?PRIVATE KEY/iu.test(current) ||
        /(?:password|credential|secret|token)=/iu.test(current) ||
        /(?:SELECT|INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\s+/iu.test(
          current
        ) ||
        /(?:^|[\\/])(?:Users|home|private|tmp|var)(?:[\\/]|$)/u.test(current)
      ) {
        throw new Error('Recovery evidence contains forbidden material.')
      }
      return
    }
    if (Array.isArray(current)) {
      current.forEach(visit)
      return
    }
    if (typeof current === 'object' && current !== null) {
      Object.values(current).forEach(visit)
    }
  }
  visit(value)
}

const normalizeCanonicalValue = (value) => {
  if (Array.isArray(value)) return value.map(normalizeCanonicalValue)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, normalizeCanonicalValue(value[key])])
  )
}

export const canonicalJson = (value) =>
  `${JSON.stringify(normalizeCanonicalValue(value))}\n`

export const digestCanonicalJson = (value) =>
  createHash('sha256').update(canonicalJson(value)).digest('hex')

const digestMigrationEntries = (entries) =>
  createHash('sha256')
    .update(
      entries
        .map((migration) => `${migration.name}\0${migration.sha256}\n`)
        .join('')
    )
    .digest('hex')

export const verifyRecoveryContract = (
  contract,
  { environmentContract } = {}
) => {
  assertExactKeys(
    contract,
    [
      'classifications',
      'evidencePolicy',
      'forbiddenOperations',
      'migrationProfiles',
      'requiredRegistryFields',
      'rollbackMatrix',
      'schemaVersion',
      'sequence'
    ],
    'Recovery contract'
  )
  if (contract.schemaVersion !== 1) {
    throw new Error('Unsupported recovery contract schema.')
  }
  assertExactKeys(contract.classifications, ENVIRONMENTS, 'Classifications')
  if (
    contract.classifications.TEST !== 'provider-neutral-isolated-fixture' ||
    contract.classifications.STAGING !== 'exact-external-target-evidence' ||
    contract.classifications.PRODUCTION !== 'exact-external-target-evidence'
  ) {
    throw new Error('Recovery classifications are invalid.')
  }
  assertExactArray(
    contract.requiredRegistryFields,
    expectedRegistryFields,
    'Recovery registry fields'
  )
  if (environmentContract) {
    const registered = new Set(
      environmentContract.requiredExternalRegistryFields
    )
    for (const field of expectedRegistryFields) {
      if (!registered.has(field)) {
        throw new Error('Recovery field is absent from environment contract.')
      }
    }
  }

  assertExactKeys(
    contract.migrationProfiles,
    PROFILE_NAMES,
    'Migration profiles'
  )
  const technical = assertExactKeys(
    contract.migrationProfiles['technical-current-test'],
    [
      'environments',
      'expectedCount',
      'expectedDigestSha256',
      'externalRecoveryClaimAllowed',
      'selection'
    ],
    'Technical migration profile'
  )
  assertExactArray(technical.environments, ['TEST'], 'Technical environments')
  if (
    technical.selection !== 'all-release-manifest-entries' ||
    technical.expectedCount !== 31 ||
    technical.expectedDigestSha256 !==
      '3efd321d7d66f31505c0887f3ef9b0bb64dbe89831d70ea132066fba24b63aea' ||
    technical.externalRecoveryClaimAllowed !== false
  ) {
    throw new Error('Technical migration profile is invalid.')
  }

  const runtime = assertExactKeys(
    contract.migrationProfiles['v1-runtime-pre-phase7'],
    [
      'boundaryMigration',
      'environments',
      'expectedCount',
      'expectedDigestSha256',
      'externalRecoveryClaimAllowed',
      'selection'
    ],
    'Runtime migration profile'
  )
  assertExactArray(
    runtime.environments,
    ['STAGING', 'PRODUCTION'],
    'Runtime environments'
  )
  if (
    runtime.selection !== 'entries-before-boundary' ||
    runtime.boundaryMigration !== '20260827100000_phase7_admin_cms_enums' ||
    runtime.expectedCount !== 27 ||
    runtime.expectedDigestSha256 !==
      '6870a93dd141b7a6c226de7aeed315d48ce313828c82bb92f91bf8a8861ed2ea' ||
    runtime.externalRecoveryClaimAllowed !== false
  ) {
    throw new Error('Runtime migration profile is invalid.')
  }

  assertExactArray(contract.sequence, expectedSequence, 'Recovery sequence')
  if (
    !Array.isArray(contract.rollbackMatrix) ||
    contract.rollbackMatrix.length !== 4
  ) {
    throw new Error('Rollback matrix is invalid.')
  }
  const expectedRollback = [
    ['before-migration', 'abort-without-target-write'],
    ['unchanged-migration-profile', 'previous-artifact-allowed'],
    [
      'additive-compatible-migration',
      'previous-artifact-only-with-reviewed-compatibility-evidence'
    ],
    ['other-schema-change', 'forward-fix-only']
  ]
  contract.rollbackMatrix.forEach((entry, index) => {
    assertExactKeys(entry, ['action', 'state'], 'Rollback entry')
    if (
      entry.state !== expectedRollback[index][0] ||
      entry.action !== expectedRollback[index][1]
    ) {
      throw new Error('Rollback matrix is invalid.')
    }
  })
  assertExactArray(
    contract.forbiddenOperations,
    expectedForbiddenOperations,
    'Forbidden recovery operations'
  )
  assertExactKeys(
    contract.evidencePolicy,
    [
      'forbiddenMaterial',
      'externalEvidence',
      'identifiers',
      'maximumInputBytes',
      'supportedVerifierEnvironments',
      'testExternalClaims'
    ],
    'Evidence policy'
  )
  if (
    contract.evidencePolicy.maximumInputBytes !== 1_048_576 ||
    contract.evidencePolicy.identifiers !== 'sha256-fingerprints-only' ||
    contract.evidencePolicy.externalEvidence !==
      'disabled-until-trusted-adapter' ||
    contract.evidencePolicy.testExternalClaims !== 'all-false' ||
    JSON.stringify(contract.evidencePolicy.forbiddenMaterial) !==
      JSON.stringify(expectedForbiddenMaterial) ||
    JSON.stringify(contract.evidencePolicy.supportedVerifierEnvironments) !==
      JSON.stringify(['TEST'])
  ) {
    throw new Error('Recovery evidence policy is invalid.')
  }
  assertSafeEvidenceMaterial(contract)
  return contract
}

export const deriveMigrationProfile = (releaseManifest, profileName) => {
  const manifest = verifyReleaseManifest(releaseManifest)
  if (!PROFILE_NAMES.includes(profileName)) {
    throw new Error('Unsupported recovery migration profile.')
  }
  let entries
  if (profileName === 'technical-current-test') {
    entries = manifest.migrations.entries
    if (entries.length !== 31) {
      throw new Error('Technical migration profile count mismatch.')
    }
  } else {
    const boundaryIndex = manifest.migrations.entries.findIndex(
      ({ name }) => name === '20260827100000_phase7_admin_cms_enums'
    )
    if (boundaryIndex !== 27) {
      throw new Error('Runtime migration profile boundary mismatch.')
    }
    entries = manifest.migrations.entries.slice(0, boundaryIndex)
  }
  const profile = {
    count: entries.length,
    digestSha256: digestMigrationEntries(entries),
    name: profileName
  }
  const expectedDigest =
    profileName === 'technical-current-test'
      ? '3efd321d7d66f31505c0887f3ef9b0bb64dbe89831d70ea132066fba24b63aea'
      : '6870a93dd141b7a6c226de7aeed315d48ce313828c82bb92f91bf8a8861ed2ea'
  if (profile.digestSha256 !== expectedDigest) {
    throw new Error('Recovery migration profile inventory mismatch.')
  }
  return profile
}

const verifyExternalClaims = (
  claims,
  environment,
  label,
  { evidence = false } = {}
) => {
  const parsed = assertBooleanObject(claims, EXTERNAL_CLAIM_KEYS, label)
  if (!evidence) {
    if (Object.values(parsed).some(Boolean)) {
      throw new Error('Recovery plans cannot make external evidence claims.')
    }
    return parsed
  }
  if (environment !== 'TEST') {
    throw new Error(
      'External recovery evidence is disabled until a trusted adapter is configured.'
    )
  }
  if (Object.values(parsed).some(Boolean)) {
    throw new Error('TEST evidence cannot make external claims.')
  }
  return parsed
}

export const verifyRecoveryPlan = (
  plan,
  { contract, expectedEnvironment, releaseManifest }
) => {
  verifyRecoveryContract(contract)
  verifyReleaseManifest(releaseManifest)
  assertExactKeys(
    plan,
    [
      'capabilities',
      'classification',
      'contractSha256',
      'environment',
      'environmentRegistrySha256',
      'externalClaims',
      'identities',
      'migrationDigestSha256',
      'migrationProfile',
      'recoveryObjectives',
      'releaseId',
      'releaseManifestSha256',
      'restoreTargetFingerprintSha256',
      'schemaVersion',
      'sourceTargetFingerprintSha256'
    ],
    'Recovery plan'
  )
  if (plan.schemaVersion !== 1) {
    throw new Error('Unsupported recovery plan schema.')
  }
  const environment = assertEnvironment(plan.environment)
  if (
    plan.classification !== contract.classifications[environment] ||
    environment !==
      assertEnvironment(expectedEnvironment, 'Expected environment')
  ) {
    throw new Error('Recovery plan environment mismatch.')
  }
  if (
    !contract.evidencePolicy.supportedVerifierEnvironments.includes(environment)
  ) {
    throw new Error(
      'Recovery plan verification is disabled for this environment.'
    )
  }
  if (plan.releaseId !== releaseManifest.releaseId) {
    throw new Error('Recovery plan release mismatch.')
  }
  if (plan.contractSha256 !== digestCanonicalJson(contract)) {
    throw new Error('Recovery contract digest mismatch.')
  }
  if (plan.releaseManifestSha256 !== digestCanonicalJson(releaseManifest)) {
    throw new Error('Recovery release manifest digest mismatch.')
  }
  assertSha256(plan.environmentRegistrySha256, 'Registry fingerprint')
  const sourceFingerprint = assertSha256(
    plan.sourceTargetFingerprintSha256,
    'Source target fingerprint'
  )
  const restoreFingerprint = assertSha256(
    plan.restoreTargetFingerprintSha256,
    'Restore target fingerprint'
  )
  if (sourceFingerprint === restoreFingerprint) {
    throw new Error('Restore target must be isolated from the source target.')
  }
  const identities = assertExactKeys(
    plan.identities,
    ['administrationSha256', 'migrationSha256', 'runtimeSha256'],
    'Recovery identities'
  )
  const identityValues = Object.values(identities).map((value) =>
    assertSha256(value, 'Identity fingerprint')
  )
  if (new Set(identityValues).size !== identityValues.length) {
    throw new Error('Recovery database identities must be separated.')
  }
  const objectives = assertExactKeys(
    plan.recoveryObjectives,
    ['retentionSeconds', 'rpoSeconds', 'rtoSeconds'],
    'Recovery objectives'
  )
  const rpo = assertPositiveInteger(
    objectives.rpoSeconds,
    604_800,
    'Recovery RPO'
  )
  assertPositiveInteger(objectives.rtoSeconds, 604_800, 'Recovery RTO')
  const retention = assertPositiveInteger(
    objectives.retentionSeconds,
    31_536_000,
    'Recovery retention'
  )
  if (retention < rpo) {
    throw new Error('Recovery retention cannot be shorter than RPO.')
  }
  const capabilities = assertExactKeys(
    plan.capabilities,
    [
      'adapterSlug',
      'automaticBackups',
      'isolatedRestore',
      'pointInTimeRecovery'
    ],
    'Recovery capabilities'
  )
  if (
    typeof capabilities.adapterSlug !== 'string' ||
    !ADAPTER_SLUG_PATTERN.test(capabilities.adapterSlug) ||
    typeof capabilities.automaticBackups !== 'boolean' ||
    typeof capabilities.isolatedRestore !== 'boolean' ||
    typeof capabilities.pointInTimeRecovery !== 'boolean'
  ) {
    throw new Error('Recovery capabilities are invalid.')
  }
  if (
    environment === 'TEST' &&
    (capabilities.automaticBackups || capabilities.pointInTimeRecovery)
  ) {
    throw new Error('TEST plan cannot claim external backup capabilities.')
  }
  if (
    !capabilities.isolatedRestore ||
    (environment !== 'TEST' &&
      (!capabilities.automaticBackups || !capabilities.pointInTimeRecovery))
  ) {
    throw new Error('Recovery plan capabilities are incomplete.')
  }
  verifyExternalClaims(plan.externalClaims, environment, 'Plan claims')

  const profile = deriveMigrationProfile(releaseManifest, plan.migrationProfile)
  const allowedEnvironments =
    contract.migrationProfiles[plan.migrationProfile]?.environments
  if (
    !allowedEnvironments?.includes(environment) ||
    plan.migrationDigestSha256 !== profile.digestSha256
  ) {
    throw new Error('Recovery migration profile mismatch.')
  }
  assertSafeEvidenceMaterial(plan)
  return plan
}

export const verifyBackupEvidence = (
  evidence,
  { contract, expectedEnvironment, now, plan, releaseManifest }
) => {
  verifyRecoveryPlan(plan, { contract, expectedEnvironment, releaseManifest })
  assertExactKeys(
    evidence,
    [
      'adapterObservationSha256',
      'backupReferenceSha256',
      'classification',
      'completedAt',
      'contentDigestSha256',
      'environment',
      'expiresAt',
      'externalClaims',
      'facts',
      'migrationDigestSha256',
      'migrationLedgerDigestSha256',
      'migrationProfile',
      'observedAt',
      'planSha256',
      'releaseId',
      'schemaVersion',
      'schemaDigestSha256',
      'sourceTargetFingerprintSha256',
      'startedAt',
      'status'
    ],
    'Backup evidence'
  )
  if (
    evidence.schemaVersion !== 1 ||
    evidence.status !== 'SUCCEEDED' ||
    evidence.environment !== expectedEnvironment ||
    evidence.classification !== contract.classifications[expectedEnvironment] ||
    evidence.releaseId !== plan.releaseId ||
    evidence.planSha256 !== digestCanonicalJson(plan) ||
    evidence.migrationProfile !== plan.migrationProfile ||
    evidence.migrationDigestSha256 !== plan.migrationDigestSha256 ||
    evidence.sourceTargetFingerprintSha256 !==
      plan.sourceTargetFingerprintSha256
  ) {
    throw new Error('Backup evidence binding mismatch.')
  }
  assertSha256(evidence.backupReferenceSha256, 'Backup reference')
  assertSha256(evidence.adapterObservationSha256, 'Adapter observation')
  assertSha256(evidence.contentDigestSha256, 'Backup content digest')
  assertSha256(evidence.schemaDigestSha256, 'Backup schema digest')
  if (
    assertSha256(
      evidence.migrationLedgerDigestSha256,
      'Backup migration ledger digest'
    ) !== plan.migrationDigestSha256
  ) {
    throw new Error('Backup migration ledger does not match the profile.')
  }
  const startedAt = assertCanonicalTimestamp(evidence.startedAt, 'Backup start')
  const completedAt = assertCanonicalTimestamp(
    evidence.completedAt,
    'Backup completion'
  )
  const observedAt = assertCanonicalTimestamp(
    evidence.observedAt,
    'Backup observation'
  )
  const expiresAt = assertCanonicalTimestamp(
    evidence.expiresAt,
    'Backup expiry'
  )
  const nowTime = now instanceof Date ? now.getTime() : Number.NaN
  if (
    Number.isNaN(nowTime) ||
    startedAt > completedAt ||
    completedAt > observedAt ||
    observedAt > nowTime ||
    nowTime - completedAt > plan.recoveryObjectives.rpoSeconds * 1_000 ||
    nowTime - observedAt > plan.recoveryObjectives.rpoSeconds * 1_000 ||
    observedAt - completedAt > plan.recoveryObjectives.rpoSeconds * 1_000 ||
    expiresAt - completedAt <
      plan.recoveryObjectives.retentionSeconds * 1_000 ||
    expiresAt <= nowTime
  ) {
    throw new Error('Backup timing or retention evidence is invalid.')
  }
  const facts = assertBooleanObject(
    evidence.facts,
    ['backupReadable', 'sourceQuiesced', 'zeroSourceMutations'],
    'Backup facts'
  )
  if (
    !facts.backupReadable ||
    !facts.sourceQuiesced ||
    !facts.zeroSourceMutations
  ) {
    throw new Error('Backup evidence facts are incomplete.')
  }
  verifyExternalClaims(
    evidence.externalClaims,
    expectedEnvironment,
    'Backup claims',
    { evidence: true }
  )
  assertSafeEvidenceMaterial(evidence)
  return evidence
}

export const verifyRestoreEvidence = (
  evidence,
  { backupEvidence, contract, expectedEnvironment, now, plan, releaseManifest }
) => {
  verifyBackupEvidence(backupEvidence, {
    contract,
    expectedEnvironment,
    now,
    plan,
    releaseManifest
  })
  assertExactKeys(
    evidence,
    [
      'backupEvidenceSha256',
      'classification',
      'completedAt',
      'digests',
      'durationMs',
      'environment',
      'externalClaims',
      'facts',
      'migrationDigestSha256',
      'migrationProfile',
      'planSha256',
      'releaseId',
      'releaseManifestSha256',
      'restoreTargetFingerprintSha256',
      'schemaVersion',
      'sourceTargetFingerprintSha256',
      'startedAt'
    ],
    'Restore evidence'
  )
  if (
    evidence.schemaVersion !== 1 ||
    evidence.environment !== expectedEnvironment ||
    evidence.classification !== contract.classifications[expectedEnvironment] ||
    evidence.releaseId !== plan.releaseId ||
    evidence.planSha256 !== digestCanonicalJson(plan) ||
    evidence.backupEvidenceSha256 !== digestCanonicalJson(backupEvidence) ||
    evidence.releaseManifestSha256 !== digestCanonicalJson(releaseManifest) ||
    evidence.migrationProfile !== plan.migrationProfile ||
    evidence.migrationDigestSha256 !== plan.migrationDigestSha256 ||
    evidence.sourceTargetFingerprintSha256 !==
      plan.sourceTargetFingerprintSha256 ||
    evidence.restoreTargetFingerprintSha256 !==
      plan.restoreTargetFingerprintSha256 ||
    evidence.sourceTargetFingerprintSha256 ===
      evidence.restoreTargetFingerprintSha256
  ) {
    throw new Error('Restore evidence binding mismatch.')
  }
  const startedAt = assertCanonicalTimestamp(
    evidence.startedAt,
    'Restore start'
  )
  const completedAt = assertCanonicalTimestamp(
    evidence.completedAt,
    'Restore completion'
  )
  const measuredDuration = completedAt - startedAt
  const nowTime = now instanceof Date ? now.getTime() : Number.NaN
  if (
    Number.isNaN(nowTime) ||
    startedAt < Date.parse(backupEvidence.observedAt) ||
    completedAt > nowTime ||
    completedAt > Date.parse(backupEvidence.expiresAt) ||
    !Number.isSafeInteger(evidence.durationMs) ||
    evidence.durationMs < 0 ||
    evidence.durationMs !== measuredDuration ||
    evidence.durationMs > plan.recoveryObjectives.rtoSeconds * 1_000
  ) {
    throw new Error('Restore duration violates the recovery objective.')
  }
  const digests = assertExactKeys(
    evidence.digests,
    [
      'restoreDataSha256',
      'restoreLedgerSha256',
      'restoreSchemaSha256',
      'sourceDataSha256',
      'sourceLedgerSha256',
      'sourceSchemaSha256'
    ],
    'Restore digests'
  )
  for (const digest of Object.values(digests)) {
    assertSha256(digest, 'Restore comparison digest')
  }
  if (
    digests.sourceSchemaSha256 !== backupEvidence.schemaDigestSha256 ||
    digests.restoreSchemaSha256 !== backupEvidence.schemaDigestSha256 ||
    digests.sourceDataSha256 !== backupEvidence.contentDigestSha256 ||
    digests.restoreDataSha256 !== backupEvidence.contentDigestSha256 ||
    digests.sourceLedgerSha256 !== backupEvidence.migrationLedgerDigestSha256 ||
    digests.restoreLedgerSha256 !==
      backupEvidence.migrationLedgerDigestSha256 ||
    digests.sourceLedgerSha256 !== plan.migrationDigestSha256
  ) {
    throw new Error('Restore content or ledger digest mismatch.')
  }
  const facts = assertBooleanObject(
    evidence.facts,
    [
      'cleanupCompleted',
      'emptyTargetVerified',
      'isolatedTarget',
      'migrationLedgerCompatible',
      'privateDataObserved',
      'readinessCompatible',
      'runtimeRoleReadVerified',
      'zeroSourceMutations'
    ],
    'Restore facts'
  )
  if (
    !facts.cleanupCompleted ||
    !facts.emptyTargetVerified ||
    !facts.isolatedTarget ||
    !facts.migrationLedgerCompatible ||
    facts.privateDataObserved ||
    !facts.readinessCompatible ||
    !facts.runtimeRoleReadVerified ||
    !facts.zeroSourceMutations
  ) {
    throw new Error('Restore evidence facts are incomplete.')
  }
  verifyExternalClaims(
    evidence.externalClaims,
    expectedEnvironment,
    'Restore claims',
    { evidence: true }
  )
  assertSafeEvidenceMaterial(evidence)
  return evidence
}
