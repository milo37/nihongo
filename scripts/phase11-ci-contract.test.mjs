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
  dockerignore,
  serverSource,
  webViteConfig
] = await Promise.all([
  readJson('package.json'),
  readJson('apps/api/package.json'),
  readJson('packages/contracts/package.json'),
  readJson('packages/domain/package.json'),
  readText('.github/workflows/ci.yml'),
  readText('Dockerfile'),
  readJson('operations/environment-contract.v1.json'),
  readText('.dockerignore'),
  readText('apps/api/src/server.ts'),
  readText('apps/web/vite.config.ts')
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
  assert.match(workflow, /- codex\/phase-11-deployment-operations/u)
  const buildJob = workflow.slice(
    workflow.indexOf('\n  build:'),
    workflow.indexOf('\n  e2e:')
  )
  const releaseJob = workflow.slice(workflow.indexOf('\n  phase11_release:'))

  assert.doesNotMatch(
    buildJob,
    /Build and verify portable Phase 11 OCI release/u
  )
  assert.match(releaseJob, /needs: \[build, e2e\]/u)
  assertInOrder(workflow, [
    'run: pnpm run test:phase10:static',
    'run: pnpm run test:phase11:static',
    'run: pnpm run test:phase10:security',
    'run: pnpm run test\n',
    'run: pnpm run build',
    'run: pnpm run content:foundation-check',
    'run: pnpm run test:phase10:performance',
    'name: Phase 10 canonical mock browser acceptance',
    'phase11_release:',
    'name: Build and verify portable Phase 11 OCI release',
    'pnpm run release:runtime-smoke',
    'pnpm run release:runtime-smoke -- --mode verify',
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
  assert.match(workflow, /pnpm run release:evidence -- --mode create/u)
  assert.match(
    workflow,
    /pnpm run release:runtime-smoke -- --image "\$PHASE11_IMAGE_TAG" --release-id "\$GITHUB_SHA"/u
  )
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
  assert.match(serverSource, /releaseId: environment\.RELEASE_ID/u)
  assert.match(
    serverSource,
    /new URL\('\.\.\/\.\.\/web\/', import\.meta\.url\)/u
  )
  assert.match(webViteConfig, /VITE_API_BASE_URL !== '\/api'/u)
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
    environmentContract.publicVariableNames.includes('VITE_API_BASE_URL')
  )
  assert.deepEqual(environmentContract.variableScopes.releaseBuild.secret, [])
  assert.ok(
    environmentContract.variableScopes.productionRuntime.secret.includes(
      'DATABASE_URL'
    )
  )
  assert.ok(
    environmentContract.variableScopes.productionRuntime.forbidden.includes(
      'AUTH_GATEWAY_DATABASE_URL'
    )
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
