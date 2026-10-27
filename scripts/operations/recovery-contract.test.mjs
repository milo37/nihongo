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

test('migration profiles separate exact physical 49 TEST entries from the exact v1 runtime 27', () => {
  const { releaseManifest } = createRecoveryFixtures()

  assert.deepEqual(releaseManifest.migrations.entries[37], {
    name: '20261009120000_phase7_approved_n4_reading_batch7_tags',
    sha256: 'd4d2caac296296fd941b7631cf6cf7016da2b1be1f764c01386d1d2b1413d806'
  })
  assert.deepEqual(releaseManifest.migrations.entries[38], {
    name: '20261010071000_phase7_approved308_tags',
    sha256: '600dd3ab067f2af20bb04ecf1dd0f7c30eb18c6c32eb8ab03d746735fa0b0401'
  })
  assert.deepEqual(releaseManifest.migrations.entries[46], {
    name: '20261020233000_sso_first_admin_bootstrap',
    sha256: '680ce338ea94f47d1da21c4945270d36b7c39ae60dabf0040da4310c576e90f5'
  })
  assert.deepEqual(releaseManifest.migrations.entries[47], {
    name: '20261028090000_sso_account_erasure_worker_queue',
    sha256: 'cc91bd854924b2261ac4dcb2e8036ad62c69ec0af8d5afe756d4ce7f9ed5d8d7'
  })
  assert.deepEqual(releaseManifest.migrations.entries[48], {
    name: '20261028120000_sso_account_erasure_claim_lease',
    sha256: 'bb1075457d171fe0ddc4643e63b8646a27a7cf4087b4aeebe2d151beb3633846'
  })
  assert.deepEqual(
    deriveMigrationProfile(releaseManifest, 'technical-current-test'),
    {
      count: 49,
      digestSha256:
        '53c9dd466345b5776e2a6b9a6f57ce78b843f1d2638a26a9c90caa7f520a1392',
      name: 'technical-current-test'
    }
  )
  const runtime = deriveMigrationProfile(
    releaseManifest,
    'v1-runtime-pre-phase7'
  )
  assert.equal(runtime.count, 27)
  assert.equal(
    runtime.digestSha256,
    '6870a93dd141b7a6c226de7aeed315d48ce313828c82bb92f91bf8a8861ed2ea'
  )
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

test('technical recovery rejects stale and unexpected migration inventories', () => {
  const { contract, releaseManifest } = createRecoveryFixtures()
  const forwardCorrection = '20261009092000_phase7_n4_n2_revision2_digest_fix'
  const batch7Tags = '20261009120000_phase7_approved_n4_reading_batch7_tags'
  const approved308Tags = '20261010071000_phase7_approved308_tags'
  // Historical test metadata only; never rewrite an applied SQL file.
  const historicalPhysical38 = releaseManifest.migrations.entries
    .slice(0, 39)
    .filter(({ name }) => name !== approved308Tags)
    .map((entry) =>
      entry.name === batch7Tags
        ? {
            ...entry,
            sha256:
              '01ae675a719ccc08854135efd4057f95659d671d04addf40d5c45ba26c850f12'
          }
        : entry
    )
  const digestEntries = (entries) =>
    createHash('sha256')
      .update(
        entries.map(({ name, sha256 }) => `${name}\0${sha256}\n`).join('')
      )
      .digest('hex')
  assert.equal(historicalPhysical38.length, 38)
  assert.equal(
    digestEntries(historicalPhysical38),
    'fae541796dc4e4a3afbd05c9c0af39fbad11bdecc4385bd393092fafea8c62b9'
  )
  for (const staleProfile of [
    { expectedCount: 48 },
    {
      expectedDigestSha256:
        'a1ff76baa1b6a00920a0699436fe78f7ac51af8b8f939fa40d136c5ac1535630'
    },
    {
      expectedCount: 48,
      expectedDigestSha256:
        'a1ff76baa1b6a00920a0699436fe78f7ac51af8b8f939fa40d136c5ac1535630'
    },
    {
      expectedCount: 38,
      expectedDigestSha256:
        'fae541796dc4e4a3afbd05c9c0af39fbad11bdecc4385bd393092fafea8c62b9'
    },
    {
      expectedCount: 38,
      expectedDigestSha256:
        '6aa49828fc3138b2b544830794cad68c05ed11ae2ffa018b9e43a2800cb578dd'
    },
    {
      expectedCount: 38,
      expectedDigestSha256:
        '0169f4d0491d4e33f917df842cdeb26920edc2e7f02f8b0d41159cd132320f3b'
    },
    {
      expectedCount: 39,
      expectedDigestSha256: 'a'.repeat(64)
    },
    { expectedCount: 31 },
    {
      expectedDigestSha256:
        '3efd321d7d66f31505c0887f3ef9b0bb64dbe89831d70ea132066fba24b63aea'
    },
    {
      expectedCount: 32,
      expectedDigestSha256:
        '3b631dcd9b20b145adabdf051a8ac0fe7d1143145080fad6f035f05101b11625'
    },
    {
      expectedCount: 34,
      expectedDigestSha256:
        '4448f7aa40804bb3058f1a986c6af5527eb26ca7375973bcca320fa1bf51d7f8'
    },
    {
      expectedCount: 35,
      expectedDigestSha256:
        '6ce3cb9d17492c2806fab8e03b923b9440da30ca6be9b10c5a978abc1bd5d8a8'
    },
    {
      expectedCount: 35,
      expectedDigestSha256:
        'b1599310da408668bd4617f35ebc47109cb6e23d91e23dd737eaff521d49a393'
    },
    {
      expectedCount: 27,
      expectedDigestSha256:
        '6870a93dd141b7a6c226de7aeed315d48ce313828c82bb92f91bf8a8861ed2ea'
    },
    {
      expectedCount: 36,
      expectedDigestSha256:
        'b1599310da408668bd4617f35ebc47109cb6e23d91e23dd737eaff521d49a393'
    },
    {
      expectedCount: 36,
      expectedDigestSha256:
        '8b9f35ed93aa7179cf5405a49039a10ff3f484171c54a33efbd1018b0494b02f'
    },
    {
      expectedCount: 36,
      expectedDigestSha256:
        '96eebebc8d76d1eb858b1cc12d7559685a5e06559a57ff8d9aabdf3b067e3ab3'
    },
    {
      expectedCount: 37,
      expectedDigestSha256:
        '8b9f35ed93aa7179cf5405a49039a10ff3f484171c54a33efbd1018b0494b02f'
    },
    {
      expectedCount: 37,
      expectedDigestSha256:
        '96eebebc8d76d1eb858b1cc12d7559685a5e06559a57ff8d9aabdf3b067e3ab3'
    },
    {
      expectedCount: 37,
      expectedDigestSha256: 'a'.repeat(64)
    },
    {
      expectedCount: 37,
      expectedDigestSha256:
        '89158202b48454a0d179913983fe1449dc139c0db25aec0ba4c5480040291aad'
    },
    {
      expectedCount: 37,
      expectedDigestSha256:
        '79bd5eb74c70780169cf672d330b605a89ed52d4cffd6bc130d77c7aff70577d'
    },
    {
      expectedCount: 38,
      expectedDigestSha256:
        '79bd5eb74c70780169cf672d330b605a89ed52d4cffd6bc130d77c7aff70577d'
    },
    {
      expectedCount: 38,
      expectedDigestSha256: 'a'.repeat(64)
    }
  ]) {
    const staleContract = structuredClone(contract)
    Object.assign(
      staleContract.migrationProfiles['technical-current-test'],
      staleProfile
    )
    assert.throws(
      () => verifyRecoveryContract(staleContract),
      /Technical migration profile is invalid/u
    )
  }

  for (const [count, entries, digestSha256] of [
    [
      46,
      releaseManifest.migrations.entries.slice(0, 46),
      '5457abb5b6fd6d2b0a839402479c643bd74d5e6878fd7763881abc440248d2aa'
    ],
    [
      39,
      releaseManifest.migrations.entries.slice(0, 39),
      '611c2ec676b54bc333706d2401775c242e5d65886c9eb8cb255f15d13dfbc0c1'
    ],
    [
      38,
      historicalPhysical38,
      'fae541796dc4e4a3afbd05c9c0af39fbad11bdecc4385bd393092fafea8c62b9'
    ],
    [
      37,
      releaseManifest.migrations.entries.slice(0, 37),
      '89158202b48454a0d179913983fe1449dc139c0db25aec0ba4c5480040291aad'
    ],
    [
      38,
      releaseManifest.migrations.entries.slice(0, 38),
      '6aa49828fc3138b2b544830794cad68c05ed11ae2ffa018b9e43a2800cb578dd'
    ],
    [
      38,
      releaseManifest.migrations.entries
        .slice(0, 39)
        .filter(
          ({ name }) =>
            name !== '20261005183000_phase7_reviewed_catalog_current'
        ),
      '0169f4d0491d4e33f917df842cdeb26920edc2e7f02f8b0d41159cd132320f3b'
    ],
    [
      32,
      historicalPhysical38.slice(0, 32),
      '3b631dcd9b20b145adabdf051a8ac0fe7d1143145080fad6f035f05101b11625'
    ],
    [
      34,
      historicalPhysical38.filter(
        ({ name }) =>
          name !== '20261005183000_phase7_reviewed_catalog_current' &&
          name !== '20261009072500_phase7_approved_n4_n2_reading_tags' &&
          name !== forwardCorrection &&
          name !== batch7Tags
      ),
      '4448f7aa40804bb3058f1a986c6af5527eb26ca7375973bcca320fa1bf51d7f8'
    ],
    [
      35,
      historicalPhysical38.filter(
        ({ name }) =>
          name !== '20261009072500_phase7_approved_n4_n2_reading_tags' &&
          name !== forwardCorrection &&
          name !== batch7Tags
      ),
      '6ce3cb9d17492c2806fab8e03b923b9440da30ca6be9b10c5a978abc1bd5d8a8'
    ],
    [
      35,
      historicalPhysical38.filter(
        ({ name }) =>
          name !== '20261005183000_phase7_reviewed_catalog_current' &&
          name !== forwardCorrection &&
          name !== batch7Tags
      ),
      'b1599310da408668bd4617f35ebc47109cb6e23d91e23dd737eaff521d49a393'
    ],
    [
      36,
      historicalPhysical38.filter(
        ({ name }) => name !== forwardCorrection && name !== batch7Tags
      ),
      '8b9f35ed93aa7179cf5405a49039a10ff3f484171c54a33efbd1018b0494b02f'
    ],
    [
      36,
      historicalPhysical38.filter(
        ({ name }) =>
          name !== '20261005183000_phase7_reviewed_catalog_current' &&
          name !== batch7Tags
      ),
      '96eebebc8d76d1eb858b1cc12d7559685a5e06559a57ff8d9aabdf3b067e3ab3'
    ],
    [
      37,
      historicalPhysical38.filter(({ name }) => name !== batch7Tags),
      '89158202b48454a0d179913983fe1449dc139c0db25aec0ba4c5480040291aad'
    ],
    [
      37,
      historicalPhysical38.filter(
        ({ name }) => name !== '20261005183000_phase7_reviewed_catalog_current'
      ),
      '79bd5eb74c70780169cf672d330b605a89ed52d4cffd6bc130d77c7aff70577d'
    ]
  ]) {
    const staleManifest = structuredClone(releaseManifest)
    staleManifest.migrations.entries = entries
    staleManifest.migrations.count = entries.length
    staleManifest.migrations.digestSha256 = createHash('sha256')
      .update(
        entries.map(({ name, sha256 }) => `${name}\0${sha256}\n`).join('')
      )
      .digest('hex')
    assert.equal(staleManifest.migrations.count, count)
    assert.equal(staleManifest.migrations.digestSha256, digestSha256)
    assert.throws(
      () => deriveMigrationProfile(staleManifest, 'technical-current-test'),
      /Technical migration profile count mismatch/u
    )
    assert.deepEqual(
      deriveMigrationProfile(staleManifest, 'v1-runtime-pre-phase7'),
      deriveMigrationProfile(releaseManifest, 'v1-runtime-pre-phase7')
    )
  }

  const runtimeManifest = structuredClone(releaseManifest)
  runtimeManifest.migrations.entries = releaseManifest.migrations.entries.slice(
    0,
    27
  )
  runtimeManifest.migrations.count = 27
  runtimeManifest.migrations.digestSha256 =
    '6870a93dd141b7a6c226de7aeed315d48ce313828c82bb92f91bf8a8861ed2ea'
  assert.throws(
    () => deriveMigrationProfile(runtimeManifest, 'technical-current-test'),
    /Technical migration profile count mismatch/u
  )
  assert.throws(
    () => deriveMigrationProfile(releaseManifest, 'canonical-current-test'),
    /Unsupported recovery migration profile/u
  )

  for (const change of [
    'remove',
    'add',
    'rewrite',
    'rewrite-batch7',
    'rename'
  ]) {
    const inventoryDrift = structuredClone(releaseManifest)
    if (change === 'remove') {
      inventoryDrift.migrations.entries.pop()
    } else if (change === 'add') {
      inventoryDrift.migrations.entries.push({
        name: '20261028120001_unreviewed_migration',
        sha256: 'a'.repeat(64)
      })
    } else if (change === 'rename') {
      inventoryDrift.migrations.entries.at(-1).name =
        '20261028120001_unreviewed_migration'
    } else if (change === 'rewrite-batch7') {
      inventoryDrift.migrations.entries.find(
        ({ name }) => name === batch7Tags
      ).sha256 =
        '01ae675a719ccc08854135efd4057f95659d671d04addf40d5c45ba26c850f12'
    } else {
      inventoryDrift.migrations.entries.at(-1).sha256 = 'a'.repeat(64)
    }
    inventoryDrift.migrations.count = inventoryDrift.migrations.entries.length
    inventoryDrift.migrations.digestSha256 = createHash('sha256')
      .update(
        inventoryDrift.migrations.entries
          .map(({ name, sha256 }) => `${name}\0${sha256}\n`)
          .join('')
      )
      .digest('hex')
    assert.throws(
      () => deriveMigrationProfile(inventoryDrift, 'technical-current-test'),
      /Technical migration profile count mismatch|Recovery migration profile inventory mismatch/u
    )
    assert.deepEqual(
      deriveMigrationProfile(inventoryDrift, 'v1-runtime-pre-phase7'),
      deriveMigrationProfile(releaseManifest, 'v1-runtime-pre-phase7')
    )
  }

  const reordered = structuredClone(releaseManifest)
  reordered.migrations.entries.reverse()
  reordered.migrations.digestSha256 = createHash('sha256')
    .update(
      reordered.migrations.entries
        .map(({ name, sha256 }) => `${name}\0${sha256}\n`)
        .join('')
    )
    .digest('hex')
  assert.throws(
    () => deriveMigrationProfile(reordered, 'technical-current-test'),
    /Invalid migration entry/u
  )
})

test('recovery plan is deterministic, registry-committed, self-attested and identity-separated', () => {
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

test('registry digest drift changes the plan commitment and invalidates evidence', () => {
  const { backupEvidence, contract, now, plan, releaseManifest } =
    createRecoveryFixtures()
  const registryDrift = {
    ...plan,
    environmentRegistrySha256: 'f'.repeat(64)
  }

  assert.notEqual(digestCanonicalJson(registryDrift), digestCanonicalJson(plan))
  assert.throws(
    () =>
      verifyBackupEvidence(backupEvidence, {
        contract,
        expectedEnvironment: 'TEST',
        now,
        plan: registryDrift,
        releaseManifest
      }),
    /binding mismatch/u
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
