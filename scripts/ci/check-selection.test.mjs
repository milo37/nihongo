import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import {
  selectChecks,
  readSelection,
  qualityCommands,
  assertSelectedResults
} from './check-selection.mjs'

const event = {
  pull_request: {
    base: { ref: 'dev', sha: 'a'.repeat(40) },
    head: { ref: 'feature/test', sha: 'b'.repeat(40) }
  }
}
const pr = (files, extra = {}) =>
  selectChecks({
    eventName: 'pull_request',
    ref: 'refs/pull/1/merge',
    event,
    changedFiles: files,
    ...extra
  })

test('docs PR formats only; code chooses dependent packages without unrelated DB/OCI work', () => {
  const docs = pr(['README.md', 'team/design.md'])
  assert.equal(docs.code, false)
  assert.equal(docs.database, false)
  assert.equal(docs.browser, false)
  assert.equal(docs.portable, false)
  const web = pr(['apps/web/src/components/Button.tsx'])
  assert.equal(web.web, true)
  assert.equal(web.api, false)
  assert.equal(web.database, false)
  assert.equal(web.browser, true)
  assert.equal(web.portable, false)
  assert.ok(
    !qualityCommands(web, 'unit').some(
      (args) => args.includes('@nihongo/api') || args.includes('test:domain')
    )
  )
  assert.ok(
    qualityCommands(web, 'build').some((args) => args.includes('@nihongo/web'))
  )
  assert.equal(qualityCommands(web, 'typecheck').length, 0)
  assert.ok(!qualityCommands(web, 'prepare').flat().includes('db:generate'))
  const api = pr(['apps/api/src/routes/questions.ts'])
  assert.equal(
    qualityCommands(api, 'typecheck').filter((args) =>
      args.includes('db:generate')
    ).length,
    1
  )
  assert.equal(api.database, true)
  assert.equal(api.browser, true)
  assert.equal(api.web, false)
  assert.ok(
    !qualityCommands(api, 'unit').some((args) => args.includes('test:web'))
  )
})

test('auth/storage, shared contracts/domain and content retain DB and both browser transports', () => {
  for (const file of [
    'apps/web/src/api/study/save.ts',
    'apps/web/src/app/practice/hooks/useSubmit.ts',
    'apps/web/src/stores/auth.ts',
    'apps/api/prisma/schema.prisma',
    'packages/contracts/src/study.ts',
    'packages/domain/src/result.ts',
    'content/questions/n5.json'
  ]) {
    const selection = pr([file])
    assert.equal(selection.database, true, file)
    assert.equal(selection.browser, true, file)
  }
  for (const folder of ['packages/contracts', 'packages/domain', 'content']) {
    const selection = pr([`${folder}/data.json`])
    assert.equal(selection.web, true)
    assert.equal(selection.api, true)
  }
})

test('operations PR, CI/common changes, unknown paths or comparison fail conservatively', () => {
  for (const file of [
    'Dockerfile',
    'compose.yaml',
    'operations/environment-contract.v1.json',
    '.github/workflows/ci.yml',
    'scripts/ci/check-selection.mjs',
    'pnpm-lock.yaml',
    'package.json',
    'new-area/file.bin',
    'apps/web/package.json',
    'apps/web/vite.config.ts',
    'packages/contracts/src/study.ts',
    'apps/api/src/db/databaseTargetGuard.ts',
    'apps/api/prisma/seedQuestionCatalog.ts',
    'apps/api/src/auth/authorize.ts'
  ]) {
    const selection = pr([file])
    assert.ok(
      selection.database &&
        selection.browser &&
        selection.portable &&
        selection.performance,
      file
    )
  }
  for (const selection of [
    pr(undefined),
    pr(['../escape']),
    pr(['apps/web/a.ts'], {
      event: {
        pull_request: {
          base: { ref: 'dev', sha: '' },
          head: event.pull_request.head
        }
      }
    })
  ])
    assert.ok(selection.database && selection.portable)
  assert.equal(pr([]).code, false)
})

test('dev/main pushes, main PR, tag, manual/release and unexpected events cover integration/final gates', () => {
  for (const [eventName, ref] of [
    ['push', 'refs/heads/dev'],
    ['push', 'refs/heads/main'],
    ['push', 'refs/tags/v0.2.0'],
    ['workflow_dispatch', 'refs/heads/dev'],
    ['release', 'refs/tags/v0.2.0'],
    ['push', 'refs/heads/unexpected'],
    ['unknown', '']
  ]) {
    const selection = selectChecks({ eventName, ref, event: {} })
    assert.ok(
      selection.database &&
        selection.browser &&
        selection.portable &&
        selection.performance,
      `${eventName}/${ref}`
    )
  }
  assert.equal(
    pr(['README.md'], {
      event: {
        pull_request: {
          ...event.pull_request,
          base: { ...event.pull_request.base, ref: 'main' }
        }
      }
    }).mode,
    'candidate'
  )
  assert.equal(
    pr(['README.md'], {
      event: {
        pull_request: {
          ...event.pull_request,
          base: { ...event.pull_request.base, ref: 'other' }
        }
      }
    }).mode,
    'conservative'
  )
})

test('event/Git resolution binds PR head to actual checkout and compares base...head including deletions', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'ci-selection-'))
  try {
    const file = path.join(directory, 'event.json')
    writeFileSync(file, JSON.stringify(event))
    const calls = []
    const env = {
      GITHUB_EVENT_PATH: file,
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_REF: 'refs/pull/1/merge',
      GITHUB_SHA: 'c'.repeat(40)
    }
    const git = (_command, args) => {
      calls.push(args)
      return args[0] === 'diff' ? 'apps/api/src/auth/removed.ts\0' : ''
    }
    assert.equal(readSelection(env, git).database, true)
    assert.deepEqual(calls[0], [
      'merge-base',
      '--is-ancestor',
      'b'.repeat(40),
      'c'.repeat(40)
    ])
    assert.deepEqual(calls[1], [
      'diff',
      '--no-renames',
      '--name-only',
      '-z',
      `${'a'.repeat(40)}...${'b'.repeat(40)}`
    ])
    assert.equal(
      readSelection(env, () => {
        throw new Error('missing commit')
      }).portable,
      true
    )
    writeFileSync(file, '{')
    assert.equal(readSelection(env, git).portable, true)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('required checks accept intentional omissions but reject missing/failed/cancelled plan or selected work', () => {
  const selection = pr(['README.md'])
  for (const job of ['build', 'e2e', 'phase11_release'])
    assert.doesNotThrow(() =>
      assertSelectedResults({
        job,
        planResult: 'success',
        selection,
        steps: {
          format: { outcome: 'success' },
          selection_contracts: { outcome: 'success' }
        }
      })
    )
  for (const planResult of ['failure', 'cancelled', 'skipped', undefined])
    assert.throws(() =>
      assertSelectedResults({ job: 'e2e', planResult, selection, steps: {} })
    )
  for (const outcome of ['failure', 'cancelled', 'skipped', undefined])
    assert.throws(() =>
      assertSelectedResults({
        job: 'e2e',
        planResult: 'success',
        selection: pr(['apps/web/a.ts']),
        steps: { phase10_browser_real: { outcome } }
      })
    )
  assert.throws(() =>
    assertSelectedResults({
      job: 'e2e',
      planResult: 'success',
      selection,
      steps: { checkout: { outcome: 'failure' } }
    })
  )
  assert.throws(() =>
    assertSelectedResults({
      job: 'build',
      planResult: 'success',
      selection,
      steps: {}
    })
  )
  assert.throws(() =>
    assertSelectedResults({
      job: 'build',
      planResult: 'success',
      selection: null,
      steps: {}
    })
  )
})

test('quality child failure and cancellation remain nonzero and stop later preparation commands', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'ci-quality-'))
  try {
    const bin = path.join(directory, 'pnpm')
    const log = path.join(directory, 'calls')
    for (const [action, expected] of [
      ['exit 7', 7],
      ['kill -TERM $$', 143],
      ['kill -INT $$', 130]
    ]) {
      writeFileSync(
        bin,
        `#!/bin/sh\nprintf 'called\\n' >> "$CI_TEST_CALLS"\n${action}\n`,
        { mode: 0o700 }
      )
      writeFileSync(log, '')
      const result = spawnSync(
        process.execPath,
        [
          path.join(import.meta.dirname, 'check-selection.mjs'),
          'quality',
          'prepare'
        ],
        {
          env: {
            ...process.env,
            PATH: `${directory}:${process.env.PATH}`,
            CI_SELECTION: JSON.stringify(pr(['apps/api/a.ts'])),
            CI_PLAN_RESULT: 'success',
            CI_TEST_CALLS: log
          },
          encoding: 'utf8'
        }
      )
      assert.equal(result.status, expected, result.stderr)
      assert.equal(readFileSync(log, 'utf8'), 'called\n')
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('selected integration succeeds only with every required group completed', () => {
  const selection = selectChecks({
    eventName: 'push',
    ref: 'refs/heads/dev',
    event: {}
  })
  const groups = {
    build: [
      'format',
      'selection_contracts',
      'prepare',
      'lint',
      'architecture',
      'typecheck',
      'static_contracts',
      'static_phase10',
      'static_phase11',
      'unit',
      'build',
      'production_mock',
      'worker_exclusion',
      'integration',
      'foundation',
      'phase10_security_evidence',
      'phase10_performance_evidence'
    ],
    e2e: [
      'phase10_playwright_initialize',
      'phase10_browser_real',
      'phase10_browser_mock',
      'phase10_playwright_evidence'
    ],
    phase11_release: ['phase11_release']
  }
  for (const [job, ids] of Object.entries(groups)) {
    const steps = Object.fromEntries(
      ids.map((id) => [id, { outcome: 'success' }])
    )
    assert.doesNotThrow(() =>
      assertSelectedResults({ job, planResult: 'success', selection, steps })
    )
    for (const id of ids) {
      for (const outcome of ['skipped', 'failure', 'cancelled']) {
        assert.throws(
          () =>
            assertSelectedResults({
              job,
              planResult: 'success',
              selection,
              steps: { ...steps, [id]: { outcome } }
            }),
          `${job}/${id}/${outcome}`
        )
      }
    }
  }
})

test('workflow keeps required checks present, conditional resources, final outcome checks and no workflow paths filter', () => {
  const workflow = readFileSync(
    new URL('../../.github/workflows/ci.yml', import.meta.url),
    'utf8'
  )
  assert.doesNotMatch(workflow, /^\s+paths(?:-ignore)?:/mu)
  assert.match(workflow, /workflow_dispatch:/u)
  assert.match(workflow, /types: \[opened, synchronize, reopened, edited\]/u)
  assert.match(workflow, /tags:\n\s+- 'v\*'/u)
  for (const [id, name] of [
    ['build', 'Quality and production build'],
    ['e2e', 'Phase 10 real/mock browser and regression acceptance'],
    ['phase11_release', 'Phase 11 portable release and production-mode smoke']
  ]) {
    const start = workflow.indexOf(`\n  ${id}:`)
    const end = workflow.slice(start + 1).search(/\n {2}[a-z0-9_]+:/u)
    const job = workflow.slice(start, end < 0 ? undefined : start + 1 + end)
    assert.ok(job.includes(`name: ${name}`))
    assert.match(job, /needs: plan\n {4}if: \$\{\{ always\(\) \}\}/u)
    assert.ok(
      job.includes(`run: node scripts/ci/check-selection.mjs verify ${id}`)
    )
    assert.ok(job.includes('CI_PLAN_RESULT: ${{ needs.plan.result }}'))
    assert.match(
      job,
      /name: Verify selected checks completed\n {8}if: \$\{\{ always\(\) \}\}/u
    )
  }
  assert.match(
    workflow,
    /image: \$\{\{ needs\.plan\.outputs\.database == 'true' && 'postgres:/u
  )
  assert.match(
    workflow,
    /image: \$\{\{ needs\.plan\.outputs\.browser == 'true' && 'postgres:/u
  )
  assert.doesNotMatch(workflow, /continue-on-error:/u)
})
