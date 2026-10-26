import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import {
  selectChecks,
  readSelection,
  readPreviousCodeResults,
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

test('only well-formed title/body edits skip existing PR code scopes on dev or main', () => {
  for (const ref of ['dev', 'main']) {
    for (const changes of [
      { title: { from: 'old title' } },
      { body: { from: '' } },
      { title: { from: 'old title' }, body: { from: 'old body' } }
    ]) {
      const selection = pr(['.github/workflows/ci.yml'], {
        event: {
          action: 'edited',
          changes,
          pull_request: {
            ...event.pull_request,
            base: { ...event.pull_request.base, ref }
          }
        }
      })
      assert.equal(selection.mode, 'metadata')
      assert.deepEqual(selection.files, [])
      assert.ok(
        Object.values(selection)
          .filter((v) => typeof v === 'boolean')
          .every((v) => !v)
      )
    }
  }
  for (const changes of [
    undefined,
    null,
    [],
    {},
    { base: { ref: { from: 'main' }, sha: { from: 'c'.repeat(40) } } },
    { title: { from: 'old' }, base: { ref: { from: 'main' } } },
    { title: { from: 'old' }, unknown: {} },
    { title: {} },
    { title: { from: 1 } },
    { body: { from: null } },
    { title: { from: 'old', unknown: true } }
  ]) {
    assert.notEqual(
      pr(['apps/api/src/routes/questions.ts'], {
        event: { ...event, action: 'edited', changes }
      }).mode,
      'metadata'
    )
  }
  for (const action of ['opened', 'synchronize', 'reopened', undefined]) {
    assert.equal(
      pr(['apps/api/src/routes/questions.ts'], {
        event: { ...event, action, changes: { title: { from: 'old' } } }
      }).api,
      true
    )
  }
  for (const base of [
    { ...event.pull_request.base, ref: 'other' },
    { ...event.pull_request.base, sha: '' }
  ]) {
    assert.equal(
      pr(['apps/api/src/routes/questions.ts'], {
        event: {
          action: 'edited',
          changes: { title: { from: 'old' } },
          pull_request: { ...event.pull_request, base }
        }
      }).mode,
      'conservative'
    )
  }
})

test('docs PR formats only; code chooses dependent packages without unrelated DB/OCI work', () => {
  const docs = pr([
    'README.md',
    'team/design.md',
    'apps/web/src/provider/README.md'
  ])
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
  assert.deepEqual(qualityCommands(web, 'typecheck'), [
    ['--filter', '@nihongo/browser', 'run', 'typecheck']
  ])
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

for (const file of [
  'apps/web/src/api/README.md',
  'apps/web/src/stores/storage.TXT',
  'apps/web/src/app/auth/README.md',
  'apps/web/src/app/practice/README.md',
  'apps/web/src/app/admin/notes.txt',
  'apps/web/src/mocks/README.MD',
  'apps/web/src/provider/README.md',
  'apps/api/src/auth/README.md',
  'apps/api/src/db/notes.txt',
  'packages/browser/README.md'
]) {
  test(`sensitive-path documentation adds no runtime checks alone or beside ordinary web code: ${file}`, () => {
    assert.deepEqual({ ...pr([file]), files: [] }, pr([]))
    const code = 'apps/web/src/components/Button.tsx'
    for (const files of [
      [file, code],
      [code, file]
    ])
      assert.deepEqual(
        { ...pr(files), files: [] },
        { ...pr([code]), files: [] }
      )
  })
}

for (const file of [
  'apps/web/src/libs/authTransitionFence.ts',
  'apps/web/src/provider/AuthErrorHandlerProvider.tsx'
]) {
  test(`shared authentication infrastructure selects conservative coverage: ${file}`, () => {
    assert.ok(
      readFileSync(
        new URL(
          `../../${file.replace('apps/web/src/', 'packages/browser/src/')}`,
          import.meta.url
        ),
        'utf8'
      ).length > 0
    )
    const selection = pr([file])
    assert.equal(selection.database, true, `${file} must retain DB integration`)
    assert.equal(selection.mode, 'conservative')
    for (const flag of [
      'web',
      'api',
      'browser',
      'security',
      'performance',
      'portable'
    ])
      assert.equal(selection[flag], true, `${file}/${flag}`)
  })
}

test('auth/storage, shared contracts/domain and content retain DB and both browser transports', () => {
  for (const file of [
    'apps/web/src/api/study/save.ts',
    'apps/web/src/app/practice/hooks/useSubmit.ts',
    'apps/web/src/stores/auth.ts',
    'apps/web/src/app/auth/useAuth.ts',
    'apps/web/src/app/admin/useAdmin.ts',
    'apps/web/src/mocks/handlers/question.ts',
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
    '.github/workflows/README.md',
    '.github/workflows/notes.txt',
    'scripts/ci/check-selection.mjs',
    'pnpm-lock.yaml',
    'package.json',
    'new-area/file.bin',
    'apps/web/package.json',
    'apps/web/vite.config.ts',
    'packages/contracts/src/study.ts',
    'apps/api/src/db/databaseTargetGuard.ts',
    'apps/api/prisma/seedQuestionCatalog.ts',
    'apps/api/src/auth/authorize.ts',
    'apps/admin/src/router.tsx',
    'packages/browser/src/libs/authTransitionFence.ts'
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
    writeFileSync(
      file,
      JSON.stringify({
        ...event,
        action: 'edited',
        changes: { title: { from: 'old' } }
      })
    )
    assert.equal(readSelection(env, git).mode, 'metadata')
    assert.equal(
      readSelection(env, () => {
        throw new Error('missing commit')
      }).mode,
      'conservative'
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
      'admin_boundary',
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
      /name: Verify selected checks completed\n {8}if: \$\{\{ always\(\) && needs\.plan\.outputs\.metadata_only != 'true' \}\}/u
    )
  }
  assert.match(
    workflow,
    /image: \$\{\{ needs\.plan\.outputs\.database == 'true' && needs\.plan\.outputs\.metadata_only != 'true' && 'postgres:/u
  )
  assert.match(
    workflow,
    /image: \$\{\{ needs\.plan\.outputs\.browser == 'true' && needs\.plan\.outputs\.metadata_only != 'true' && 'postgres:/u
  )
  assert.doesNotMatch(workflow, /continue-on-error:/u)
})

test('metadata workflow cannot replace required results or cancel running/pending code CI', () => {
  const workflow = readFileSync(
    new URL('../../.github/workflows/ci.yml', import.meta.url),
    'utf8'
  )
  assert.ok(
    workflow.includes(
      'metadata_only: ${{ steps.selection.outputs.metadata_only }}'
    )
  )
  assert.match(workflow, /cancel-in-progress: true/u)
  const group = workflow.match(/^ {2}group: (.+)$/mu)[1]
  // These expressions use operators shared by Actions and JavaScript, plus format/always.
  const evaluate = (expression, context) =>
    runInNewContext(expression, {
      ...context,
      always: () => true,
      cancelled: () => false,
      success: () => true,
      failure: () => false,
      format: (template, value) => template.replace('{0}', value)
    })
  const interpolate = (template, context) =>
    template.replace(/\$\{\{(.*?)\}\}/gu, (_match, expression) =>
      String(evaluate(expression, context))
    )
  const github = {
    ref: 'refs/pull/1/merge',
    run_id: 7,
    event_name: 'pull_request',
    event: { action: 'synchronize', changes: {} }
  }
  const codeGroup = interpolate(group, { github })
  for (const action of ['opened', 'synchronize', 'reopened']) {
    assert.equal(
      interpolate(group, {
        github: { ...github, event: { action, changes: {} } }
      }),
      codeGroup
    )
  }
  for (const event_name of ['push', 'workflow_dispatch', 'release']) {
    assert.equal(
      interpolate(group, {
        github: {
          ...github,
          event_name,
          event: { action: 'edited', changes: {} }
        }
      }),
      codeGroup
    )
  }
  const edited = {
    ...github,
    event: { action: 'edited', changes: { title: { from: 'old' } } }
  }
  const metadataGroup = interpolate(group, { github: edited })
  assert.notEqual(metadataGroup, codeGroup)
  assert.notEqual(
    interpolate(group, { github: { ...edited, run_id: 8 } }),
    metadataGroup
  )
  assert.equal(
    interpolate(group, {
      github: {
        ...edited,
        event: {
          ...edited.event,
          changes: { ...edited.event.changes, base: { ref: { from: 'main' } } }
        }
      }
    }),
    codeGroup
  )
  for (const [id, requiredName] of [
    ['build', 'Quality and production build'],
    ['e2e', 'Phase 10 real/mock browser and regression acceptance'],
    ['phase11_release', 'Phase 11 portable release and production-mode smoke']
  ]) {
    const job = workflow.split(`\n  ${id}:`)[1].split(/\n {2}[a-z0-9_]+:/u)[0]
    const name = job.match(/^ {4}name: (.+)$/mu)[1]
    const condition = job.match(/^ {4}if: \$\{\{(.*?)\}\}$/mu)[1]
    for (const result of ['success', 'failure', 'cancelled', 'skipped', '']) {
      for (const metadata_only of ['true', 'false', '', 'unknown']) {
        const context = {
          needs: { plan: { result, outputs: { metadata_only } } }
        }
        assert.equal(evaluate(condition, context), true)
        assert.equal(name, requiredName)
        const bridge = job
          .split('      - name: Preserve current code-check result')[1]
          .split(/\n {6}- name: /u)[0]
        assert.ok(
          bridge.includes(
            'PREVIOUS_CODE_RESULT: ${{ needs.plan.outputs.metadata_' +
              (id === 'phase11_release' ? 'portable' : id) +
              ' }}'
          )
        )
        assert.ok(
          bridge.includes(
            'test "$CI_PLAN_RESULT" = success && test "$PREVIOUS_CODE_RESULT" = success'
          )
        )
      }
    }

    const outputs = Object.fromEntries(
      [
        'code',
        'web',
        'api',
        'database',
        'browser',
        'security',
        'performance',
        'portable'
      ].map((flag) => [flag, 'false'])
    )
    const metadataContext = {
      needs: {
        plan: {
          result: 'success',
          outputs: { ...outputs, metadata_only: 'true' }
        }
      },
      steps: Object.fromEntries(
        [...job.matchAll(/^ {8}id: (\w+)/gmu)].map((match) => [
          match[1],
          { outcome: 'skipped' }
        ])
      )
    }
    const image = job.match(/^ {8}image: \$\{\{(.*?)\}\}$/mu)
    if (image) {
      assert.equal(
        evaluate(image[1], metadataContext),
        '',
        'No metadata service container'
      )
      const contradictory = {
        needs: {
          plan: {
            outputs: {
              ...outputs,
              database: 'true',
              browser: 'true',
              metadata_only: 'true'
            }
          }
        }
      }
      assert.equal(
        evaluate(image[1], contradictory),
        '',
        'Metadata exclusion also protects inconsistent scope flags'
      )
    }
    for (const step of job.split(/(?=^ {6}- name: )/mu).slice(1)) {
      const stepIf = step.match(/^ {8}if: \$\{\{(.*?)\}\}$/mu)
      assert.ok(stepIf, step)
      assert.equal(
        evaluate(stepIf[1], metadataContext),
        step.includes('name: Preserve current code-check result'),
        step.split('\n')[0]
      )
    }
  }
})

test('plan CLI emits metadata_only only for confirmed edits and keeps selection JSON', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'ci-metadata-plan-'))
  try {
    const headResult = spawnSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8'
    })
    assert.equal(headResult.status, 0, headResult.stderr)
    const sha = headResult.stdout.trim()
    for (const action of ['edited', 'synchronize']) {
      const eventPath = path.join(directory, 'event.json')
      const output = path.join(directory, 'output')
      writeFileSync(
        eventPath,
        JSON.stringify({
          action,
          changes: { body: { from: 'old body' } },
          pull_request: { base: { ref: 'dev', sha }, head: { sha } }
        })
      )
      writeFileSync(output, '')
      const result = spawnSync(
        process.execPath,
        [path.join(import.meta.dirname, 'check-selection.mjs'), 'plan'],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            GITHUB_EVENT_PATH: eventPath,
            GITHUB_OUTPUT: output,
            GITHUB_STEP_SUMMARY: '',
            GITHUB_EVENT_NAME: 'pull_request',
            GITHUB_REF: 'refs/pull/1/merge',
            GITHUB_SHA: sha
          }
        }
      )
      assert.equal(result.status, 0, result.stderr)
      const entries = Object.fromEntries(
        readFileSync(output, 'utf8')
          .trim()
          .split('\n')
          .map((line) => {
            const index = line.indexOf('=')
            return [line.slice(0, index), line.slice(index + 1)]
          })
      )
      assert.equal(entries.metadata_only, String(action === 'edited'))
      assert.equal(
        JSON.parse(entries.selection).mode,
        action === 'edited' ? 'metadata' : 'pull_request'
      )
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

const sourceOptions = {
  repository: 'milo37/nihongo',
  number: 48,
  headSha: 'b'.repeat(40),
  baseRef: 'dev',
  baseSha: 'a'.repeat(40),
  runId: '10'
}
const requiredNames = [
  'Quality and production build',
  'Phase 10 real/mock browser and regression acceptance',
  'Phase 11 portable release and production-mode smoke'
]
const codeFixture = (id = 9, attempt = 1, mode = 'code') => {
  const run = {
    id,
    run_attempt: attempt,
    head_sha: sourceOptions.headSha,
    repository: { full_name: sourceOptions.repository },
    head_repository: { full_name: sourceOptions.repository },
    event: 'pull_request',
    path: '.github/workflows/ci.yml',
    status: 'completed',
    conclusion: 'success',
    run_started_at: `2026-10-26T00:00:${String(id).padStart(2, '0')}Z`
  }
  const jobs = [
    {
      name: 'Select checks for event and changed dependencies',
      status: 'completed',
      conclusion: 'success',
      steps: [
        { name: 'Select affected checks', conclusion: 'success' },
        {
          name: `CI source ${mode} repo ${sourceOptions.repository} PR 48 head ${sourceOptions.headSha} base dev ${sourceOptions.baseSha}`,
          conclusion: 'success'
        }
      ]
    },
    ...requiredNames.map((name) => ({
      name,
      head_sha: sourceOptions.headSha,
      run_id: id,
      status: 'completed',
      conclusion: 'success'
    }))
  ]
  return { run, jobs }
}
const fixtureApi =
  (fixtures, calls = []) =>
  async (endpoint) => {
    calls.push(endpoint)
    if (endpoint.includes('/workflows/'))
      return { workflow_runs: fixtures.map((f) => f.run) }
    const match = endpoint.match(/runs\/(\d+)\/attempts\/(\d+)\/jobs/u)
    assert.ok(match)
    const f = fixtures.find(
      (f) =>
        f.run.id === Number(match[1]) && f.run.run_attempt === Number(match[2])
    )
    assert.ok(f, 'Job reads must pin the actual attempt')
    return { jobs: f.jobs }
  }
const noWait = async () => {}

test('metadata faithfully reuses exact latest code checks and excludes current/metadata runs', async () => {
  const code = codeFixture()
  const meta = codeFixture(11, 1, 'metadata')
  const current = codeFixture(10, 1, 'metadata')
  const calls = []
  const result = await readPreviousCodeResults(
    sourceOptions,
    fixtureApi([current, code, meta], calls),
    noWait
  )
  assert.equal(result.sourceRunId, 9)
  assert.deepEqual(Object.values(result.results), [
    'success',
    'success',
    'success'
  ])
  assert.ok(
    calls.filter((call) => call.includes('/workflows/')).length >= 2,
    'Recheck newest code before success'
  )
  assert.ok(!calls.some((call) => call.includes('/runs/10/')))
})

test('metadata waits for current code once and never falls back to an older pass', async () => {
  const latest = codeFixture(9)
  latest.run.status = 'in_progress'
  latest.jobs[1].status = 'in_progress'
  latest.jobs[1].conclusion = null
  let waits = 0
  const result = await readPreviousCodeResults(
    sourceOptions,
    fixtureApi([codeFixture(8), latest]),
    async () => {
      waits += 1
      latest.run.status = 'completed'
      latest.jobs[1].status = 'completed'
      latest.jobs[1].conclusion = 'failure'
    }
  )
  assert.equal(waits, 1)
  assert.equal(result.sourceRunId, 9)
  assert.equal(result.results.build, 'unavailable')
})

test('metadata rejects wrong source tuples, forks, failed plans, unknown markers and missing/duplicate jobs', async () => {
  const mutations = [
    (f) => {
      f.run.repository.full_name = 'other/repo'
    },
    (f) => {
      f.run.head_repository.full_name = 'other/fork'
    },
    (f) => {
      f.run.head_sha = 'c'.repeat(40)
    },
    (f) => {
      f.run.path = '.github/workflows/other.yml'
    },
    (f) => {
      f.jobs[0].steps[1].name = f.jobs[0].steps[1].name.replace(
        'PR 48',
        'PR 49'
      )
    },
    (f) => {
      f.jobs[0].steps[1].name = f.jobs[0].steps[1].name.replace(
        'base dev',
        'base main'
      )
    },
    (f) => {
      f.jobs[0].steps[1].name = f.jobs[0].steps[1].name.replace(
        sourceOptions.baseSha,
        'c'.repeat(40)
      )
    },
    (f) => {
      f.jobs[0].conclusion = 'failure'
    },
    (f) => {
      f.jobs[0].steps[0].conclusion = 'failure'
    },
    (f) => {
      f.jobs[0].steps[1].name = 'CI source ${{ unevaluated }}'
    },
    (f) => {
      f.jobs[0].steps.push({ ...f.jobs[0].steps[1] })
    },
    (f) => {
      f.jobs[0].steps.pop()
    },
    (f) => {
      f.jobs.pop()
    },
    (f) => {
      f.jobs.push({ ...f.jobs[1] })
    },
    (f) => {
      f.jobs[1].head_sha = 'c'.repeat(40)
    },
    (f) => {
      f.jobs[1].run_id = 8
    }
  ]
  for (const mutate of mutations) {
    const f = codeFixture()
    mutate(f)
    const result = await readPreviousCodeResults(
      sourceOptions,
      fixtureApi([f]),
      noWait
    )
    assert.ok(
      Object.values(result.results).every((value) => value === 'unavailable')
    )
  }
  for (const conclusion of [
    'failure',
    'cancelled',
    'timed_out',
    'stale',
    'action_required',
    'neutral',
    'skipped',
    null
  ]) {
    const f = codeFixture(9, 2)
    f.jobs[1].conclusion = conclusion
    const result = await readPreviousCodeResults(
      sourceOptions,
      fixtureApi([codeFixture(8), f]),
      noWait
    )
    assert.equal(result.results.build, 'unavailable', String(conclusion))
  }
})

test('metadata catches a newer code attempt immediately before reporting success', async () => {
  const old = codeFixture(9)
  const newer = codeFixture(9, 2)
  newer.run.run_started_at = '2026-10-26T00:00:12Z'
  newer.jobs[1].conclusion = 'failure'
  let lists = 0
  const api = async (endpoint) => {
    if (endpoint.includes('/workflows/')) {
      lists += 1
      return { workflow_runs: [lists === 1 ? old.run : newer.run] }
    }
    return fixtureApi([old, newer])(endpoint)
  }
  const result = await readPreviousCodeResults(sourceOptions, api, noWait)
  assert.equal(result.sourceAttempt, 2)
  assert.equal(result.results.build, 'unavailable')
})

test('missing checks, API errors and bounded pending time never become reusable success', async () => {
  for (const api of [
    async () => {
      throw new Error('API unavailable')
    },
    fixtureApi([])
  ]) {
    assert.ok(
      Object.values(
        (await readPreviousCodeResults(sourceOptions, api, noWait)).results
      ).every((value) => value === 'unavailable')
    )
  }
  const pending = codeFixture()
  pending.run.status = 'queued'
  pending.jobs = []
  let waits = 0
  const result = await readPreviousCodeResults(
    sourceOptions,
    fixtureApi([pending]),
    async () => {
      waits += 1
    }
  )
  assert.ok(waits > 0 && waits < 100)
  assert.match(result.reason, /bounded wait/u)
  assert.ok(
    Object.values(result.results).every((value) => value === 'unavailable')
  )
})

test('successful jobs cannot attest an incomplete or unsuccessful source workflow', async () => {
  for (const conclusion of [
    'failure',
    'cancelled',
    'timed_out',
    'neutral',
    'skipped',
    null
  ]) {
    const f = codeFixture()
    f.run.conclusion = conclusion
    const result = await readPreviousCodeResults(
      sourceOptions,
      fixtureApi([f]),
      noWait
    )
    assert.ok(
      Object.values(result.results).every((value) => value === 'unavailable')
    )
  }
  const f = codeFixture()
  f.run.status = 'in_progress'
  let waits = 0
  const result = await readPreviousCodeResults(
    sourceOptions,
    fixtureApi([f]),
    async () => {
      waits += 1
      f.run.status = 'completed'
      f.run.conclusion = 'cancelled'
    }
  )
  assert.equal(waits, 1)
  assert.ok(
    Object.values(result.results).every((value) => value === 'unavailable')
  )
})

test('an unorderable newer queued run cannot reuse an older pass in older-first API order', async () => {
  for (const runStartedAt of [null, '', 'invalid']) {
    for (const newerAttempt of [false, true]) {
      const older = codeFixture(8)
      const queued = codeFixture(newerAttempt ? 8 : 9, newerAttempt ? 2 : 1)
      queued.run.status = 'queued'
      queued.run.conclusion = null
      queued.run.run_started_at = runStartedAt
      queued.jobs = []
      let waits = 0
      const result = await readPreviousCodeResults(
        sourceOptions,
        fixtureApi([older, queued]),
        async () => {
          waits += 1
        }
      )
      assert.equal(waits, 89)
      assert.match(result.reason, /bounded wait/u)
      assert.ok(
        Object.values(result.results).every((value) => value === 'unavailable')
      )
    }
  }
})

test('unrelated fork PRs do not block the matching internal PR, while its own fork source fails closed', async () => {
  const unrelated = codeFixture(11)
  unrelated.run.head_repository.full_name = 'other/fork'
  unrelated.jobs[0].steps[1].name = unrelated.jobs[0].steps[1].name.replace(
    'PR 48 ',
    'PR 49 '
  )
  const code = codeFixture(9)
  const result = await readPreviousCodeResults(
    sourceOptions,
    fixtureApi([unrelated, code]),
    noWait
  )
  assert.equal(result.sourceRunId, 9)
  assert.ok(Object.values(result.results).every((value) => value === 'success'))
  const targetFork = codeFixture(11)
  targetFork.run.head_repository.full_name = 'other/fork'
  const rejected = await readPreviousCodeResults(
    sourceOptions,
    fixtureApi([targetFork, code]),
    noWait
  )
  assert.ok(
    Object.values(rejected.results).every((value) => value === 'unavailable')
  )
})

test('selected web/admin/shared work includes admin tests/build and complete browser types', () => {
  for (const file of [
    'apps/web/src/components/Button.tsx',
    'apps/admin/src/router.tsx',
    'packages/browser/src/provider/AuthErrorHandlerProvider.tsx'
  ]) {
    const selection = pr([file])
    assert.ok(selection.web, file)
    assert.ok(
      qualityCommands(selection, 'unit').some(
        (args) => args.join(' ') === '--filter @nihongo/admin run test'
      ),
      file
    )
    assert.ok(
      qualityCommands(selection, 'build').some(
        (args) => args.join(' ') === '--filter @nihongo/admin run build'
      ),
      file
    )
    assert.ok(
      qualityCommands(selection, 'typecheck').some(
        (args) => args.join(' ') === '--filter @nihongo/browser run typecheck'
      ),
      file
    )
  }
})

test('admin/browser quality child failures fail the selected required group', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'ci-admin-quality-'))
  try {
    const bin = path.join(directory, 'pnpm')
    const log = path.join(directory, 'calls')
    writeFileSync(
      bin,
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CI_TEST_CALLS"\n[ "$*" != "$CI_TEST_FAIL_ARGS" ] || exit 7\n',
      { mode: 0o700 }
    )
    for (const [group, failedCommand] of [
      ['unit', '--filter @nihongo/admin run test'],
      ['build', '--filter @nihongo/admin run build'],
      ['typecheck', '--filter @nihongo/browser run typecheck']
    ]) {
      writeFileSync(log, '')
      const result = spawnSync(
        process.execPath,
        [
          path.join(import.meta.dirname, 'check-selection.mjs'),
          'quality',
          group
        ],
        {
          env: {
            ...process.env,
            PATH: `${directory}:${process.env.PATH}`,
            CI_SELECTION: JSON.stringify(
              pr(['apps/web/src/components/Button.tsx'])
            ),
            CI_PLAN_RESULT: 'success',
            CI_TEST_CALLS: log,
            CI_TEST_FAIL_ARGS: failedCommand
          },
          encoding: 'utf8'
        }
      )
      assert.equal(result.status, 7, result.stderr)
      assert.equal(
        readFileSync(log, 'utf8').trim().split('\n').at(-1),
        failedCommand
      )
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
