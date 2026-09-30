import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { assertWorkflowArtifactPolicy } from './security/security-evidence.mjs'

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)
const readJson = async (relativePath) =>
  JSON.parse(await readFile(path.join(repositoryRoot, relativePath), 'utf8'))
const readText = async (relativePath) =>
  await readFile(path.join(repositoryRoot, relativePath), 'utf8')

const [rootPackage, webPackage, apiPackage, workflow, playwrightConfig] =
  await Promise.all([
    readJson('package.json'),
    readJson('apps/web/package.json'),
    readJson('apps/api/package.json'),
    readText('.github/workflows/ci.yml'),
    readText('playwright.config.ts')
  ])

const assertInOrder = (text, fragments) => {
  let previousIndex = -1
  for (const fragment of fragments) {
    const index = text.indexOf(fragment)
    assert.ok(index > previousIndex, `${fragment} must appear in order`)
    previousIndex = index
  }
}

test('package scripts preserve the Phase 10 static, performance, and browser graph', () => {
  assert.equal(
    rootPackage.scripts['test:phase10:static'],
    'node --test scripts/phase10-ci-contract.test.mjs && pnpm --filter @nihongo/web run test:phase10:ledger'
  )
  assert.equal(
    rootPackage.scripts['test:phase10:performance'],
    'pnpm run build:contracts && pnpm run build:domain && pnpm --filter @nihongo/web run test:phase10:bundle && pnpm run test:phase10:performance:database-api'
  )
  assert.equal(
    rootPackage.scripts['test:phase10:performance:database-api'],
    'pnpm --filter @nihongo/api run test:phase10:performance'
  )
  assert.equal(
    rootPackage.scripts['test:phase10:browser:real'],
    'pnpm run test:phase8:browser:real && pnpm run test:phase9:browser:real && pnpm --filter @nihongo/api exec tsx ../../scripts/runPhase10Browser.ts real'
  )
  assert.equal(
    rootPackage.scripts['test:phase10:browser:mock'],
    'pnpm run test:phase8:browser:mock && pnpm run test:phase9:browser:mock && pnpm --filter @nihongo/api exec tsx ../../scripts/runPhase10Browser.ts mock'
  )
  assert.equal(
    webPackage.scripts['test:phase10:bundle'],
    'node scripts/phase10-production-bundle-clean.mjs && node --test scripts/phase10-production-bundle-contract.test.mjs && node scripts/phase10-production-bundle-check.mjs && node --test scripts/phase10-production-bundle-evidence.test.mjs'
  )
  assert.equal(
    webPackage.scripts['test:phase10:ledger'],
    'vitest run --config scripts/phase10-request-ledger.vitest.config.mjs'
  )
  assert.equal(
    apiPackage.scripts['test:phase10:performance'],
    'tsx src/e2e/runPhase10Performance.ts'
  )
})

test('quality job executes final gates and run-unique performance evidence lifecycle', () => {
  assert.match(workflow, /- codex\/phase-10-test-security-performance/u)
  assert.match(
    workflow,
    /build:[\s\S]*runs-on: ubuntu-latest\n {4}timeout-minutes: 45/u
  )
  assert.match(
    workflow,
    /PHASE10_PERFORMANCE_EVIDENCE_DIR: test-results\/phase10-evidence\/performance-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/u
  )
  const qualityJobEnvironment = workflow.slice(
    workflow.indexOf('    env:\n'),
    workflow.indexOf('    steps:\n')
  )
  assert.doesNotMatch(
    qualityJobEnvironment,
    /PHASE10_PERFORMANCE_EVIDENCE_DIR/u
  )
  const apiIntegrationStep = workflow.slice(
    workflow.indexOf('- name: Phase 10 complete API integration gate'),
    workflow.indexOf('- name: Production mock mode stays fail closed')
  )
  assert.doesNotMatch(apiIntegrationStep, /PHASE10_PERFORMANCE_EVIDENCE_DIR/u)
  for (const stepName of [
    'Initialize unique Phase 10 performance evidence',
    'Phase 10 performance gate',
    'Verify Phase 10 performance evidence',
    'Upload safe Phase 10 performance evidence',
    'Clean Phase 10 performance evidence'
  ]) {
    const start = workflow.indexOf(`- name: ${stepName}`)
    const end = workflow.indexOf('\n      - name:', start + 1)
    const step = workflow.slice(start, end === -1 ? undefined : end)
    assert.match(step, /PHASE10_PERFORMANCE_EVIDENCE_DIR/u, stepName)
  }
  assertInOrder(workflow, [
    'run: pnpm install --frozen-lockfile\n',
    'run: pnpm run format:check\n',
    'run: pnpm run lint\n',
    'run: pnpm run check:architecture\n',
    'run: pnpm run typecheck\n',
    'run: pnpm run test:phase9:static\n',
    'run: pnpm run test:phase10:static\n',
    'run: pnpm run test:phase10:security\n',
    'run: pnpm run test\n',
    'run: pnpm run test:phase10:api-integration\n',
    'run: pnpm run build\n',
    'run: pnpm run content:foundation-check\n',
    'run: pnpm run test:phase10:performance\n'
  ])
  assert.doesNotMatch(
    workflow,
    /run:\s*pnpm run content:foundation-check:static/u
  )
  assert.match(
    workflow,
    /test ! -e "\$PHASE10_PERFORMANCE_EVIDENCE_DIR"[\s\S]*install -d -m 700 "\$PHASE10_PERFORMANCE_EVIDENCE_DIR"/u
  )
  assert.match(workflow, /test "\$\(stat -c '%a' "\$file"\)" = 600/u)
  assert.match(
    workflow,
    /name: performance-safe-phase10-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/u
  )
  assert.match(
    workflow,
    /\$\{\{ env\.PHASE10_PERFORMANCE_EVIDENCE_DIR \}\}\/bundle\.json[\s\S]*\$\{\{ env\.PHASE10_PERFORMANCE_EVIDENCE_DIR \}\}\/database-api\.json/u
  )
  assert.match(
    workflow,
    /name: Clean Phase 10 performance evidence[\s\S]*if: \$\{\{ always\(\) \}\}[\s\S]*test "\$PHASE10_PERFORMANCE_EVIDENCE_DIR" = "\$expected"/u
  )
  assert.doesNotMatch(workflow, /continue-on-error:/u)
})

test('browser job preserves six-label acceptance and run-unique safe evidence', () => {
  assert.match(workflow, /e2e:[\s\S]*needs: build/u)
  assert.match(workflow, /e2e:[\s\S]*timeout-minutes: 45/u)
  assert.match(
    workflow,
    /PHASE10_PLAYWRIGHT_EVIDENCE_DIR: test-results\/phase10-evidence\/playwright-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/u
  )
  assertInOrder(workflow, [
    'Initialize unique safe Playwright evidence',
    'pnpm run test:phase10:browser:real',
    'pnpm run test:phase10:browser:mock',
    'Verify safe Playwright evidence',
    'Upload safe Playwright evidence',
    'Clean safe Playwright evidence',
    'Clean raw Playwright output',
    'Clean Phase 9 browser diagnostics'
  ])
  assert.match(
    workflow,
    /--directory "\$PHASE10_PLAYWRIGHT_EVIDENCE_DIR"[\s\S]*--required phase8-real,phase8-mock,phase9-real,phase9-mock,phase10-real,phase10-mock/u
  )
  assert.match(
    workflow,
    /path: \$\{\{ env\.PHASE10_PLAYWRIGHT_EVIDENCE_DIR \}\}\//u
  )
  assert.match(
    workflow,
    /expected="test-results\/phase10-evidence\/playwright-\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}"[\s\S]*test "\$PHASE10_PLAYWRIGHT_EVIDENCE_DIR" = "\$expected"/u
  )
  assert.match(workflow, /expected="test-results\/phase10-raw"/u)
  assert.match(workflow, /expected="test-results\/playwright-phase9-real"/u)
  assert.doesNotThrow(() => assertWorkflowArtifactPolicy(workflow))
})

test('browser failure policy cannot be weakened', () => {
  assert.match(playwrightConfig, /forbidOnly:\s*true/u)
  assert.match(playwrightConfig, /fullyParallel:\s*false/u)
  assert.match(playwrightConfig, /retries:\s*0/u)
  assert.match(playwrightConfig, /timeout:\s*75_000/u)
  assert.match(playwrightConfig, /workers:\s*1/u)
  for (const command of [
    rootPackage.scripts['test:phase10:browser:real'],
    rootPackage.scripts['test:phase10:browser:mock']
  ]) {
    assert.doesNotMatch(command, /--(?:pass-with-no-tests|retries|timeout)\b/u)
  }
})
