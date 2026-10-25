import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)
const readText = (relativePath) =>
  readFile(path.join(repositoryRoot, relativePath), 'utf8')
const readJson = async (relativePath) =>
  JSON.parse(await readText(relativePath))

const [
  rootPackage,
  apiPackage,
  contractsPackage,
  domainPackage,
  workflow,
  dockerfile,
  environmentContract,
  recoveryContract,
  recoveryRunbook,
  dockerignore,
  serverSource,
  webViteConfig,
  sharedBrowserViteConfig
] = await Promise.all([
  readJson('package.json'),
  readJson('apps/api/package.json'),
  readJson('packages/contracts/package.json'),
  readJson('packages/domain/package.json'),
  readText('.github/workflows/ci.yml'),
  readText('Dockerfile'),
  readJson('operations/environment-contract.v1.json'),
  readJson('operations/recovery-contract.v1.json'),
  readText('operations/runbooks/recovery.v1.md'),
  readText('.dockerignore'),
  readText('apps/api/src/server.ts'),
  readText('apps/web/vite.config.ts'),
  readText('packages/browser/vite.config.ts')
])

const assertInOrder = (text, fragments) => {
  let previousIndex = -1
  for (const fragment of fragments) {
    const index = text.indexOf(fragment)
    assert.ok(index > previousIndex, `${fragment} must appear in order`)
    previousIndex = index
  }
}

test('Phase 11 scripts expose manifest, static and smoke boundaries', () => {
  assert.equal(
    rootPackage.scripts['test:phase11:static'],
    'node --test scripts/operations/*.test.mjs scripts/phase11-ci-contract.test.mjs'
  )
  assert.equal(
    rootPackage.scripts['release:manifest'],
    'node scripts/operations/release-manifest.mjs'
  )
  assert.equal(
    rootPackage.scripts['release:evidence'],
    'node scripts/operations/oci-evidence.mjs'
  )
  assert.equal(
    rootPackage.scripts['release:runtime-smoke'],
    'node scripts/operations/portable-runtime-smoke.mjs'
  )
  assert.equal(
    rootPackage.scripts['release:smoke'],
    'node scripts/operations/post-deploy-smoke.mjs'
  )
  assert.equal(
    rootPackage.scripts['test:phase11:recovery'],
    'node --test scripts/operations/recovery-*.test.mjs'
  )
  assert.equal(
    rootPackage.scripts['recovery:verify'],
    'node scripts/operations/recovery-evidence.mjs'
  )
})

test('portable package uses explicit first-party allowlists and production dotenv', () => {
  assert.deepEqual(apiPackage.files, ['dist', 'prisma/migrations'])
  assert.deepEqual(contractsPackage.files, ['dist'])
  assert.deepEqual(domainPackage.files, ['dist'])
  assert.equal(apiPackage.dependencies.dotenv, '17.4.2')
  assert.equal(apiPackage.devDependencies?.dotenv, undefined)
})

test('Docker context excludes generated and operational scratch state', () => {
  for (const ignoredPath of [
    '**/.pnpm-store/**',
    '**/src/generated/**',
    'apps/api/.migration-ledger-*',
    'content/policies/.activation-finalize-claims/**',
    'content/.tracked-artifact-staging/**'
  ]) {
    assert.match(
      dockerignore,
      new RegExp(`^${ignoredPath.replaceAll('*', '\\*')}$`, 'mu')
    )
  }
})

test('CI triggers Phase 11 and verifies a safe manifest without deploying', () => {
  assert.equal(
    workflow.match(/^ {2}push:\n {4}branches:\n((?: {6}- [^\n]+\n)+)/mu)?.[1],
    '      - main\n      - dev\n'
  )
  const buildJob = workflow.slice(
    workflow.indexOf('\n  build:'),
    workflow.indexOf('\n  e2e:')
  )
  const releaseJob = workflow.slice(workflow.indexOf('\n  phase11_release:'))

  assert.doesNotMatch(
    buildJob,
    /Build and verify portable Phase 11 OCI release/u
  )
  assert.doesNotMatch(releaseJob, /^ {4}needs:/mu)
  assert.doesNotMatch(releaseJob, /\bneeds\./u)
  assertInOrder(releaseJob, [
    'test -z "$(git status --porcelain --untracked-files=all)"',
    'docker build --build-arg',
    'pnpm run release:evidence --mode verify',
    'pnpm run db:generate',
    'pnpm run release:runtime-smoke --image'
  ])
  assert.equal(releaseJob.split('pnpm run db:generate').length - 1, 1)

  assertInOrder(workflow, [
    'run: pnpm run test:phase10:static',
    'run: pnpm run test:phase11:static',
    'run: pnpm run test:phase10:security',
    'run: pnpm run test\n',
    'run: pnpm run build',
    'run: pnpm run content:foundation-check:static',
    'run: pnpm run test:phase10:performance',
    'name: Phase 10 canonical mock browser acceptance',
    'phase11_release:',
    'name: Build and verify portable Phase 11 OCI release',
    'pnpm run release:runtime-smoke',
    'pnpm run release:runtime-smoke --mode verify',
    'name: Upload safe Phase 11 release evidence',
    'name: Clean Phase 11 release and evidence'
  ])
  assert.match(
    workflow,
    /docker build --build-arg "RELEASE_ID=\$\{GITHUB_SHA\}" --tag "\$PHASE11_IMAGE_TAG" \./u
  )
  assert.match(workflow, /install -d -m 700 "\$PHASE11_RELEASE_EVIDENCE_DIR"/u)
  assert.match(
    workflow,
    /docker cp "\$PHASE11_CONTAINER_NAME:\/app\/release-manifest\.json"/u
  )
  assert.match(workflow, /pnpm run release:evidence --mode create/u)
  assert.match(
    workflow,
    /pnpm run release:runtime-smoke --image "\$image_id" --expected-image-id "\$image_id" --release-id "\$GITHUB_SHA"/u
  )
  assert.match(
    workflow,
    /pnpm run release:runtime-smoke --mode verify --expected-image-id "\$image_id"/u
  )
  assert.doesNotMatch(workflow, /pnpm run release:[^\n]+ -- --/u)
  assert.match(workflow, /runtime-smoke\.json/u)
  assert.match(
    workflow,
    /for name in release-manifest\.json oci-evidence\.json runtime-smoke\.json/u
  )
  assert.match(workflow, /stat -c '%a'/u)
  assert.doesNotMatch(workflow, /run:\s*pnpm run release:smoke/u)
  assert.doesNotMatch(workflow, /continue-on-error:/u)
})

test('one immutable runtime binds the same release to API and Web', () => {
  const pinnedBase =
    'node:22.23.0-alpine@sha256:ab07539e0988b63558ff621f5fbe1077054c39d9809112974fb79993949d41cd'
  assert.equal(dockerfile.split(pinnedBase).length - 1, 2)
  assert.match(dockerfile, /USER node/u)
  assert.match(dockerfile, /STOPSIGNAL SIGTERM/u)
  assert.match(
    dockerfile,
    /HEALTHCHECK[\s\S]*X-Release-Id|HEALTHCHECK[\s\S]*x-release-id/u
  )
  assert.match(dockerfile, /HEALTHCHECK[^\n]*process\.env\.PORT/u)
  assert.match(dockerfile, /VITE_RELEASE_ID=\$RELEASE_ID/u)
  assertInOrder(dockerfile, [
    'pnpm --filter @nihongo/api deploy --prod --legacy /release/api',
    'node scripts/operations/normalize-api-deploy.mjs --api-directory /release/api --workspace-api-directory /workspace/apps/api',
    'node scripts/operations/release-manifest.mjs --mode create-oci-component'
  ])
  assert.match(serverSource, /releaseId: environment\.RELEASE_ID/u)
  assert.match(
    serverSource,
    /new URL\('\.\.\/\.\.\/web\/', import\.meta\.url\)/u
  )
  assert.match(
    webViteConfig,
    /createBrowserViteConfig\(import\.meta\.dirname\)/u
  )
  assert.match(webViteConfig, /packages\/browser\/vite\.config\.ts/u)
  assert.match(sharedBrowserViteConfig, /VITE_API_BASE_URL !== '\/api'/u)
  assert.match(dockerfile, /COPY apps\/admin\/package\.json/u)
  assert.match(dockerfile, /COPY packages\/browser\/package\.json/u)
  assert.match(dockerfile, /--admin-directory \/release\/admin/u)
  assert.match(dockerfile, /COPY --from=builder \/release\/admin \/app\/admin/u)
})

test('environment contract is secret-name-only and external activation stays closed', () => {
  assert.equal(environmentContract.schemaVersion, 1)
  assert.equal(environmentContract.releaseId.productionSentinelAllowed, false)
  assert.equal(
    environmentContract.environments.STAGING.activation,
    'blocked-until-exact-registry'
  )
  assert.equal(
    environmentContract.environments.PRODUCTION.activation,
    'blocked-until-staging-and-exact-registry'
  )
  assert.ok(environmentContract.publicVariableNames.includes('RELEASE_ID'))
  assert.ok(
    environmentContract.publicVariableNames.includes('DEPLOYMENT_ENVIRONMENT')
  )
  assert.ok(
    environmentContract.publicVariableNames.includes('VITE_API_BASE_URL')
  )
  assert.deepEqual(environmentContract.variableScopes.releaseBuild.secret, [])
  assert.ok(
    environmentContract.variableScopes.productionRuntime.secret.includes(
      'DATABASE_URL'
    )
  )
  assert.ok(
    environmentContract.variableScopes.productionRuntime.public.includes(
      'DEPLOYMENT_ENVIRONMENT'
    )
  )
  assert.ok(
    environmentContract.variableScopes.productionRuntime.secret.includes(
      'AUTH_GATEWAY_DATABASE_URL'
    )
  )
  for (const scope of ['releaseBuild', 'technicalDevelopmentOnly']) {
    assert.equal(
      environmentContract.variableScopes[scope].secret.includes(
        'AUTH_GATEWAY_DATABASE_URL'
      ),
      false
    )
  }
  assert.equal(
    environmentContract.variableScopes.productionRuntime.forbidden.includes(
      'AUTH_GATEWAY_DATABASE_URL'
    ),
    false
  )
  assert.equal(
    environmentContract.publicVariableNames.includes(
      'AUTH_GATEWAY_DATABASE_URL'
    ),
    false
  )
  assert.equal(
    environmentContract.variableScopes.productionRuntime.secret.includes(
      'PRODUCTION_DATABASE_URL'
    ),
    false
  )
  assert.ok(
    environmentContract.requiredExternalRegistryFields.includes(
      'backup.restoreTarget'
    )
  )
  for (const field of [
    'ingress.tlsIssuer',
    'secrets.project',
    'authentication.endpoint'
  ]) {
    assert.ok(
      environmentContract.requiredExternalRegistryFields.includes(field)
    )
  }
  assert.deepEqual(
    environmentContract.conditionalExternalRegistryFields
      .analyticsProviderWhenEnabled,
    [
      'analytics.processor',
      'analytics.project',
      'analytics.endpoint',
      'analytics.credentialSecretNames'
    ]
  )
  const serialized = JSON.stringify(environmentContract)
  assert.doesNotMatch(serialized, /postgres(?:ql)?:\/\//u)
  assert.doesNotMatch(serialized, /BEGIN (?:RSA |OPENSSH )?PRIVATE KEY/u)
})

test('recovery foundation stays provider-neutral and outside generic CI execution', () => {
  assert.equal(recoveryContract.schemaVersion, 1)
  assert.deepEqual(recoveryContract.classifications, {
    TEST: 'provider-neutral-isolated-fixture',
    STAGING: 'exact-external-target-evidence',
    PRODUCTION: 'exact-external-target-evidence'
  })
  assert.deepEqual(Object.keys(recoveryContract.migrationProfiles).sort(), [
    'technical-current-test',
    'v1-runtime-pre-phase7'
  ])
  assert.equal(
    recoveryContract.migrationProfiles['technical-current-test'].expectedCount,
    46
  )
  assert.equal(
    recoveryContract.migrationProfiles['technical-current-test']
      .expectedDigestSha256,
    '5457abb5b6fd6d2b0a839402479c643bd74d5e6878fd7763881abc440248d2aa'
  )
  for (const distinctDigest of [
    'fae541796dc4e4a3afbd05c9c0af39fbad11bdecc4385bd393092fafea8c62b9',
    '6aa49828fc3138b2b544830794cad68c05ed11ae2ffa018b9e43a2800cb578dd',
    '0169f4d0491d4e33f917df842cdeb26920edc2e7f02f8b0d41159cd132320f3b',
    '89158202b48454a0d179913983fe1449dc139c0db25aec0ba4c5480040291aad',
    '79bd5eb74c70780169cf672d330b605a89ed52d4cffd6bc130d77c7aff70577d',
    '8b9f35ed93aa7179cf5405a49039a10ff3f484171c54a33efbd1018b0494b02f',
    '96eebebc8d76d1eb858b1cc12d7559685a5e06559a57ff8d9aabdf3b067e3ab3',
    '6ce3cb9d17492c2806fab8e03b923b9440da30ca6be9b10c5a978abc1bd5d8a8',
    '4448f7aa40804bb3058f1a986c6af5527eb26ca7375973bcca320fa1bf51d7f8',
    'b1599310da408668bd4617f35ebc47109cb6e23d91e23dd737eaff521d49a393',
    '6870a93dd141b7a6c226de7aeed315d48ce313828c82bb92f91bf8a8861ed2ea'
  ]) {
    assert.notEqual(
      recoveryContract.migrationProfiles['technical-current-test']
        .expectedDigestSha256,
      distinctDigest
    )
  }
  assert.equal(
    recoveryContract.migrationProfiles['technical-current-test']
      .externalRecoveryClaimAllowed,
    false
  )
  assert.deepEqual(
    recoveryContract.migrationProfiles['technical-current-test'].environments,
    ['TEST']
  )
  assert.equal(
    recoveryContract.migrationProfiles['v1-runtime-pre-phase7'].expectedCount,
    27
  )
  assert.equal(
    recoveryContract.migrationProfiles['v1-runtime-pre-phase7']
      .expectedDigestSha256,
    '6870a93dd141b7a6c226de7aeed315d48ce313828c82bb92f91bf8a8861ed2ea'
  )
  assert.equal(
    recoveryContract.migrationProfiles['v1-runtime-pre-phase7']
      .boundaryMigration,
    '20260827100000_phase7_admin_cms_enums'
  )
  assert.equal(
    recoveryContract.migrationProfiles['v1-runtime-pre-phase7']
      .externalRecoveryClaimAllowed,
    false
  )
  assert.deepEqual(
    recoveryContract.migrationProfiles['v1-runtime-pre-phase7'].environments,
    ['STAGING', 'PRODUCTION']
  )
  for (const field of recoveryContract.requiredRegistryFields) {
    assert.ok(
      environmentContract.requiredExternalRegistryFields.includes(field)
    )
  }
  assert.match(recoveryRunbook, /not Staging or Production recovery proof/u)
  assert.match(recoveryRunbook, /unverified activation\s+candidate/u)
  assert.match(
    recoveryRunbook,
    /current-46 controlled Google-linked TEST session/u
  )
  assert.match(recoveryRunbook, /external Google exchange remains unverified/u)
  assert.doesNotMatch(recoveryRunbook, /stateful sign-up, sign-in/u)
  assert.match(
    recoveryRunbook,
    /historical canonical 37-migration isolated DB candidate excludes\s+`20261005183000_phase7_reviewed_catalog_current`/u
  )
  assert.match(
    recoveryRunbook,
    /neither this technical\s+recovery profile nor a runtime profile/u
  )
  assert.match(recoveryRunbook, /exact 46 ordered physical/u)
  assert.match(
    recoveryRunbook,
    /No current physical46, historical39 or catalog-excluded38 DB execution is verified here/u
  )
  assert.ok(
    recoveryRunbook.includes(
      '5457abb5b6fd6d2b0a839402479c643bd74d5e6878fd7763881abc440248d2aa'
    )
  )
  assert.ok(
    recoveryRunbook.includes(
      'd4d2caac296296fd941b7631cf6cf7016da2b1be1f764c01386d1d2b1413d806'
    )
  )
  assert.ok(recoveryRunbook.includes('20261010071000_phase7_approved308_tags'))
  assert.ok(
    recoveryRunbook.includes(
      '600dd3ab067f2af20bb04ecf1dd0f7c30eb18c6c32eb8ab03d746735fa0b0401'
    )
  )
  assert.match(recoveryRunbook, /actual new DB8 execution remains unverified/u)
  assert.match(recoveryRunbook, /Previous physical 37 and canonical 36/u)
  assert.match(recoveryRunbook, /Previous physical 36 and canonical 35/u)
  assert.match(recoveryRunbook, /Historical physical 35 and canonical 34/u)
  assert.match(recoveryRunbook, /Those failures are not upgraded/u)
  assert.ok(
    recoveryRunbook.includes(
      '20261009120000_phase7_approved_n4_reading_batch7_tags'
    )
  )
  assert.ok(
    recoveryRunbook.includes(
      '01ae675a719ccc08854135efd4057f95659d671d04addf40d5c45ba26c850f12'
    )
  )
  assert.ok(
    recoveryRunbook.includes('20261009092000_phase7_n4_n2_revision2_digest_fix')
  )
  assert.ok(
    recoveryRunbook.includes(
      '21f8911ff72d11405338df8c7a539c6eff92279593d895dfba2cc4dd236326aa'
    )
  )
  for (const historicalOrCandidateDigest of [
    '6aa49828fc3138b2b544830794cad68c05ed11ae2ffa018b9e43a2800cb578dd',
    '0169f4d0491d4e33f917df842cdeb26920edc2e7f02f8b0d41159cd132320f3b',
    'fae541796dc4e4a3afbd05c9c0af39fbad11bdecc4385bd393092fafea8c62b9',
    '79bd5eb74c70780169cf672d330b605a89ed52d4cffd6bc130d77c7aff70577d',
    '89158202b48454a0d179913983fe1449dc139c0db25aec0ba4c5480040291aad',
    '8b9f35ed93aa7179cf5405a49039a10ff3f484171c54a33efbd1018b0494b02f',
    '96eebebc8d76d1eb858b1cc12d7559685a5e06559a57ff8d9aabdf3b067e3ab3',
    '6ce3cb9d17492c2806fab8e03b923b9440da30ca6be9b10c5a978abc1bd5d8a8',
    '4448f7aa40804bb3058f1a986c6af5527eb26ca7375973bcca320fa1bf51d7f8',
    'b1599310da408668bd4617f35ebc47109cb6e23d91e23dd737eaff521d49a393'
  ]) {
    assert.ok(recoveryRunbook.includes(historicalOrCandidateDigest))
  }
  assert.doesNotMatch(workflow, /pnpm run recovery:verify/u)
  assert.doesNotMatch(workflow, /pg_dump|pg_restore|prisma migrate deploy/u)
})
