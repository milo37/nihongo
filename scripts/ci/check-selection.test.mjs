import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

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

  assert.deepEqual(jobs(normal), ['build', 'e2e', 'phase11_release'])
  assert.equal(steps(normal).length, 28)
  assert.deepEqual(jobs(candidate), ['candidate'])
  assert.equal(steps(candidate).length, 10)
  for (const name of [
    'Quality and production build',
    'Phase 10 real/mock browser and regression acceptance',
    'Phase 11 portable release and production-mode smoke'
  ]) {
    assert.equal(normal.split(name).length - 1, 1)
  }
  assert.doesNotMatch(normal + candidate, /previous-results|upload-artifact/u)
  assert.doesNotMatch(normal + candidate, /run:\s+[^\n]*phase[0-9]/iu)
  assert.equal(
    normal.split('toJSON(github.event.changes) == toJSON(fromJSON').length - 1,
    7
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

const expectedBrowserCalls = (mode) => [
  {
    args: [
      '--filter',
      '@nihongo/api',
      'exec',
      'tsx',
      'src/e2e/runPhase7Browser.ts',
      mode
    ],
    phase8: '1'
  },
  {
    args: [
      '--filter',
      '@nihongo/api',
      'exec',
      'tsx',
      '../../scripts/runPhase9Browser.ts',
      mode
    ],
    phase8: null
  },
  {
    args: [
      '--filter',
      '@nihongo/api',
      'exec',
      'tsx',
      '../../scripts/runPhase10Browser.ts',
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
  for (const mode of ['real', 'mock']) {
    assert.equal(
      runs.filter((run) => run === `pnpm run test:browser:${mode}`).length,
      1,
      mode
    )
  }
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
    suite
  ])
  assert.equal(calls[0].environment[modeVariable], mode)
}

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
      isPhase8Acceptance
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
      ? [
          'apps/web/e2e/phase7-admin-cms-mock.spec.ts',
          'apps/web/e2e/phase8-dashboard-real-mock.spec.ts'
        ]
      : ['apps/web/e2e/phase8-dashboard-real-mock.spec.ts']
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
  const runnerPaths = calls.map(({ args }) =>
    path.resolve(repositoryRoot, 'apps/api', args[4])
  )
  assert.deepEqual(runnerPaths, [
    path.join(repositoryRoot, 'apps/api/src/e2e/runPhase7Browser.ts'),
    path.join(repositoryRoot, 'scripts/runPhase9Browser.ts'),
    path.join(repositoryRoot, 'scripts/runPhase10Browser.ts')
  ])

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
    'apps/web/e2e/phase9-accessibility.spec.ts',
    'PHASE9_BROWSER_MODE'
  )
  await assertPlaywrightSelection(
    sources.phase10,
    mode,
    'apps/web/e2e/phase10-journeys-real-mock.spec.ts',
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
    'runPhase9Browser.ts'
  )
  assert.equal(failure.status, 1)
  assert.deepEqual(failure.calls, expectedBrowserCalls('real'))
  assert.match(failure.stderr, /Browser group failed \(exit 17\)/u)
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
        'run: pnpm run test:browser:mock',
        'run: printf "pnpm run test:browser:mock"'
      )
    )
  )

  const real = scripts['test:browser:real']
  const phase9 =
    'pnpm --filter @nihongo/api exec tsx ../../scripts/runPhase9Browser.ts real'
  const phase10 =
    'pnpm --filter @nihongo/api exec tsx ../../scripts/runPhase10Browser.ts real'
  assert.throws(() =>
    assertBrowserScript(
      real.replace(`run ${phase9};`, `printf "%s" "${phase9}" >/dev/null;`),
      'real'
    )
  )
  assert.throws(() =>
    assertBrowserScript(
      real.replace(`run ${phase10};`, `# run ${phase10};\n`),
      'real'
    )
  )
  assert.throws(() =>
    assertBrowserScript(
      real.replace(
        `run ${phase9};`,
        `run ${phase9.replace('runPhase9Browser', 'deadPhase9Browser')}; printf "%s" "${phase9}" >/dev/null;`
      ),
      'real'
    )
  )

  const phase9Source = readFileSync(
    path.join(repositoryRoot, 'scripts/runPhase9Browser.ts'),
    'utf8'
  )
  await assert.rejects(() =>
    assertPlaywrightSelection(
      phase9Source.replace(
        "'apps/web/e2e/phase9-accessibility.spec.ts'",
        "'apps/web/e2e/dead.spec.ts' /* apps/web/e2e/phase9-accessibility.spec.ts */"
      ),
      'real',
      'apps/web/e2e/phase9-accessibility.spec.ts',
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
        '  const browserSpecs = selectPhase7BrowserSpecs(browserMode, isPhase8Acceptance)\n'
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
