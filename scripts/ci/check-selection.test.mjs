import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { prepareBrowserArtifacts } from '../../apps/api/src/e2e/browserArtifactPreparation.ts'
import { runBrowserSuites } from '../runBrowser.ts'

import {
  classifyChangedFiles,
  qualityCommands,
  readSelection,
  selectChecks
} from './check-selection.mjs'

const sha = (character) => character.repeat(40)
const pullRequestEvent = (overrides = {}) => ({
  action: 'synchronize',
  pull_request: {
    base: { ref: 'dev', sha: sha('a') },
    head: { sha: sha('b') }
  },
  ...overrides
})

test('title/body-only edits select no product checks', () => {
  for (const changes of [
    { title: { from: 'old' } },
    { body: { from: 'old' } },
    { title: { from: 'old' }, body: { from: 'old' } }
  ]) {
    const selection = selectChecks({
      eventName: 'pull_request',
      ref: 'refs/pull/1/merge',
      event: pullRequestEvent({ action: 'edited', changes }),
      changedFiles: ['apps/web/src/main.tsx']
    })
    assert.equal(selection.mode, 'metadata')
    assert.equal(selection.code, false)
  }
})

test('mixed, malformed and noncanonical edits classify product impact', () => {
  for (const changes of [
    { title: { from: 'old' }, labels: { from: [] } },
    { title: { from: 'old', unexpected: true } },
    { body: { from: 'old' }, title: { from: 'old' } }
  ]) {
    const selection = selectChecks({
      eventName: 'pull_request',
      ref: 'refs/pull/1/merge',
      event: pullRequestEvent({ action: 'edited', changes }),
      changedFiles: ['apps/web/src/main.tsx']
    })
    assert.equal(selection.mode, 'pull_request')
    assert.equal(selection.web, true)
  }
})

test('base edits still classify changed files', () => {
  const selection = selectChecks({
    eventName: 'pull_request',
    ref: 'refs/pull/1/merge',
    event: pullRequestEvent({
      action: 'edited',
      changes: { base: { ref: { from: 'main' }, sha: { from: sha('c') } } }
    }),
    changedFiles: ['apps/web/src/main.tsx']
  })
  assert.equal(selection.mode, 'pull_request')
  assert.equal(selection.web, true)
})

test('unclassified and unsafe paths fail closed', () => {
  assert.throws(
    () => classifyChangedFiles(['unknown-area/file.json']),
    /CI_CLASSIFICATION_UNCLASSIFIED_PATH/u
  )
  assert.throws(
    () => classifyChangedFiles(['apps/web/../api/package.json']),
    /CI_CLASSIFICATION_INVALID_PATH/u
  )
})

test('shared and cross-boundary auth/storage/submission changes get FE and BE regression', () => {
  for (const file of [
    'packages/contracts/src/auth/session.ts',
    'apps/web/src/libs/storage.ts',
    'apps/api/src/study/submissionService.ts'
  ]) {
    const selection = classifyChangedFiles([file])
    assert.equal(selection.web, true, file)
    assert.equal(selection.api, true, file)
    assert.equal(selection.browser, true, file)
    assert.equal(selection.database, true, file)
  }
})

test('audit, database performance and portable checks are impact selected', () => {
  const lock = classifyChangedFiles(['pnpm-lock.yaml'])
  assert.equal(lock.audit, true)
  assert.equal(lock.portable, true)

  const database = classifyChangedFiles([
    'apps/api/prisma/migrations/20260101000000_example/migration.sql'
  ])
  assert.equal(database.performance, true)
  assert.equal(database.audit, false)

  const web = classifyChangedFiles(['apps/web/src/app/home/page.tsx'])
  assert.equal(web.performance, false)
  assert.equal(web.audit, false)
  assert.equal(web.portable, false)
})

test('release candidates select audit, performance and portable verification', () => {
  for (const input of [
    {
      eventName: 'push',
      ref: 'refs/tags/v1.2.3',
      event: {},
      changedFiles: []
    },
    {
      eventName: 'pull_request',
      ref: 'refs/pull/2/merge',
      event: pullRequestEvent({
        pull_request: {
          base: { ref: 'main', sha: sha('a') },
          head: { sha: sha('b') }
        }
      }),
      changedFiles: ['README.md']
    }
  ]) {
    const selection = selectChecks(input)
    assert.equal(selection.candidate, true)
    assert.equal(selection.audit, true)
    assert.equal(selection.performance, true)
    assert.equal(selection.portable, true)
    assert.equal(selection.browser, true)
  }
})

const namedWorkflowStep = (source, name) => {
  const marker = `      - name: ${name}\n`
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, name)
  const next = source.indexOf('\n      - name:', start + marker.length)
  return source.slice(start, next === -1 ? source.length : next)
}

const workflowStepEnvironment = (step) => {
  const lines = step.split('\n')
  const start = lines.indexOf('        env:')
  assert.notEqual(start, -1, 'step env')
  const environment = new Map()
  for (const line of lines.slice(start + 1)) {
    const match = /^ {10}([A-Z][A-Z0-9_]*): (.+)$/u.exec(line)
    if (!match) break
    assert.equal(environment.has(match[1]), false, match[1])
    environment.set(match[1], match[2])
  }
  return environment
}

const ciWorkflow = () =>
  readFileSync(
    path.resolve(import.meta.dirname, '../../.github/workflows/ci.yml'),
    'utf8'
  )

const workflowJob = (workflow, name) => {
  const source = workflow.split(`\n  ${name}:\n`)[1]
  assert.ok(source, name)
  return source.split(/\n {2}[a-z0-9_]+:\n/u)[0]
}

const stepScript = (job, name) => {
  const step = namedWorkflowStep(job, name)
  const script = step
    .split('        run: |\n')[1]
    ?.split('\n')
    .filter((line) => line.startsWith('          '))
    .map((line) => line.slice(10))
    .join('\n')
  assert.ok(script, name)
  return script
}

const assertGate = (script, env, expected) => {
  const result = spawnSync('bash', ['-e', '-c', script], {
    env: { ...process.env, ...env },
    encoding: 'utf8'
  })
  assert.equal(result.status, expected, JSON.stringify(env))
}

test('quality and regression start from the same plan in isolated jobs', () => {
  const workflow = ciWorkflow()
  const plan = workflowJob(workflow, 'plan')
  const build = workflowJob(workflow, 'build')
  const regression = workflowJob(workflow, 'regression')
  const gate = workflowJob(workflow, 'e2e')
  const portable = workflowJob(workflow, 'phase11_release')
  assert.equal(
    workflow.split('run: node scripts/ci/check-selection.mjs plan').length - 1,
    1
  )
  assert.match(plan, /fetch-depth: 0/u)
  assert.doesNotMatch(plan, /pnpm install|cache:|services:|needs:/u)
  for (const job of [build, regression]) {
    assert.match(job, /^ {4}needs: plan$/mu)
    assert.match(
      job,
      /CI_SELECTION: \$\{\{ needs\.plan\.outputs\.selection \}\}/u
    )
    assert.match(job, /uses: actions\/checkout@v4/u)
    assert.match(job, /ref: \$\{\{ github\.sha \}\}/u)
    assert.match(job, /persist-credentials: false/u)
    assert.match(job, /run: pnpm install --frozen-lockfile/u)
    assert.doesNotMatch(job, /needs\.build|continue-on-error/u)
  }
  assert.match(build, /if: \$\{\{ always\(\)/u)
  assert.match(build, /run: test "\$PLAN_RESULT" = success/u)
  assert.doesNotMatch(build + plan + gate + portable, /services:/u)
  assert.match(regression, /postgres:18\.4-alpine@sha256:/u)
  assert.match(
    regression,
    /needs\.plan\.outputs\.api == 'true' \|\| needs\.plan\.outputs\.browser == 'true' \|\| needs\.plan\.outputs\.performance == 'true'/u
  )
  assert.match(gate, /needs: \[plan, build, regression\]/u)
  assert.match(portable, /needs: \[plan, build\]/u)
  for (const job of [gate, portable]) {
    assert.match(job, /if: \$\{\{ always\(\)/u)
    assert.match(job, /PLAN_RESULT: \$\{\{ needs\.plan\.result \}\}/u)
    assert.match(job, /BUILD_RESULT: \$\{\{ needs\.build\.result \}\}/u)
    assert.match(job, /test "\$PLAN_RESULT" = success/u)
    assert.match(job, /test "\$BUILD_RESULT" = success/u)
  }
  for (const group of [
    'static',
    'typecheck',
    'unit',
    'audit',
    'build',
    'bundle'
  ]) {
    assert.equal(
      build.split(`run: node scripts/ci/check-selection.mjs quality ${group}\n`)
        .length - 1,
      1
    )
  }
  for (const [name, id, flag, command] of [
    [
      'API and database integration',
      'api_integration',
      'api',
      'node scripts/ci/check-selection.mjs quality integration'
    ],
    [
      'Database and API performance',
      'database_performance',
      'performance',
      'node scripts/ci/check-selection.mjs quality performance'
    ],
    [
      'Real browser acceptance',
      'real_browser',
      'browser',
      'pnpm run test:browser:real'
    ]
  ]) {
    const step = namedWorkflowStep(regression, name)
    assert.ok(step.includes(`id: ${id}`))
    assert.ok(step.includes(`if: \${{ needs.plan.outputs.${flag} == 'true' }}`))
    assert.equal(workflow.split(`run: ${command}\n`).length - 1, 1)
  }
  assert.doesNotMatch(workflow, /run: pnpm run test:browser:mock/u)
  assert.ok(
    namedWorkflowStep(regression, 'Install Playwright Chromium').includes(
      "if: ${{ needs.plan.outputs.browser == 'true' }}"
    )
  )
})

test('real browser summaries are isolated, verified before upload and cleaned on failure', () => {
  const job = workflowJob(ciWorkflow(), 'regression')
  const names = [
    'Initialize unique safe Playwright evidence',
    'Real browser acceptance',
    'Verify safe Playwright evidence',
    'Upload safe Playwright evidence',
    'Clean browser evidence',
    'Verify selected regression acceptance'
  ]
  const positions = names.map((name) => {
    namedWorkflowStep(job, name)
    return job.indexOf(`      - name: ${name}\n`)
  })
  assert.deepEqual(
    positions,
    positions.toSorted((left, right) => left - right)
  )
  assert.ok(
    job.includes(
      'PHASE10_PLAYWRIGHT_EVIDENCE_DIR: test-results/phase10-evidence/playwright-${{ github.run_id }}-${{ github.run_attempt }}'
    )
  )
  const initialize = namedWorkflowStep(job, names[0])
  assert.match(initialize, /id: playwright_initialize/u)
  assert.ok(
    initialize.includes("if: ${{ needs.plan.outputs.browser == 'true' }}")
  )
  const verify = namedWorkflowStep(job, names[2])
  assert.match(verify, /id: playwright_evidence/u)
  assert.ok(
    verify.includes(
      "if: ${{ !cancelled() && steps.playwright_initialize.outcome == 'success' }}"
    )
  )
  assert.match(verify, /node scripts\/security\/security-evidence\.mjs verify/u)
  assert.match(verify, /--directory "\$PHASE10_PLAYWRIGHT_EVIDENCE_DIR"/u)
  assert.match(verify, /--profile playwright/u)
  assert.match(verify, /--required phase8-real,phase9-real,phase10-real\s*$/u)
  const cleanup = namedWorkflowStep(job, names[4])
  assert.ok(
    cleanup.includes(
      "if: ${{ always() && needs.plan.outputs.browser == 'true' }}"
    )
  )

  const root = mkdtempSync(path.join(tmpdir(), 'ci-browser-evidence-'))
  const evidence = 'test-results/phase10-evidence/playwright-fixture-1'
  const env = {
    ...process.env,
    GITHUB_RUN_ID: 'fixture',
    GITHUB_RUN_ATTEMPT: '1',
    PHASE10_PLAYWRIGHT_EVIDENCE_DIR: evidence
  }
  const run = (name, overrides = {}) =>
    spawnSync('bash', ['-e', '-c', stepScript(job, name)], {
      cwd: root,
      env: { ...env, ...overrides },
      encoding: 'utf8'
    })
  try {
    assert.equal(run(names[0]).status, 0)
    writeFileSync(path.join(root, evidence, 'owned.json'), '{}')
    assert.equal(run(names[0]).status, 1, 'stale evidence must be rejected')
    for (const directory of [
      'test-results/phase10-raw',
      'test-results/playwright-phase9-real'
    ]) {
      mkdirSync(path.join(root, directory), { recursive: true })
      writeFileSync(path.join(root, directory, 'owned.txt'), 'fixture')
    }
    assert.equal(
      run(names[4], { PHASE10_PLAYWRIGHT_EVIDENCE_DIR: 'unrelated' }).status,
      1
    )
    assert.equal(existsSync(path.join(root, evidence, 'owned.json')), true)
    assert.equal(run(names[4]).status, 0)
    for (const directory of [
      evidence,
      'test-results/phase10-raw',
      'test-results/playwright-phase9-real'
    ]) {
      assert.equal(existsSync(path.join(root, directory)), false)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('regression gate rejects failure, cancellation and unexpected skips for every selected suite', () => {
  const job = workflowJob(ciWorkflow(), 'regression')
  const step = namedWorkflowStep(job, 'Verify selected regression acceptance')
  assert.ok(step.includes('if: ${{ always() }}'))
  const environment = workflowStepEnvironment(step)
  for (const [key, expression] of Object.entries({
    PLAN_RESULT: 'needs.plan.result',
    JOB_RESULT: 'job.status',
    API_SELECTED: 'needs.plan.outputs.api',
    API_OUTCOME: 'steps.api_integration.outcome',
    PERFORMANCE_SELECTED: 'needs.plan.outputs.performance',
    PERFORMANCE_OUTCOME: 'steps.database_performance.outcome',
    BROWSER_SELECTED: 'needs.plan.outputs.browser',
    REAL_OUTCOME: 'steps.real_browser.outcome',
    EVIDENCE_INITIALIZE_OUTCOME: 'steps.playwright_initialize.outcome',
    EVIDENCE_OUTCOME: 'steps.playwright_evidence.outcome'
  }))
    assert.equal(environment.get(key), `\${{ ${expression} }}`)
  const script = stepScript(job, 'Verify selected regression acceptance')
  for (const api of [false, true])
    for (const performance of [false, true])
      for (const browser of [false, true]) {
        const env = {
          PLAN_RESULT: 'success',
          JOB_RESULT: 'success',
          API_SELECTED: String(api),
          API_OUTCOME: api ? 'success' : 'skipped',
          PERFORMANCE_SELECTED: String(performance),
          PERFORMANCE_OUTCOME: performance ? 'success' : 'skipped',
          BROWSER_SELECTED: String(browser),
          REAL_OUTCOME: browser ? 'success' : 'skipped',
          EVIDENCE_INITIALIZE_OUTCOME: browser ? 'success' : 'skipped',
          EVIDENCE_OUTCOME: browser ? 'success' : 'skipped'
        }
        assertGate(script, env, 0)
        for (const key of [
          'PLAN_RESULT',
          'JOB_RESULT',
          'API_OUTCOME',
          'PERFORMANCE_OUTCOME',
          'REAL_OUTCOME',
          'EVIDENCE_INITIALIZE_OUTCOME',
          'EVIDENCE_OUTCOME'
        ]) {
          for (const result of [
            'success',
            'failure',
            'cancelled',
            'skipped',
            ''
          ]) {
            if (result !== env[key])
              assertGate(script, { ...env, [key]: result }, 1)
          }
        }
        for (const key of [
          'API_SELECTED',
          'PERFORMANCE_SELECTED',
          'BROWSER_SELECTED'
        ]) {
          assertGate(script, { ...env, [key]: '' }, 1)
        }
      }
})

test('protected aggregate accepts only successful dependencies and intentionally skipped regression', () => {
  const job = workflowJob(ciWorkflow(), 'e2e')
  const step = namedWorkflowStep(
    job,
    'Require successful selected regression and build'
  )
  const environment = workflowStepEnvironment(step)
  for (const [key, expression] of Object.entries({
    PLAN_RESULT: 'needs.plan.result',
    BUILD_RESULT: 'needs.build.result',
    REGRESSION_RESULT: 'needs.regression.result',
    API_SELECTED: 'needs.plan.outputs.api',
    PERFORMANCE_SELECTED: 'needs.plan.outputs.performance',
    BROWSER_SELECTED: 'needs.plan.outputs.browser'
  }))
    assert.equal(environment.get(key), `\${{ ${expression} }}`)
  const script = stepScript(
    job,
    'Require successful selected regression and build'
  )
  for (const api of [false, true])
    for (const performance of [false, true])
      for (const browser of [false, true]) {
        const env = {
          PLAN_RESULT: 'success',
          BUILD_RESULT: 'success',
          API_SELECTED: String(api),
          PERFORMANCE_SELECTED: String(performance),
          BROWSER_SELECTED: String(browser),
          REGRESSION_RESULT:
            api || performance || browser ? 'success' : 'skipped'
        }
        assertGate(script, env, 0)
        for (const key of [
          'PLAN_RESULT',
          'BUILD_RESULT',
          'REGRESSION_RESULT'
        ]) {
          for (const result of [
            'success',
            'failure',
            'cancelled',
            'skipped',
            ''
          ]) {
            if (result !== env[key])
              assertGate(script, { ...env, [key]: result }, 1)
          }
        }
        for (const key of [
          'API_SELECTED',
          'PERFORMANCE_SELECTED',
          'BROWSER_SELECTED'
        ]) {
          assertGate(script, { ...env, [key]: '' }, 1)
        }
      }
})

test('protected branch pushes always run core regression but keep expensive extras related', () => {
  const selection = selectChecks({
    eventName: 'push',
    ref: 'refs/heads/main',
    event: {},
    changedFiles: ['README.md']
  })
  assert.equal(selection.mode, 'integration')
  assert.equal(selection.web, true)
  assert.equal(selection.api, true)
  assert.equal(selection.browser, true)
  assert.equal(selection.performance, false)
  assert.equal(selection.audit, false)
  assert.equal(selection.portable, false)
})

test('dev pull requests keep affected checks while omitting browser execution', () => {
  for (const file of [
    'apps/web/src/main.tsx',
    'apps/api/src/study/submissionService.ts',
    '.github/workflows/ci.yml',
    'README.md'
  ]) {
    const expected = classifyChangedFiles([file])
    expected.browser = false
    const actual = selectChecks({
      eventName: 'pull_request',
      ref: 'refs/pull/1/merge',
      event: pullRequestEvent(),
      changedFiles: [file]
    })
    assert.deepEqual(actual, expected, file)
  }
})

test('dev push retains core checks but does not select browser execution', () => {
  const input = {
    eventName: 'push',
    event: {},
    changedFiles: ['apps/web/src/main.tsx']
  }
  const main = selectChecks({ ...input, ref: 'refs/heads/main' })
  const dev = selectChecks({ ...input, ref: 'refs/heads/dev' })
  assert.equal(main.browser, true)
  assert.deepEqual(dev, { ...main, browser: false })
})

test('main pull requests require browser checks even for documentation changes', () => {
  const actual = selectChecks({
    eventName: 'pull_request',
    ref: 'refs/pull/1/merge',
    event: pullRequestEvent({
      pull_request: {
        base: { ref: 'main', sha: sha('a') },
        head: { sha: sha('b') }
      }
    }),
    changedFiles: ['README.md']
  })
  assert.equal(actual.browser, true)
  assert.equal(actual.api, true)
  assert.equal(actual.code, true)
  assert.equal(actual.candidate, true)
})

test('comparison failures are errors, never successful fallback selections', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'nihongo-selection-'))
  const eventPath = path.join(directory, 'event.json')
  writeFileSync(eventPath, JSON.stringify(pullRequestEvent()))
  assert.throws(
    () =>
      readSelection(
        {
          GITHUB_EVENT_NAME: 'pull_request',
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_REF: 'refs/pull/1/merge',
          GITHUB_SHA: sha('c')
        },
        () => {
          throw new Error('git unavailable')
        }
      ),
    /CI_CLASSIFICATION_COMPARISON_FAILED/u
  )
})

test('quality groups call semantic commands without phase-number aliases', () => {
  const selection = classifyChangedFiles(['apps/api/src/auth/session.ts'])
  const commands = [
    ...qualityCommands(selection, 'static'),
    ...qualityCommands(selection, 'unit'),
    ...qualityCommands(selection, 'integration'),
    ...qualityCommands(selection, 'performance')
  ]
  assert.doesNotMatch(JSON.stringify(commands), /(?:^|:)phase\d/iu)
  assert.ok(commands.some((command) => command.includes('test:api-regression')))
  assert.ok(
    commands.some((command) => command.includes('test:database-performance'))
  )
  assert.ok(
    qualityCommands(selection, 'unit').some((command) =>
      command.includes('test:request-ledger')
    )
  )
  const adminBuild = qualityCommands(
    classifyChangedFiles(['apps/admin/src/main.tsx']),
    'build'
  )
  assert.ok(
    adminBuild.some((command) => command.includes('@nihongo/web')) &&
      adminBuild.some((command) => command.includes('@nihongo/admin'))
  )
  const webUnit = JSON.stringify(
    qualityCommands(
      classifyChangedFiles(['apps/web/src/components/Button.tsx']),
      'unit'
    )
  )
  assert.doesNotMatch(webUnit, /scripts\/(?:content|operations)/u)
  assert.match(
    JSON.stringify(
      qualityCommands(classifyChangedFiles(['Dockerfile']), 'unit')
    ),
    /scripts\/operations/u
  )
})

test('standalone runners use supported workspace build commands', () => {
  const repositoryRoot = path.resolve(import.meta.dirname, '../..')
  const rootScripts = JSON.parse(
    readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8')
  ).scripts
  assert.equal(rootScripts['build:contracts'], undefined)
  assert.equal(rootScripts['build:domain'], undefined)
  for (const packageName of ['contracts', 'domain']) {
    const packageScripts = JSON.parse(
      readFileSync(
        path.join(repositoryRoot, `packages/${packageName}/package.json`),
        'utf8'
      )
    ).scripts
    assert.equal(typeof packageScripts.build, 'string', packageName)
  }

  const directBuild = (packageName) =>
    new RegExp(
      String.raw`\[\s*'--filter',\s*'${packageName}',\s*'run',\s*'build'\s*\]`,
      'u'
    )
  for (const file of [
    'apps/api/src/e2e/runDatabaseIntegration.ts',
    'apps/api/src/e2e/runPhase7ApiIntegration.ts',
    'apps/api/src/e2e/runPhase7Browser.ts',
    'scripts/runPhase10Browser.ts'
  ]) {
    const source = readFileSync(path.join(repositoryRoot, file), 'utf8')
    assert.doesNotMatch(source, /'build:(?:contracts|domain)'/u, file)
    if (
      file.endsWith('runDatabaseIntegration.ts') ||
      file.endsWith('runPhase7ApiIntegration.ts')
    ) {
      assert.match(source, /await prepareBrowserArtifacts\(/u, file)
    } else {
      assert.match(source, directBuild('@nihongo/contracts'), file)
      assert.match(source, directBuild('@nihongo/domain'), file)
    }
  }
  const shared = readFileSync(
    path.join(repositoryRoot, 'apps/api/src/e2e/browserArtifactPreparation.ts'),
    'utf8'
  )
  assert.match(shared, directBuild('@nihongo/contracts'))
  assert.match(shared, directBuild('@nihongo/domain'))
})

test('workflow and command budgets preserve the three protected contexts', () => {
  const repositoryRoot = path.resolve(import.meta.dirname, '../..')
  const normal = readFileSync(
    path.join(repositoryRoot, '.github/workflows/ci.yml'),
    'utf8'
  )
  const candidate = readFileSync(
    path.join(repositoryRoot, '.github/workflows/candidate.yml'),
    'utf8'
  )
  const jobs = (source) =>
    [...source.matchAll(/^ {2}([a-zA-Z0-9_]+):\n(?= {4}name:)/gmu)].map(
      (match) => match[1]
    )
  const steps = (source) => source.match(/^ {6}- name:/gmu) ?? []

  assert.deepEqual(jobs(normal), [
    'plan',
    'build',
    'regression',
    'e2e',
    'phase11_release'
  ])
  assert.equal(steps(normal).length, 35)
  assert.deepEqual(jobs(candidate), ['candidate'])
  assert.equal(steps(candidate).length, 10)
  for (const name of [
    'Quality and production build',
    'Phase 10 real/mock browser and regression acceptance',
    'Phase 11 portable release and production-mode smoke'
  ]) {
    assert.equal(normal.split(name).length - 1, 1)
  }
  assert.doesNotMatch(normal + candidate, /previous-results|download-artifact/u)
  assert.equal(normal.split('uses: actions/upload-artifact@v4').length - 1, 1)
  assert.doesNotMatch(candidate, /upload-artifact/u)
  assert.doesNotMatch(normal + candidate, /run:\s+[^\n]*phase[0-9]/iu)
  assert.equal(
    normal.split('toJSON(github.event.changes) == toJSON(fromJSON').length - 1,
    8
  )
  assert.doesNotMatch(
    normal,
    /!github\.event\.changes\.base.*github\.event\.changes\.title/u
  )

  const packageFiles = [
    'package.json',
    'apps/web/package.json',
    'apps/admin/package.json',
    'apps/api/package.json',
    'packages/browser/package.json',
    'packages/contracts/package.json',
    'packages/domain/package.json'
  ]
  for (const file of packageFiles) {
    const scripts = Object.keys(
      JSON.parse(readFileSync(path.join(repositoryRoot, file), 'utf8'))
        .scripts ?? {}
    )
    assert.equal(
      scripts.some((script) => /phase[0-9]/iu.test(script)),
      false,
      file
    )
  }
  const rootScripts = Object.keys(
    JSON.parse(readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'))
      .scripts
  )
  assert.ok(rootScripts.length <= 60)
})

test('production bundles validate the commit stamped by their reused build', () => {
  const repositoryRoot = path.resolve(import.meta.dirname, '../..')
  const normal = readFileSync(
    path.join(repositoryRoot, '.github/workflows/ci.yml'),
    'utf8'
  )
  const candidate = readFileSync(
    path.join(repositoryRoot, '.github/workflows/candidate.yml'),
    'utf8'
  )
  const normalBuild = namedWorkflowStep(normal, 'Production build')
  const normalBundle = namedWorkflowStep(normal, 'Production bundle budget')
  const candidateBuild = namedWorkflowStep(
    candidate,
    'Core regression and production bundle'
  )

  for (const step of [normalBuild, candidateBuild]) {
    assert.equal(
      workflowStepEnvironment(step).get('VITE_RELEASE_ID'),
      '${{ github.sha }}'
    )
  }
  assert.match(normalBuild, /^ {8}run: .* quality build$/mu)
  assert.match(normalBundle, /^ {8}run: .* quality bundle$/mu)
  assert.doesNotMatch(normalBundle, /(?:quality|run) build/u)

  const candidateProductionBuild = candidateBuild.indexOf(
    'NODE_ENV=production pnpm run build'
  )
  const candidateBundleCheck = candidateBuild.indexOf(
    'NODE_ENV=production pnpm --filter @nihongo/web run test:bundle'
  )
  assert.ok(candidateProductionBuild > -1)
  assert.ok(candidateBundleCheck > candidateProductionBuild)
})

test('browser preparation reuses only unchanged same-job inputs and outputs', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'nihongo-browser-prep-'))
  const put = (name, value) => {
    const target = path.join(root, name)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, value)
  }
  const inputs = [
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    '.npmrc',
    'package.json',
    'packages/contracts/package.json',
    'packages/contracts/tsconfig.json',
    'packages/contracts/tsconfig.build.json',
    'packages/contracts/src/index.ts',
    'packages/domain/package.json',
    'packages/domain/tsconfig.json',
    'packages/domain/tsconfig.build.json',
    'packages/domain/src/index.ts',
    'apps/api/package.json',
    'apps/api/prisma.config.ts',
    'apps/api/prisma/schema.prisma'
  ]
  for (const input of inputs) put(input, input)
  const environment = {
    CI: 'true',
    GITHUB_RUN_ID: '1',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_JOB: 'e2e',
    GITHUB_SHA: 'a'.repeat(40),
    RUNNER_TEMP: root
  }
  const calls = []
  const run = async (_command, args) => {
    calls.push(args)
    const output =
      args[1] === '@nihongo/contracts'
        ? 'packages/contracts/dist/index.js'
        : args[1] === '@nihongo/domain'
          ? 'packages/domain/dist/index.js'
          : 'apps/api/src/generated/prisma/client.js'
    put(output, output)
  }
  try {
    const signal = new AbortController().signal
    await prepareBrowserArtifacts('real', signal, run, root, environment)
    assert.equal(calls.length, 3)
    await prepareBrowserArtifacts('real', signal, run, root, environment)
    await prepareBrowserArtifacts('mock', signal, run, root, environment)
    assert.equal(calls.length, 3)
    put('packages/contracts/dist/index.js', 'tampered')
    await prepareBrowserArtifacts('real', signal, run, root, environment)
    assert.equal(calls.length, 6)
    put('pnpm-lock.yaml', 'changed')
    await prepareBrowserArtifacts('real', signal, run, root, environment)
    assert.equal(calls.length, 9)
    await prepareBrowserArtifacts('real', signal, run, root, {
      ...environment,
      GITHUB_RUN_ATTEMPT: '2'
    })
    assert.equal(calls.length, 12)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})

const expectedBrowserCalls = (mode) => [
  {
    args: [
      '--filter',
      '@nihongo/api',
      'exec',
      'tsx',
      '../../scripts/runBrowser.ts',
      mode
    ],
    phase8: null
  }
]

const runBrowserScript = (script, fail = '') => {
  const directory = mkdtempSync(path.join(tmpdir(), 'nihongo-browser-stub-'))
  const logPath = path.join(directory, 'calls.jsonl')
  const stubPath = path.join(directory, 'pnpm')
  writeFileSync(logPath, '')
  writeFileSync(
    stubPath,
    `#!/usr/bin/env node
const { appendFileSync } = require('node:fs')
const args = process.argv.slice(2)
appendFileSync(
  process.env.BROWSER_STUB_LOG,
  JSON.stringify({
    args,
    phase8: process.env.PHASE8_BROWSER_ACCEPTANCE ?? null
  }) + '\\n'
)
if (
  process.env.BROWSER_STUB_FAIL &&
  args.some((argument) => argument.includes(process.env.BROWSER_STUB_FAIL))
) {
  process.exit(17)
}
`
  )
  chmodSync(stubPath, 0o755)

  try {
    const result = spawnSync('bash', ['-c', script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        BROWSER_STUB_FAIL: fail,
        BROWSER_STUB_LOG: logPath,
        PATH: `${directory}${path.delimiter}${process.env.PATH ?? ''}`
      }
    })
    const log = readFileSync(logPath, 'utf8').trim()
    return {
      calls: log ? log.split('\n').map((line) => JSON.parse(line)) : [],
      status: result.status,
      stderr: result.stderr
    }
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
}

const assertBrowserScript = (script, mode) => {
  const result = runBrowserScript(script)
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(result.calls, expectedBrowserCalls(mode))
  return result.calls
}

const assertWorkflowBrowserAliases = (source) => {
  const runs = source.split('\n').flatMap((line) => {
    const match = /^\s+run:\s+(.+?)\s*$/u.exec(line)
    return match ? [match[1]] : []
  })
  assert.equal(
    runs.filter((run) => run === 'pnpm run test:browser:real').length,
    1
  )
  assert.equal(
    runs.filter((run) => run === 'pnpm run test:browser:mock').length,
    0
  )
}

const findExecutableDeclaration = (source, declaration) => {
  let depth = 0
  let quote = ''
  let escaped = false
  let lineComment = false
  let blockComment = false
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    const next = source[index + 1]
    if (lineComment) {
      if (character === '\n') lineComment = false
      continue
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false
        index += 1
      }
      continue
    }
    if (quote) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === quote) quote = ''
      continue
    }
    if (character === '/' && next === '/') {
      lineComment = true
      index += 1
      continue
    }
    if (character === '/' && next === '*') {
      blockComment = true
      index += 1
      continue
    }
    if (["'", '"', '`'].includes(character)) {
      quote = character
      continue
    }
    if (depth === 0 && source.startsWith(declaration, index)) return index
    if (character === '{') depth += 1
    if (character === '}') depth -= 1
  }
  return -1
}

const extractArrowBody = (source, declaration) => {
  const start = findExecutableDeclaration(source, declaration)
  assert.notEqual(start, -1, declaration)
  const arrow = source.indexOf('=>', start)
  const bodyStart = source.indexOf('{', arrow)
  assert.ok(arrow > start && bodyStart > arrow, declaration)

  let depth = 0
  let quote = ''
  let escaped = false
  let lineComment = false
  let blockComment = false
  for (let index = bodyStart; index < source.length; index += 1) {
    const character = source[index]
    const next = source[index + 1]
    if (lineComment) {
      if (character === '\n') lineComment = false
      continue
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false
        index += 1
      }
      continue
    }
    if (quote) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === quote) quote = ''
      continue
    }
    if (character === '/' && next === '/') {
      lineComment = true
      index += 1
      continue
    }
    if (character === '/' && next === '*') {
      blockComment = true
      index += 1
      continue
    }
    if (["'", '"', '`'].includes(character)) {
      quote = character
      continue
    }
    if (character === '{') depth += 1
    if (character === '}' && --depth === 0) {
      return source.slice(bodyStart + 1, index)
    }
  }
  assert.fail(`${declaration}: unterminated body`)
}

const assertPlaywrightSelection = async (source, mode, suite, modeVariable) => {
  const body = extractArrowBody(source, 'const runPlaywright = async (')
  const invoke = runInNewContext(
    `(async (
      runCommand,
      browserMode,
      webOrigin,
      extraEnvironment,
      signal,
      playwrightArguments
    ) => {${body}})`,
    { process: { env: {} } }
  )
  const calls = []
  await invoke(
    (command, args, environment) => {
      calls.push(JSON.parse(JSON.stringify({ command, args, environment })))
    },
    mode,
    'http://browser.example.test',
    {},
    undefined,
    []
  )
  assert.equal(calls.length, 1)
  assert.equal(calls[0].command, 'pnpm')
  assert.deepEqual(calls[0].args, [
    'exec',
    'playwright',
    'test',
    '--config',
    'playwright.config.ts',
    suite,
    ...(modeVariable === 'PHASE9_BROWSER_MODE' && mode === 'mock'
      ? [
          '--grep',
          'guest routes pass KO/JA axe|learner routes pass KO/JA axe|color normalization regression'
        ]
      : [])
  ])
  assert.equal(calls[0].environment[modeVariable], mode)
}

test('Phase 9 mock starts only a local mock web server', async () => {
  const source = readFileSync(
    path.resolve(import.meta.dirname, '../runPhase9Browser.ts'),
    'utf8'
  )
  const body = extractArrowBody(source, 'export const runMockBrowser = async (')
  const calls = []
  const run = runInNewContext(
    `(async (runCommand, reserveLoopbackPort, spawnOwned, waitForHttp, runPlaywright, signal) => {${body}})`,
    { process: { env: {} }, playwrightArguments: [] }
  )
  await run(
    async (command, args, environment) =>
      calls.push({ type: 'command', command, args, environment }),
    async () => 1234,
    (label, command, args, environment) => {
      calls.push({ type: 'server', label, command, args, environment })
      return {}
    },
    async (url) => calls.push({ type: 'ready', url }),
    async (mode, url) => calls.push({ type: 'playwright', mode, url }),
    new AbortController().signal
  )
  const normalized = JSON.parse(JSON.stringify(calls))
  assert.deepEqual(
    normalized
      .filter(({ type }) => type === 'server')
      .map(({ label }) => label),
    ['phase9-mock-web']
  )
  assert.equal(
    normalized.find(({ type }) => type === 'server').environment
      .NIHONGO_API_PROXY_TARGET,
    'http://127.0.0.1:0'
  )
  assert.deepEqual(
    normalized
      .filter(({ type }) => type === 'playwright')
      .map(({ mode }) => mode),
    ['mock']
  )
  assert.equal(
    normalized.some(
      ({ command, args }) =>
        command === 'pnpm' && args?.some((arg) => /api|prisma|seed/iu.test(arg))
    ),
    false
  )
  const faultRun = normalized.find(
    ({ type, args }) =>
      type === 'command' && args?.includes('apps/web/e2e/journeys.spec.ts')
  )
  assert.ok(faultRun)
  assert.equal(faultRun.environment.PHASE10_BROWSER_MODE, 'mock')
  assert.equal(faultRun.args.includes('--grep'), false)
  const dashboardRun = normalized.find(
    ({ type, args }) =>
      type === 'command' && args?.includes('apps/web/e2e/dashboard.spec.ts')
  )
  assert.ok(dashboardRun)
  assert.equal(dashboardRun.environment.PHASE8_BROWSER_MODE, 'mock')
  assert.equal(dashboardRun.args.includes('--grep'), false)
})

test('API integration uses shared job preparation and seed avoids regeneration', async () => {
  const root = path.resolve(import.meta.dirname, '../..')
  const api = readFileSync(
    path.join(root, 'apps/api/src/e2e/runPhase7ApiIntegration.ts'),
    'utf8'
  )
  const database = readFileSync(
    path.join(root, 'apps/api/src/e2e/runDatabaseIntegration.ts'),
    'utf8'
  )
  const invoke = runInNewContext(
    `(async (abortSignal, environment, prepared, run, prepareBrowserArtifacts) => {${extractArrowBody(api, 'export const preparePhase7IntegrationArtifacts = async (')}})`,
    { repositoryRoot: root }
  )
  const calls = []
  await invoke(
    new AbortController().signal,
    {},
    false,
    () => calls.push('individual'),
    async (mode) => calls.push(mode)
  )
  assert.deepEqual(calls, ['real'])
  assert.match(database, /await prepareBrowserArtifacts\(/u)
  assert.match(
    database,
    /const seedCommand = \[[\s\S]*?'exec',[\s\S]*?'tsx',[\s\S]*?'prisma\/seed\.ts'/u
  )
})

const assertPhase7PlaywrightSelection = async (source, mode) => {
  const selectSpecs = runInNewContext(
    `(browserMode, phase8) => {${extractArrowBody(
      source,
      'export const selectPhase7BrowserSpecs = ('
    )}}`
  )
  const invoke = runInNewContext(
    `(async (
      runCommand,
      selectPhase7BrowserSpecs,
      createPhase7BrowserPlaywrightEnvironment,
      browserMode,
      webOrigin,
      extraEnvironment,
      playwrightArguments,
      includeDashboard
    ) => {${extractArrowBody(source, 'const runPlaywright = async (')}})`,
    { process: { env: {} } }
  )
  const selectionCalls = []
  const commandCalls = []
  await invoke(
    (command, args, environment) => {
      commandCalls.push(
        JSON.parse(JSON.stringify({ command, args, environment }))
      )
    },
    (browserMode, phase8) => {
      selectionCalls.push([browserMode, phase8])
      return selectSpecs(browserMode, phase8)
    },
    (browserMode, webOrigin, extraEnvironment) => ({
      browserMode,
      extraEnvironment,
      webOrigin
    }),
    mode,
    'http://browser.example.test',
    { FIXTURE: 'present' },
    [],
    true
  )
  const suites =
    mode === 'real'
      ? ['apps/web/e2e/admin-cms.spec.ts', 'apps/web/e2e/dashboard.spec.ts']
      : ['apps/web/e2e/dashboard.spec.ts']
  assert.deepEqual(selectionCalls, [[mode, true]])
  assert.deepEqual(commandCalls, [
    {
      args: [
        'exec',
        'playwright',
        'test',
        '--config',
        'playwright.config.ts',
        ...suites
      ],
      command: 'pnpm',
      environment: {
        browserMode: mode,
        extraEnvironment: { FIXTURE: 'present' },
        webOrigin: 'http://browser.example.test'
      }
    }
  ])
}

const executableTokens = (source) => {
  const tokens = []
  let newlineBefore = false
  for (let index = 0; index < source.length; ) {
    const character = source[index]
    const next = source[index + 1]
    if (/\s/u.test(character)) {
      if (character === '\n') newlineBefore = true
      index += 1
      continue
    }
    if (character === '/' && next === '/') {
      const end = source.indexOf('\n', index + 2)
      if (end === -1) break
      newlineBefore = true
      index = end + 1
      continue
    }
    if (character === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2)
      assert.notEqual(end, -1, 'unterminated block comment')
      if (source.slice(index, end + 2).includes('\n')) newlineBefore = true
      index = end + 2
      continue
    }

    const start = index
    if (["'", '"', '`'].includes(character)) {
      const quote = character
      index += 1
      let escaped = false
      while (index < source.length) {
        const value = source[index]
        if (escaped) escaped = false
        else if (value === '\\') escaped = true
        else if (value === quote) {
          index += 1
          break
        }
        index += 1
      }
      tokens.push({ newlineBefore, start, value: 'value' })
      newlineBefore = false
      continue
    }
    if (/[\p{L}_$]/u.test(character)) {
      index += 1
      while (/[\p{L}\p{N}_$]/u.test(source[index] ?? '')) index += 1
      tokens.push({
        newlineBefore,
        start,
        value: source.slice(start, index)
      })
      newlineBefore = false
      continue
    }
    if (/\d/u.test(character)) {
      index += 1
      while (/[\d._]/u.test(source[index] ?? '')) index += 1
      tokens.push({ newlineBefore, start, value: 'value' })
      newlineBefore = false
      continue
    }

    const operator = [
      '>>>=',
      '<<=',
      '>>=',
      '===',
      '!==',
      '>>>',
      '**=',
      '&&=',
      '||=',
      '??=',
      '...',
      '=>',
      '==',
      '!=',
      '<=',
      '>=',
      '&&',
      '||',
      '??',
      '?.',
      '++',
      '--',
      '**',
      '+=',
      '-=',
      '*=',
      '/=',
      '%=',
      '&=',
      '|=',
      '^=',
      '<<',
      '>>'
    ].find((candidate) => source.startsWith(candidate, index))
    const value = operator ?? character
    tokens.push({ newlineBefore, start, value })
    newlineBefore = false
    index += value.length
  }
  return tokens
}

const findDirectExecutableCall = (source, call) => {
  const cannotEndExpression = new Set([
    '=>',
    '(',
    '[',
    '{',
    ',',
    '...',
    '.',
    '?.',
    '?',
    ':',
    '=',
    '+=',
    '-=',
    '*=',
    '/=',
    '%=',
    '**=',
    '&=',
    '|=',
    '^=',
    '&&=',
    '||=',
    '??=',
    '<<=',
    '>>=',
    '>>>=',
    '+',
    '-',
    '*',
    '/',
    '%',
    '**',
    '&',
    '|',
    '^',
    '&&',
    '||',
    '??',
    '==',
    '!=',
    '===',
    '!==',
    '<',
    '>',
    '<=',
    '>=',
    '<<',
    '>>',
    '>>>',
    '!',
    '~',
    '++',
    '--',
    'await',
    'abstract',
    'as',
    'delete',
    'extends',
    'in',
    'infer',
    'instanceof',
    'keyof',
    'new',
    'readonly',
    'satisfies',
    'typeof',
    'unique',
    'void',
    'yield'
  ])
  const continuesExpression = new Set([
    '(',
    '[',
    ',',
    '.',
    '?.',
    '?',
    ':',
    '=',
    '+=',
    '-=',
    '*=',
    '/=',
    '%=',
    '**=',
    '&=',
    '|=',
    '^=',
    '&&=',
    '||=',
    '??=',
    '<<=',
    '>>=',
    '>>>=',
    '+',
    '-',
    '*',
    '/',
    '%',
    '**',
    '&',
    '|',
    '^',
    '&&',
    '||',
    '??',
    '==',
    '!=',
    '===',
    '!==',
    '<',
    '>',
    '<=',
    '>=',
    '<<',
    '>>',
    '>>>',
    '!',
    'as',
    'extends',
    'in',
    'instanceof',
    'satisfies'
  ])
  let braceDepth = 0
  let parenthesisDepth = 0
  let bracketDepth = 0
  let conciseArrow = false
  let parenthesisOwner = ''
  let terminated = false
  let beforePrevious = ''
  let previous = ''
  for (const token of executableTokens(source)) {
    const topLevel =
      braceDepth === 0 && parenthesisDepth === 0 && bracketDepth === 0
    if (
      topLevel &&
      conciseArrow &&
      token.newlineBefore &&
      !cannotEndExpression.has(previous) &&
      !continuesExpression.has(token.value)
    ) {
      conciseArrow = false
    }
    if (
      topLevel &&
      !conciseArrow &&
      !terminated &&
      source.startsWith(call, token.start)
    ) {
      return token.start
    }
    if (topLevel && token.value === '=>') conciseArrow = true
    const controlledExit =
      (previous === ')' &&
        ['for', 'if', 'while', 'with'].includes(parenthesisOwner)) ||
      (['do', 'else'].includes(previous) &&
        !['.', '?.'].includes(beforePrevious))
    if (
      topLevel &&
      !conciseArrow &&
      !controlledExit &&
      ['return', 'throw'].includes(token.value) &&
      !['.', '?.'].includes(previous)
    ) {
      terminated = true
    }
    if (topLevel && token.value === '(') {
      parenthesisOwner =
        ['for', 'if', 'while', 'with'].includes(previous) &&
        !['.', '?.'].includes(beforePrevious)
          ? previous
          : ''
    }
    if (token.value === '{') braceDepth += 1
    else if (token.value === '}') braceDepth -= 1
    else if (token.value === '(') parenthesisDepth += 1
    else if (token.value === ')') parenthesisDepth -= 1
    else if (token.value === '[') bracketDepth += 1
    else if (token.value === ']') bracketDepth -= 1
    else if (topLevel && token.value === ';') conciseArrow = false
    beforePrevious = previous
    previous = token.value
  }
  return -1
}

const assertExecutableCall = (source, declaration, call) => {
  assert.notEqual(
    findDirectExecutableCall(extractArrowBody(source, declaration), call),
    -1,
    `${declaration} -> ${call}`
  )
}

const assertBrowserRunnerCallGraph = ({ phase7, phase9, phase10 }) => {
  for (const [declaration, call] of [
    ['export const runMock = async (', "await runPlaywright('mock',"],
    ['export const runReal = async (', "await runPlaywright('real',"],
    ['const run = async (', 'await runMock()'],
    ['const run = async (', 'await runReal()']
  ]) {
    assertExecutableCall(phase7, declaration, call)
  }
  assertExecutableCall(
    phase9,
    'const runBrowser = async (',
    'await runPlaywright('
  )
  assertExecutableCall(phase9, 'const run = async (', 'await runBrowser(mode)')
  for (const [declaration, call] of [
    ['const runMock = async (', "await runPlaywright('mock',"],
    ['const runReal = async (', "await runPlaywright('real',"],
    ['const run = async (', 'await runMock()'],
    ['const run = async (', 'await runReal()']
  ]) {
    assertExecutableCall(phase10, declaration, call)
  }
}

const assertLiveRunnerSelections = async (repositoryRoot, calls, mode) => {
  assert.deepEqual(calls, expectedBrowserCalls(mode))
  const runnerPaths = [
    path.join(repositoryRoot, 'apps/api/src/e2e/runPhase7Browser.ts'),
    path.join(repositoryRoot, 'scripts/runPhase9Browser.ts'),
    path.join(repositoryRoot, 'scripts/runPhase10Browser.ts')
  ]
  const common = readFileSync(
    path.join(repositoryRoot, 'scripts/runBrowser.ts'),
    'utf8'
  )
  const mappingMatch =
    /const realWorkerModules = (\{[\s\S]*?\}) as const/u.exec(common)
  assert.ok(mappingMatch, 'real worker mapping is missing')
  const mapping = JSON.parse(
    JSON.stringify(runInNewContext(`(${mappingMatch[1]})`))
  )
  assert.deepEqual(mapping, {
    admin: '../apps/api/src/e2e/runPhase7Browser.js',
    accessibility: './runPhase9Browser.js',
    journey: './runPhase10Browser.js'
  })
  assertExecutableCall(
    common,
    'const runWorker = async (',
    'await worker.execute()'
  )
  if (mode === 'real') {
    const { calls: runnerCalls, error } =
      runIsolatedBrowserScenario('suite-failure')
    assert.equal(error, 'fixture failure')
    assert.deepEqual(
      runnerCalls
        .filter(({ args }) => args[4] === '--suite')
        .map(({ args }) => args[5]),
      ['admin', 'accessibility']
    )
  }

  const sources = {
    phase7: readFileSync(runnerPaths[0], 'utf8'),
    phase9: readFileSync(runnerPaths[1], 'utf8'),
    phase10: readFileSync(runnerPaths[2], 'utf8')
  }
  assertBrowserRunnerCallGraph(sources)
  await assertPhase7PlaywrightSelection(sources.phase7, mode)
  await assertPlaywrightSelection(
    sources.phase9,
    mode,
    'apps/web/e2e/accessibility.spec.ts',
    'PHASE9_BROWSER_MODE'
  )
  await assertPlaywrightSelection(
    sources.phase10,
    mode,
    'apps/web/e2e/journeys.spec.ts',
    'PHASE10_BROWSER_MODE'
  )
}

const withoutOnce = (source, fragment) => {
  const start = source.indexOf(fragment)
  assert.notEqual(start, -1, fragment)
  assert.equal(source.indexOf(fragment, start + fragment.length), -1, fragment)
  return source.slice(0, start) + source.slice(start + fragment.length)
}

const replaceOnce = (source, fragment, replacement) => {
  const start = source.indexOf(fragment)
  assert.notEqual(start, -1, fragment)
  assert.equal(source.indexOf(fragment, start + fragment.length), -1, fragment)
  return (
    source.slice(0, start) + replacement + source.slice(start + fragment.length)
  )
}

test('protected browser aliases execute every retained acceptance suite', async () => {
  const repositoryRoot = path.resolve(import.meta.dirname, '../..')
  const workflow = readFileSync(
    path.join(repositoryRoot, '.github/workflows/ci.yml'),
    'utf8'
  )
  const scripts = JSON.parse(
    readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8')
  ).scripts
  assertWorkflowBrowserAliases(workflow)

  for (const mode of ['real', 'mock']) {
    const calls = assertBrowserScript(scripts[`test:browser:${mode}`], mode)
    await assertLiveRunnerSelections(repositoryRoot, calls, mode)
  }

  const failure = runBrowserScript(
    scripts['test:browser:real'],
    'runBrowser.ts'
  )
  assert.equal(failure.status, 17)
  assert.deepEqual(failure.calls, expectedBrowserCalls('real'))
})

test('browser reachability rejects quoted, commented and dead edges', async () => {
  const repositoryRoot = path.resolve(import.meta.dirname, '../..')
  const workflow = readFileSync(
    path.join(repositoryRoot, '.github/workflows/ci.yml'),
    'utf8'
  )
  const scripts = JSON.parse(
    readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8')
  ).scripts
  assert.throws(() =>
    assertWorkflowBrowserAliases(
      workflow.replace(
        'run: pnpm run test:browser:real',
        '# run: pnpm run test:browser:real'
      )
    )
  )
  assert.throws(() =>
    assertWorkflowBrowserAliases(
      workflow.replace(
        'run: pnpm run test:browser:real',
        'run: pnpm run test:browser:real\n      - name: Unexpected mock\n        run: pnpm run test:browser:mock'
      )
    )
  )

  const real = scripts['test:browser:real']
  const call =
    'pnpm --filter @nihongo/api exec tsx ../../scripts/runBrowser.ts real'
  assert.throws(() =>
    assertBrowserScript(`printf "%s" "${call}" >/dev/null`, 'real')
  )
  assert.throws(() => assertBrowserScript(`# ${call}\ntrue`, 'real'))
  assert.throws(() =>
    assertBrowserScript(real.replace('runBrowser.ts', 'deadBrowser.ts'), 'real')
  )

  const phase9Source = readFileSync(
    path.join(repositoryRoot, 'scripts/runPhase9Browser.ts'),
    'utf8'
  )
  await assert.rejects(() =>
    assertPlaywrightSelection(
      phase9Source.replace(
        "'apps/web/e2e/accessibility.spec.ts'",
        "'apps/web/e2e/dead.spec.ts' /* apps/web/e2e/accessibility.spec.ts */"
      ),
      'real',
      'apps/web/e2e/accessibility.spec.ts',
      'PHASE9_BROWSER_MODE'
    )
  )
})

test('browser reachability rejects deleted or unreachable live calls', async () => {
  const repositoryRoot = path.resolve(import.meta.dirname, '../..')
  const sources = {
    phase7: readFileSync(
      path.join(repositoryRoot, 'apps/api/src/e2e/runPhase7Browser.ts'),
      'utf8'
    ),
    phase9: readFileSync(
      path.join(repositoryRoot, 'scripts/runPhase9Browser.ts'),
      'utf8'
    ),
    phase10: readFileSync(
      path.join(repositoryRoot, 'scripts/runPhase10Browser.ts'),
      'utf8'
    )
  }

  await assert.rejects(() =>
    assertPhase7PlaywrightSelection(
      withoutOnce(
        sources.phase7,
        '  const browserSpecs = selectPhase7BrowserSpecs(browserMode, includeDashboard)\n'
      ),
      'real'
    )
  )

  for (const [sourceName, fragment] of [
    ['phase7', "  await runPlaywright('mock', webOrigin)\n"],
    [
      'phase7',
      `  await runPlaywright('real', publicOrigin, {
    PHASE7_BROWSER_CONTROL_SECRET: controlSecret,
    PHASE7_BROWSER_CONTROL_URL: controlOrigin,
    PHASE7_BROWSER_FIXTURE: JSON.stringify(created.fixture),
    PHASE8_BROWSER_FIXTURE: JSON.stringify(created.fixture)
  })
`
    ],
    [
      'phase9',
      `  await runPlaywright(
    browserMode,
    webOrigin,
    { PHASE9_BROWSER_FIXTURE: JSON.stringify(created.fixture) },
    adminSignal
  )
`
    ],
    ['phase10', "  await runPlaywright('mock', webOrigin)\n"],
    ['phase10', "  await runPlaywright('real', webOrigin)\n"]
  ]) {
    assert.throws(
      () =>
        assertBrowserRunnerCallGraph({
          ...sources,
          [sourceName]: withoutOnce(sources[sourceName], fragment)
        }),
      `${sourceName}: ${fragment}`
    )
  }

  for (const [sourceName, fragment] of [
    ['phase7', 'await runMock()'],
    ['phase7', 'await runReal()'],
    ['phase9', 'await runBrowser(mode)'],
    ['phase10', 'await runMock()'],
    ['phase10', 'await runReal()']
  ]) {
    assert.throws(
      () =>
        assertBrowserRunnerCallGraph({
          ...sources,
          [sourceName]: withoutOnce(sources[sourceName], fragment)
        }),
      `${sourceName}: ${fragment}`
    )
  }

  const dispatcher = `  if (mode === 'mock') await runMock()
  else await runReal()
`
  for (const [sourceName, fragment, replacement] of [
    [
      'phase10',
      "  await runPlaywright('mock', webOrigin)\n",
      "  return\n  await runPlaywright('mock', webOrigin)\n"
    ],
    [
      'phase9',
      '  await runPlaywright(\n',
      "  throw new Error('unreachable')\n  await runPlaywright(\n"
    ],
    [
      'phase10',
      "  await runPlaywright('real', webOrigin)\n",
      "  object.if()\n  return\n  await runPlaywright('real', webOrigin)\n"
    ],
    [
      'phase7',
      "  await runPlaywright('mock', webOrigin)\n",
      "  object.else\n  throw new Error('unreachable')\n  await runPlaywright('mock', webOrigin)\n"
    ],
    [
      'phase7',
      dispatcher,
      `  return
${dispatcher}`
    ],
    [
      'phase9',
      '  await runBrowser(mode)\n',
      "  throw new Error('unreachable')\n  await runBrowser(mode)\n"
    ]
  ]) {
    assert.throws(
      () =>
        assertBrowserRunnerCallGraph({
          ...sources,
          [sourceName]: replaceOnce(sources[sourceName], fragment, replacement)
        }),
      `${sourceName}: ${fragment}`
    )
  }
})

test('browser reachability rejects expression-bodied dead runner closures', () => {
  const repositoryRoot = path.resolve(import.meta.dirname, '../..')
  const sources = {
    phase7: readFileSync(
      path.join(repositoryRoot, 'apps/api/src/e2e/runPhase7Browser.ts'),
      'utf8'
    ),
    phase9: readFileSync(
      path.join(repositoryRoot, 'scripts/runPhase9Browser.ts'),
      'utf8'
    ),
    phase10: readFileSync(
      path.join(repositoryRoot, 'scripts/runPhase10Browser.ts'),
      'utf8'
    )
  }

  for (const [sourceName, fragment, replacement] of [
    [
      'phase7',
      "  await runPlaywright('mock', webOrigin)\n",
      `  let target: unknown
  const dead = async () =>
    target
    = await runPlaywright('mock', webOrigin)
`
    ],
    [
      'phase7',
      `  await runPlaywright('real', publicOrigin, {
    PHASE7_BROWSER_CONTROL_SECRET: controlSecret,
    PHASE7_BROWSER_CONTROL_URL: controlOrigin,
    PHASE7_BROWSER_FIXTURE: JSON.stringify(created.fixture),
    PHASE8_BROWSER_FIXTURE: JSON.stringify(created.fixture)
  })
`,
      `  let target: unknown
  const dead = async () =>
    target as
    keyof
    typeof globalThis &&
    await runPlaywright('real', publicOrigin, {
      PHASE7_BROWSER_CONTROL_SECRET: controlSecret,
      PHASE7_BROWSER_CONTROL_URL: controlOrigin,
      PHASE7_BROWSER_FIXTURE: JSON.stringify(created.fixture),
      PHASE8_BROWSER_FIXTURE: JSON.stringify(created.fixture)
    })
`
    ],
    [
      'phase9',
      `  await runPlaywright(
    browserMode,
    webOrigin,
    { PHASE9_BROWSER_FIXTURE: JSON.stringify(created.fixture) },
    adminSignal
  )
`,
      `  const dead = async () =>
    await runPlaywright(
      browserMode,
      webOrigin,
      { PHASE9_BROWSER_FIXTURE: JSON.stringify(created.fixture) },
      adminSignal
    )
`
    ],
    [
      'phase10',
      "  await runPlaywright('mock', webOrigin)\n",
      `  const dead = async () =>
    true &&
    await runPlaywright('mock', webOrigin)
`
    ],
    [
      'phase10',
      "  await runPlaywright('real', webOrigin)\n",
      `  const dead = async () =>
    !
    await runPlaywright('real', webOrigin)
`
    ]
  ]) {
    assert.throws(
      () =>
        assertBrowserRunnerCallGraph({
          ...sources,
          [sourceName]: replaceOnce(sources[sourceName], fragment, replacement)
        }),
      `${sourceName}: ${fragment}`
    )
  }

  const conditional = `  if (mode === 'mock') await runMock()
  else await runReal()
`
  for (const sourceName of ['phase7', 'phase10']) {
    for (const replacement of [
      `  const deadMock = async () => await runMock()
  if (mode === 'mock') await Promise.resolve()
  else await runReal()
`,
      `  const deadReal = async () => await runReal()
  if (mode === 'mock') await runMock()
  else await Promise.resolve()
`
    ]) {
      assert.throws(() =>
        assertBrowserRunnerCallGraph({
          ...sources,
          [sourceName]: replaceOnce(
            sources[sourceName],
            conditional,
            replacement
          )
        })
      )
    }
  }

  assert.throws(() =>
    assertBrowserRunnerCallGraph({
      ...sources,
      phase9: replaceOnce(
        sources.phase9,
        '  await runBrowser(mode)\n',
        `  const dead = async () =>
    true
      ? await runBrowser(mode)
      : undefined
`
      )
    })
  )
})

const createDriver = ({ fail, cleanupFail } = {}) => {
  const calls = []
  const driver = {
    prepare: async (mode) => calls.push(`prepare:${mode}`),
    openSuite: async (suite) => {
      calls.push(`open:${suite}`)
      return {
        run: async () => {
          calls.push(`run:${suite}`)
          if (suite === fail) throw new Error('suite failed')
        },
        cleanup: async () => {
          calls.push(`cleanup:${suite}`)
          if (suite === cleanupFail) throw new Error('cleanup failed')
        }
      }
    }
  }
  return { calls, driver }
}

test('real prepares once and cleans each isolated suite before opening the next', async () => {
  const { calls, driver } = createDriver()
  await runBrowserSuites('real', driver, new AbortController().signal)
  assert.deepEqual(calls, [
    'prepare:real',
    'open:admin',
    'run:admin',
    'cleanup:admin',
    'open:accessibility',
    'run:accessibility',
    'cleanup:accessibility',
    'open:journey',
    'run:journey',
    'cleanup:journey'
  ])
})

test('mock runs only the mock states suite', async () => {
  const { calls, driver } = createDriver()
  await runBrowserSuites('mock', driver, new AbortController().signal)
  assert.deepEqual(calls, [
    'prepare:mock',
    'open:mock-states',
    'run:mock-states',
    'cleanup:mock-states'
  ])
})

test('intermediate failure cleans its resources and prevents later suites', async () => {
  const { calls, driver } = createDriver({ fail: 'accessibility' })
  await assert.rejects(
    runBrowserSuites('real', driver, new AbortController().signal),
    /suite failed/u
  )
  assert.equal(calls.at(-1), 'cleanup:accessibility')
  assert.equal(calls.includes('open:journey'), false)
})

test('retains both the suite and cleanup failures', async () => {
  const { driver } = createDriver({ fail: 'admin', cleanupFail: 'admin' })
  await assert.rejects(
    runBrowserSuites('real', driver, new AbortController().signal),
    (error) => error instanceof AggregateError && error.errors.length === 2
  )
})

test('cancellation after suite start cleans resources and stops the chain', async () => {
  const controller = new AbortController()
  const { calls, driver } = createDriver()
  const open = driver.openSuite
  driver.openSuite = async (suite) => {
    const resources = await open(suite)
    return { ...resources, run: async () => controller.abort() }
  }
  await assert.rejects(runBrowserSuites('real', driver, controller.signal))
  assert.equal(calls.at(-1), 'cleanup:admin')
  assert.equal(calls.includes('open:accessibility'), false)
})

test('rejects an invalid mode before preparation', async () => {
  const { calls, driver } = createDriver()
  await assert.rejects(
    runBrowserSuites('invalid', driver, new AbortController().signal),
    /accepts real or mock/u
  )
  assert.deepEqual(calls, [])
})

test('propagates even an undefined thrown value after cleanup', async () => {
  const { calls, driver } = createDriver()
  const open = driver.openSuite
  driver.openSuite = async (suite) => ({
    ...(await open(suite)),
    run: async () => {
      throw undefined
    }
  })
  let rejected = false
  try {
    await runBrowserSuites('real', driver, new AbortController().signal)
  } catch {
    rejected = true
  }
  assert.equal(rejected, true)
  assert.equal(calls.at(-1), 'cleanup:admin')
  assert.equal(calls.includes('open:accessibility'), false)
})

test('a preparation failure never opens a fixture', async () => {
  const { calls, driver } = createDriver()
  driver.prepare = async () => {
    calls.push('prepare-failed')
    throw new Error('prepare failed')
  }
  await assert.rejects(
    runBrowserSuites('real', driver, new AbortController().signal),
    /prepare failed/u
  )
  assert.deepEqual(calls, ['prepare-failed'])
})

const runIsolatedBrowserScenario = (scenario) => {
  const root = mkdtempSync(path.join(tmpdir(), 'nihongo-browser-job-'))
  const repositoryRoot = path.resolve(import.meta.dirname, '../..')
  const put = (name, content) => {
    const target = path.join(root, name)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  const inputs = [
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    '.npmrc',
    'package.json',
    'packages/contracts/package.json',
    'packages/contracts/tsconfig.json',
    'packages/contracts/tsconfig.build.json',
    'packages/contracts/src/index.ts',
    'packages/domain/package.json',
    'packages/domain/tsconfig.json',
    'packages/domain/tsconfig.build.json',
    'packages/domain/src/index.ts',
    'apps/api/package.json',
    'apps/api/prisma.config.ts',
    'apps/api/prisma/schema.prisma'
  ]
  for (const input of inputs) {
    put(
      input,
      input === 'apps/api/package.json'
        ? '{"type":"module"}'
        : input.endsWith('package.json')
          ? '{"private":true}'
          : input
    )
  }
  for (const file of [
    'scripts/runBrowser.ts',
    'apps/api/src/e2e/browserArtifactPreparation.ts'
  ]) {
    const target = path.join(root, file)
    mkdirSync(path.dirname(target), { recursive: true })
    copyFileSync(path.join(repositoryRoot, file), target)
  }
  put(
    'scenario.mjs',
    `
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { runBrowserMode } from './scripts/runBrowser.ts'
import { prepareBrowserArtifacts } from './apps/api/src/e2e/browserArtifactPreparation.ts'
const root = process.cwd()
const calls = []
const runCommand = async (command, args, env) => {
  calls.push({ command, args, prepared: env.JLP541_BROWSER_ARTIFACTS_PREPARED ?? null })
  if (process.argv[2] === 'failure') throw new Error('build failed')
  if (process.argv[2] === 'suite-failure' && args[4] === '--suite' && args[5] === 'accessibility') throw new Error('fixture failure')
  const output = args[1] === '@nihongo/contracts' ? 'packages/contracts/dist/index.js'
    : args[1] === '@nihongo/domain' ? 'packages/domain/dist/index.js'
    : args[1] === '@nihongo/api' ? 'apps/api/src/generated/prisma/client.js' : undefined
  if (output) {
    mkdirSync(path.dirname(path.join(root, output)), { recursive: true })
    writeFileSync(path.join(root, output), output)
  }
}
const adapter = { runCommand, runMockBrowser: async () => { throw Error('unexpected mock') }, cleanup: async () => {} }
delete process.env.JLP541_BROWSER_ARTIFACTS_PREPARED
let preparation = []
if (process.argv[2] === 'preprepared') {
  await prepareBrowserArtifacts('real', new AbortController().signal, runCommand, root, process.env)
  preparation = calls.splice(0)
}
let error = null
try {
  await runBrowserMode('real', new AbortController().signal, [], {
    loadBrowserAdapter: async () => adapter, resolveTsx: () => 'test-loader'
  })
} catch (caught) {
  error = caught instanceof Error ? caught.message : 'unknown failure'
}
process.stdout.write(JSON.stringify({ preparation, calls, error }))
`
  )
  try {
    const result = spawnSync(process.execPath, ['scenario.mjs', scenario], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CI: 'true',
        GITHUB_RUN_ID: '309',
        GITHUB_RUN_ATTEMPT: '1',
        GITHUB_JOB: 'quality',
        GITHUB_SHA: 'a'.repeat(40),
        RUNNER_TEMP: root
      }
    })
    assert.equal(result.status, 0, result.stderr)
    return JSON.parse(result.stdout)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
}

const assertThreeWorkers = (calls) => {
  assert.deepEqual(
    calls.map(({ args }) => args[5]),
    ['admin', 'accessibility', 'journey']
  )
  assert.equal(
    calls.every(
      ({ command, args }) =>
        command === process.execPath && args[4] === '--suite'
    ),
    true
  )
  assert.equal(
    calls.every(({ prepared }) => prepared === '1'),
    true
  )
}

test('standalone real prepares artifacts once and starts three separate workers', () => {
  const { preparation, calls, error } = runIsolatedBrowserScenario('standalone')
  assert.equal(error, null)
  assert.deepEqual(preparation, [])
  assert.equal(calls.length, 6)
  assert.deepEqual(
    calls.slice(0, 3).map(({ args }) => args.at(-1)),
    ['build', 'build', 'db:generate']
  )
  assert.equal(
    calls.slice(0, 3).every(({ prepared }) => prepared === null),
    true
  )
  assertThreeWorkers(calls.slice(3))
})

test('pre-prepared real job reuses manifest and starts three separate workers', () => {
  const { preparation, calls, error } =
    runIsolatedBrowserScenario('preprepared')
  assert.equal(error, null)
  assert.deepEqual(
    preparation.map(({ args }) => args.at(-1)),
    ['build', 'build', 'db:generate']
  )
  assert.equal(calls.length, 3)
  assertThreeWorkers(calls)
})

test('a failed artifact build cannot start a fixture', () => {
  const { preparation, calls, error } = runIsolatedBrowserScenario('failure')
  assert.deepEqual(preparation, [])
  assert.equal(error, 'build failed')
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].args, [
    '--filter',
    '@nihongo/contracts',
    'run',
    'build'
  ])
})

test('a cancelled mock build stops its owned child and returns SIGTERM status', async () => {
  const repositoryRoot = path.resolve(import.meta.dirname, '../..')
  const temp = mkdtempSync(path.join(tmpdir(), 'nihongo-browser-cancel-'))
  const ready = path.join(temp, 'ready')
  const stopped = path.join(temp, 'stopped')
  const fakePnpm = path.join(temp, 'pnpm')
  writeFileSync(
    fakePnpm,
    `#!/usr/bin/env node
const fs = require('node:fs')
process.once('SIGTERM', () => { fs.writeFileSync(process.env.MOCK_STOPPED_FILE, 'stopped'); process.exit(0) })
fs.writeFileSync(process.env.MOCK_READY_FILE, 'ready')
setInterval(() => {}, 1000)
`
  )
  chmodSync(fakePnpm, 0o755)
  const loader = createRequire(
    path.join(repositoryRoot, 'apps/api/package.json')
  ).resolve('tsx')
  const child = spawn(
    process.execPath,
    [
      '--import',
      loader,
      path.join(repositoryRoot, 'scripts/runBrowser.ts'),
      'mock'
    ],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        MOCK_READY_FILE: ready,
        MOCK_STOPPED_FILE: stopped,
        RUNNER_TEMP: temp,
        PATH: `${temp}${path.delimiter}${process.env.PATH ?? ''}`
      },
      stdio: ['ignore', 'ignore', 'pipe']
    }
  )
  let stderr = ''
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => resolve({ code, signal }))
  })
  try {
    const deadline = Date.now() + 10_000
    while (
      !existsSync(ready) &&
      child.exitCode === null &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.equal(existsSync(ready), true, stderr)
    child.kill('SIGTERM')
    assert.deepEqual(await closed, { code: 143, signal: null })
    assert.equal(existsSync(stopped), true, stderr)
    assert.doesNotMatch(stderr, /did not stop|cleanup failed/iu)
  } finally {
    if (child.exitCode === null && child.signalCode === null)
      child.kill('SIGTERM')
    rmSync(temp, { recursive: true, force: true })
  }
})
