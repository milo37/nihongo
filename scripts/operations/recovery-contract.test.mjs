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

test('migration profiles separate exact physical 69 TEST entries from the exact v1 runtime 27', () => {
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
  assert.deepEqual(releaseManifest.migrations.entries[49], {
    name: '20261028150000_sso_provider_cleanup_fencing',
    sha256: '394b548011a5021a5d63c39ab6e6a425069aa005f5018a3ef2652336aabd449e'
  })
  assert.deepEqual(releaseManifest.migrations.entries[50], {
    name: '20261028160000_study_contract_v2_default',
    sha256: '3b2dd4b6186d0f3603942a3de324cea3041e6fb0cd395eb9fc49f57c9e86a858'
  })
  assert.deepEqual(releaseManifest.migrations.entries[51], {
    name: '20261028170000_study_v1_retirement_authority',
    sha256: '622c83d394d779d0eb9f96baedbf8a81ab97d385c09fd99f82efa4e59905eb82'
  })
  assert.deepEqual(releaseManifest.migrations.entries[52], {
    name: '20261030100000_guest_expired_draft_retention',
    sha256: '5708fd94835c6ce970049b1830d44dca2e10e9c089f54383aa67219218fb81f7'
  })
  assert.deepEqual(releaseManifest.migrations.entries[53], {
    name: '20261104090000_unified_reports_import_results',
    sha256: 'aee02806b846d61c64d35e0c873475e25880e82bd72029853fa23ff7742f8042'
  })
  assert.deepEqual(releaseManifest.migrations.entries[54], {
    name: '20261104120000_user_report_erasure_redaction',
    sha256: '99bdb0fecdcfe27d13850bb106af9fbcbb88c2a8cd79d7d6ae355f1db530efa8'
  })
  assert.deepEqual(releaseManifest.migrations.entries[55], {
    name: '20261104150000_user_account_restriction',
    sha256: '26762221ae1b1ad9636138825453e4664c46e03128db394fbe77ec13ba1532cc'
  })
  assert.deepEqual(releaseManifest.migrations.entries[56], {
    name: '20261105090000_admin_member_console',
    sha256: 'a109890b8c812fa5b74c159b2f99f15c955ee6735ac8d1126b597881eb562de9'
  })
  assert.deepEqual(releaseManifest.migrations.entries[57], {
    name: '20261106090000_single_operator_review',
    sha256: 'f569efc31c2638a23c2870ded6a8140aabb7be90aff57a2f02d740392f6fc6d1'
  })
  assert.deepEqual(releaseManifest.migrations.entries[58], {
    name: '20261107090000_drop_study_review_triggers',
    sha256: '287d1ff5811f16849738919c4492ea5af59540d5be1c7f133d4646e2ff44d2b4'
  })
  assert.deepEqual(releaseManifest.migrations.entries[59], {
    name: '20261108090000_admin_member_console_to_api',
    sha256: 'fc5db8ea94e3197b32722e3ed762d41ce1e85c834c4ee4bb7588d98e46ff2003'
  })
  assert.deepEqual(releaseManifest.migrations.entries[60], {
    name: '20261109090000_guest_cleanup_to_api',
    sha256: '3d125f629132d5333b4d618977ef7310f4bbd73c5fbceebcd844fa9e7cb1f34b'
  })
  const historical60 = structuredClone(releaseManifest)
  historical60.migrations.count = 60
  historical60.migrations.digestSha256 =
    '5994f49b88fd775cf4045a7e2ab62d36135f0b6bbf93722bcc377ba9c4b329b6'
  historical60.migrations.entries = historical60.migrations.entries.slice(0, 60)
  assert.throws(
    () => deriveMigrationProfile(historical60, 'technical-current-test'),
    /count mismatch/u
  )
  assert.deepEqual(releaseManifest.migrations.entries[61], {
    name: '20261110090000_cms_rules_to_api',
    sha256: '97fd8b1a45ee987410d4909b8ae3f3a3b053d07ea1f4fecd0d39c0d4f58c1d8b'
  })
  assert.deepEqual(releaseManifest.migrations.entries[62], {
    name: '20261110100000_admin_audit_to_api',
    sha256: '2af5e1b565e20ee5fb5d6cd1e798112b6753f7a1a1f7c0981c9909352b5a9b90'
  })
  const historical61 = structuredClone(releaseManifest)
  historical61.migrations.count = 61
  historical61.migrations.digestSha256 =
    '5dd1426b9b218d351aa9ff7f0e7700d5a98a3930015f80ad5a048592c97b365b'
  historical61.migrations.entries = historical61.migrations.entries.slice(0, 61)
  assert.throws(
    () => deriveMigrationProfile(historical61, 'technical-current-test'),
    /count mismatch/u
  )
  const historical62 = structuredClone(releaseManifest)
  historical62.migrations.count = 62
  historical62.migrations.digestSha256 =
    '8b6344b8ea9b0e70156d55ad0adbbb00cd5c9dcb499284f69d221ddd5239dcaf'
  historical62.migrations.entries = historical62.migrations.entries.slice(0, 62)
  assert.throws(
    () => deriveMigrationProfile(historical62, 'technical-current-test'),
    /count mismatch/u
  )
  assert.deepEqual(releaseManifest.migrations.entries[63], {
    name: '20261110110000_drop_retired_credential_auth',
    sha256: '020323b0eeecd24d967de372418096409126b3ff868df16a6a5a30477dd03c84'
  })
  const historical63 = structuredClone(releaseManifest)
  historical63.migrations.count = 63
  historical63.migrations.digestSha256 =
    'c4ea76ba29a90169872d0a8e26412d1134d2e834f06609faba2bcafad7c9619f'
  historical63.migrations.entries = historical63.migrations.entries.slice(0, 63)
  assert.throws(
    () => deriveMigrationProfile(historical63, 'technical-current-test'),
    /count mismatch/u
  )
  assert.deepEqual(releaseManifest.migrations.entries[64], {
    name: '20261111090000_drop_dead_reauthentication',
    sha256: '38112f77708f18f8c1653baf305fb1925585e67f142c8601e0b2667d404ac154'
  })
  const historical64 = structuredClone(releaseManifest)
  historical64.migrations.count = 64
  historical64.migrations.digestSha256 =
    '35cdf2e7f71f6851ac63aea0af1b8075d86c9b2aa1f9b33a9c7e56d24eaf382d'
  historical64.migrations.entries = historical64.migrations.entries.slice(0, 64)
  assert.throws(
    () => deriveMigrationProfile(historical64, 'technical-current-test'),
    /count mismatch/u
  )
  assert.deepEqual(releaseManifest.migrations.entries[65], {
    name: '20261112090000_merge_runtime_roles',
    sha256: '3b07241f98ba2f8f8087ece67d522d8b542a1b10e408191e402fd477f8a019f7'
  })
  const historical65 = structuredClone(releaseManifest)
  historical65.migrations.count = 65
  historical65.migrations.digestSha256 =
    '8c9e7821338db7ac499fac7ae4d5efd475babc7b141b93bbec80654a7c64d71c'
  historical65.migrations.entries = historical65.migrations.entries.slice(0, 65)
  assert.throws(
    () => deriveMigrationProfile(historical65, 'technical-current-test'),
    /count mismatch/u
  )
  assert.deepEqual(releaseManifest.migrations.entries[66], {
    name: '20261113090000_admin_operation_to_api',
    sha256: 'b6fa895ed7f6341ba12341a65cb7acc1099f14d111b16f921ee2687595f05259'
  })
  const historical66 = structuredClone(releaseManifest)
  historical66.migrations.count = 66
  historical66.migrations.digestSha256 =
    '3d2a2bc45a6a9556ac1eb273f6e0c5f90e2bb158e6f1d12f52939c53d59bb23c'
  historical66.migrations.entries = historical66.migrations.entries.slice(0, 66)
  assert.throws(
    () => deriveMigrationProfile(historical66, 'technical-current-test'),
    /count mismatch/u
  )
  assert.deepEqual(releaseManifest.migrations.entries[67], {
    name: '20261114090000_session_issuance_to_api',
    sha256: '943912fc8ba9cd4a45c7b3b8d5a162b1cf30ddd915bbb1d46ba37587f27ec98b'
  })
  const historical67 = structuredClone(releaseManifest)
  historical67.migrations.count = 67
  historical67.migrations.digestSha256 =
    '97a17f9613955e3464f05935fe62f6b1d6be94418afb5b890eb3e9bff24e9a86'
  historical67.migrations.entries = historical67.migrations.entries.slice(0, 67)
  assert.throws(
    () => deriveMigrationProfile(historical67, 'technical-current-test'),
    /count mismatch/u
  )
  assert.deepEqual(releaseManifest.migrations.entries[68], {
    name: '20261115090000_admin_fresh_to_api',
    sha256: '7aaf82930f063aab481d5618dde13c90fc319f4b6d22b9d4815266168cfb9b63'
  })
  const historical68 = structuredClone(releaseManifest)
  historical68.migrations.count = 68
  historical68.migrations.digestSha256 =
    '94c50ed8c75f42c2fc0bd50f6278365288b910048ecae93c3bf2c627b3cec109'
  historical68.migrations.entries = historical68.migrations.entries.slice(0, 68)
  assert.throws(
    () => deriveMigrationProfile(historical68, 'technical-current-test'),
    /count mismatch/u
  )
  const historical59 = structuredClone(releaseManifest)
  historical59.migrations.count = 59
  historical59.migrations.digestSha256 =
    '87a2ac0933184eb700be1f564d47e83f720fe370e612b92b8adf478f9f7811fb'
  historical59.migrations.entries = historical59.migrations.entries.slice(0, 59)
  assert.throws(
    () => deriveMigrationProfile(historical59, 'technical-current-test'),
    /count mismatch/u
  )
  const historical58 = structuredClone(releaseManifest)
  historical58.migrations.count = 58
  historical58.migrations.digestSha256 =
    '13da74f7dd883ce43d36f9f532dbc41652a84c0eb4b8f812607f1ca622be578c'
  historical58.migrations.entries = historical58.migrations.entries.slice(0, 58)
  assert.throws(
    () => deriveMigrationProfile(historical58, 'technical-current-test'),
    /count mismatch/u
  )
  const historical57 = structuredClone(releaseManifest)
  historical57.migrations.count = 57
  historical57.migrations.digestSha256 =
    '64f4e4765c22cfbb06a9dcc36ab8f3ec707bd18741614c7327fcc6c7472aedb0'
  historical57.migrations.entries = historical57.migrations.entries.slice(0, 57)
  assert.throws(
    () => deriveMigrationProfile(historical57, 'technical-current-test'),
    /count mismatch/u
  )
  const historical56 = structuredClone(releaseManifest)
  historical56.migrations.count = 56
  historical56.migrations.digestSha256 =
    '6682d553434a2836173cc114cdbc664b0cdfc9b9c1e8580397d74c0a930aaa02'
  historical56.migrations.entries = historical56.migrations.entries.slice(0, 56)
  assert.throws(
    () => deriveMigrationProfile(historical56, 'technical-current-test'),
    /count mismatch/u
  )
  const historical55 = structuredClone(releaseManifest)
  historical55.migrations.count = 55
  historical55.migrations.digestSha256 =
    '4ced7adc2cb49210ad05dd09ec77238d5d3f784a27a5fc2182702de3531595b2'
  historical55.migrations.entries = historical55.migrations.entries.slice(0, 55)
  assert.throws(
    () => deriveMigrationProfile(historical55, 'technical-current-test'),
    /count mismatch/u
  )
  const historical53 = structuredClone(releaseManifest)
  historical53.migrations.count = 53
  historical53.migrations.digestSha256 =
    '39d9c2053323d8a180e53af80e81dd26a00ef6c041040dc7ccea8e99932e9c08'
  historical53.migrations.entries = historical53.migrations.entries.slice(0, 53)
  assert.throws(
    () => deriveMigrationProfile(historical53, 'technical-current-test'),
    /count mismatch/u
  )
  const historical52 = structuredClone(releaseManifest)
  historical52.migrations.count = 52
  historical52.migrations.digestSha256 =
    '454ffc17fda1ccdf18ad870bd019d816c48c69fcff7b5ce9e7fed2f9ba42dec6'
  historical52.migrations.entries = historical52.migrations.entries.slice(0, 52)
  assert.throws(
    () => deriveMigrationProfile(historical52, 'technical-current-test'),
    /count mismatch/u
  )
  const historical50 = structuredClone(releaseManifest)
  historical50.migrations.count = 50
  historical50.migrations.entries = historical50.migrations.entries.slice(0, 50)
  historical50.migrations.digestSha256 =
    '299d197f8d062554585b3566f981583af832c1799f232bea4f60ac3d8e157083'
  assert.throws(
    () => deriveMigrationProfile(historical50, 'technical-current-test'),
    /migration profile count mismatch/u
  )
  const historical49 = structuredClone(releaseManifest)
  historical49.migrations.count = 49
  historical49.migrations.entries = historical49.migrations.entries.slice(0, 49)
  historical49.migrations.digestSha256 =
    '53c9dd466345b5776e2a6b9a6f57ce78b843f1d2638a26a9c90caa7f520a1392'
  assert.throws(
    () => deriveMigrationProfile(historical49, 'technical-current-test'),
    /migration profile count mismatch/u
  )
  assert.deepEqual(
    deriveMigrationProfile(releaseManifest, 'technical-current-test'),
    {
      count: 69,
      digestSha256:
        'db6f7ae76b061ccf68856d127340bf9f651de0876cd6b8a15a29b3fad95fc8fb',
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
        name: '20261115090001_unreviewed_migration',
        sha256: 'a'.repeat(64)
      })
    } else if (change === 'rename') {
      inventoryDrift.migrations.entries.at(-1).name =
        '20261115090001_unreviewed_migration'
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
