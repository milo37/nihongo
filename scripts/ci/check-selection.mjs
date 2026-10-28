import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const selectionFlags = [
  'code',
  'web',
  'admin',
  'api',
  'shared',
  'content',
  'database',
  'browser',
  'security',
  'audit',
  'performance',
  'portable',
  'candidate'
]

const shaPattern = /^[a-f0-9]{40}$/u
const zeroSha = '0'.repeat(40)
const emptySelection = (mode, reason) => ({
  mode,
  reason,
  files: [],
  ...Object.fromEntries(selectionFlags.map((flag) => [flag, false]))
})
const fullSelection = (mode, reason, candidate = false) => ({
  mode,
  reason,
  files: [],
  ...Object.fromEntries(selectionFlags.map((flag) => [flag, true])),
  candidate
})

const fail = (code) => {
  throw new Error(code)
}

const assertChangedPath = (file) => {
  if (
    typeof file !== 'string' ||
    file.length === 0 ||
    file.startsWith('/') ||
    file.split('/').includes('..')
  ) {
    fail('CI_CLASSIFICATION_INVALID_PATH')
  }
}

const isMetadataOnlyEdit = (event) => {
  if (event?.action !== 'edited') return false
  const changes = event.changes
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    return false
  }
  const fields = Object.keys(changes)
  const canonicalShape = fields.join(',')
  return (
    ['title', 'body', 'title,body'].includes(canonicalShape) &&
    fields.every(
      (field) =>
        ['title', 'body'].includes(field) &&
        typeof changes[field]?.from === 'string' &&
        Object.keys(changes[field]).length === 1
    )
  )
}

const markCore = (selection) => {
  selection.code = true
  selection.web = true
  selection.admin = true
  selection.api = true
  selection.shared = true
  selection.database = true
  selection.browser = true
  selection.security = true
}

export const classifyChangedFiles = (changedFiles) => {
  if (!Array.isArray(changedFiles)) fail('CI_CLASSIFICATION_FILES_UNAVAILABLE')
  const selection = emptySelection('pull_request', 'changed dependencies')
  selection.files = [...changedFiles]

  for (const file of changedFiles) {
    assertChangedPath(file)

    if (/\.(?:md|txt)$/iu.test(file) && !file.startsWith('.github/')) continue
    if (
      /^(?:LICENSE|\.editorconfig|\.gitignore|\.gitattributes)$/u.test(file) ||
      file.startsWith('.github/ISSUE_TEMPLATE/')
    ) {
      continue
    }

    if (file === 'pnpm-lock.yaml' || /(?:^|\/)package\.json$/u.test(file)) {
      markCore(selection)
      selection.audit = true
      selection.portable = true
      continue
    }
    if (
      /^(?:Dockerfile|\.dockerignore|compose\.ya?ml|operations\/|infra\/)/u.test(
        file
      ) ||
      file.startsWith('scripts/operations/')
    ) {
      markCore(selection)
      selection.portable = true
      continue
    }
    if (
      /^(?:\.github\/workflows\/|scripts\/ci\/|pnpm-workspace\.yaml$|tsconfig|eslint|prettier|\.prettier|\.node|\.nvm|\.npm|\.env|vite|vitest|playwright)/u.test(
        file
      )
    ) {
      markCore(selection)
      selection.portable = true
      continue
    }
    if (file.startsWith('scripts/security/')) {
      selection.code = true
      selection.security = true
      if (/dependency-audit|disposition/iu.test(file)) selection.audit = true
      continue
    }
    if (
      file.startsWith('scripts/') ||
      /^(?:apps\/web\/scripts\/|apps\/api\/src\/e2e\/)/u.test(file)
    ) {
      markCore(selection)
      if (/performance|bundle/iu.test(file)) selection.performance = true
      continue
    }
    if (file.startsWith('packages/')) {
      selection.code = true
      selection.shared = true
      selection.web = true
      selection.admin = true
      selection.api = true
      selection.database = true
      selection.browser = true
      selection.security = true
      continue
    }
    if (file.startsWith('apps/web/')) {
      selection.code = true
      selection.web = true
      selection.browser = true
      selection.security = true
    } else if (file.startsWith('apps/admin/')) {
      selection.code = true
      selection.admin = true
      selection.browser = true
      selection.security = true
    } else if (file.startsWith('apps/api/')) {
      selection.code = true
      selection.api = true
      selection.database = true
      selection.security = true
    } else if (file.startsWith('content/')) {
      selection.code = true
      selection.content = true
      selection.web = true
      selection.api = true
      selection.database = true
      selection.security = true
    } else {
      fail('CI_CLASSIFICATION_UNCLASSIFIED_PATH')
    }

    if (
      /(?:^|\/)(?:auth|storage|study|practice|submission)(?:\/|\.|-)/iu.test(
        file
      )
    ) {
      selection.web = true
      selection.api = true
      selection.database = true
      selection.browser = true
    }
    if (
      /^apps\/api\/(?:prisma\/|src\/(?:db|e2e)\/)/u.test(file) ||
      /(?:database|migration|performance)/iu.test(file)
    ) {
      selection.performance = true
    }
  }

  return selection
}

export const selectChecks = ({ eventName, ref, event, changedFiles }) => {
  if (eventName === 'pull_request' && isMetadataOnlyEdit(event)) {
    return emptySelection('metadata', 'title/body-only pull request edit')
  }
  if (
    eventName === 'workflow_dispatch' ||
    (eventName === 'push' && ref?.startsWith('refs/tags/'))
  ) {
    return fullSelection('candidate', 'release candidate', true)
  }
  if (eventName === 'pull_request') {
    const pullRequest = event?.pull_request
    if (
      !['dev', 'main'].includes(pullRequest?.base?.ref) ||
      !shaPattern.test(pullRequest?.base?.sha ?? '') ||
      !shaPattern.test(pullRequest?.head?.sha ?? '')
    ) {
      fail('CI_CLASSIFICATION_EVENT_INVALID')
    }
    if (pullRequest.base.ref === 'main') {
      return fullSelection('candidate', 'main integration candidate', true)
    }
    return classifyChangedFiles(changedFiles)
  }
  if (
    eventName === 'push' &&
    ['refs/heads/dev', 'refs/heads/main'].includes(ref)
  ) {
    const selection = classifyChangedFiles(changedFiles)
    selection.mode = 'integration'
    selection.reason = 'protected branch core regression'
    markCore(selection)
    return selection
  }
  fail('CI_CLASSIFICATION_EVENT_UNSUPPORTED')
}

const readChangedFiles = ({ eventName, event, env, git }) => {
  if (eventName === 'pull_request') {
    const baseSha = event?.pull_request?.base?.sha
    const headSha = event?.pull_request?.head?.sha
    if (
      !shaPattern.test(baseSha ?? '') ||
      !shaPattern.test(headSha ?? '') ||
      !shaPattern.test(env.GITHUB_SHA ?? '')
    ) {
      fail('CI_CLASSIFICATION_EVENT_INVALID')
    }
    git('git', ['merge-base', '--is-ancestor', headSha, env.GITHUB_SHA], {
      stdio: 'pipe'
    })
    git('git', ['diff', '--check', `${baseSha}...${headSha}`], {
      stdio: 'pipe'
    })
    return git(
      'git',
      ['diff', '--no-renames', '--name-only', '-z', `${baseSha}...${headSha}`],
      { encoding: 'utf8', stdio: 'pipe' }
    )
  }
  if (
    eventName === 'push' &&
    ['refs/heads/dev', 'refs/heads/main'].includes(env.GITHUB_REF)
  ) {
    const before = event?.before
    if (
      !shaPattern.test(before ?? '') ||
      before === zeroSha ||
      !shaPattern.test(env.GITHUB_SHA ?? '')
    ) {
      fail('CI_CLASSIFICATION_COMPARISON_UNAVAILABLE')
    }
    git('git', ['diff', '--check', before, env.GITHUB_SHA], {
      stdio: 'pipe'
    })
    return git(
      'git',
      ['diff', '--no-renames', '--name-only', '-z', before, env.GITHUB_SHA],
      { encoding: 'utf8', stdio: 'pipe' }
    )
  }
  return ''
}

export const readSelection = (env = process.env, git = execFileSync) => {
  let event
  let changedFiles
  try {
    event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))
    changedFiles = readChangedFiles({
      eventName: env.GITHUB_EVENT_NAME,
      event,
      env,
      git
    })
      .split('\0')
      .filter(Boolean)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('CI_')) throw error
    fail('CI_CLASSIFICATION_COMPARISON_FAILED')
  }
  return selectChecks({
    eventName: env.GITHUB_EVENT_NAME,
    ref: env.GITHUB_REF,
    event,
    changedFiles
  })
}

export const qualityCommands = (selection, group) => {
  const commands = []
  const add = (...args) => commands.push(args)
  const all = selection.mode !== 'pull_request'

  if (group === 'static') {
    add(
      'exec',
      'eslint',
      ...(all
        ? ['.']
        : [
            selection.web && 'apps/web',
            selection.admin && 'apps/admin',
            selection.api && 'apps/api',
            selection.shared && 'packages',
            (selection.content || selection.portable) && 'scripts'
          ].filter(Boolean)),
      '--max-warnings',
      '0'
    )
    add('run', 'check:architecture')
    add('run', 'test:security')
  } else if (group === 'typecheck') {
    add('--filter', '@nihongo/contracts', 'run', 'build')
    add('--filter', '@nihongo/domain', 'run', 'build')
    if (selection.shared || selection.web || selection.admin) {
      add('--filter', '@nihongo/browser', 'run', 'typecheck')
    }
    if (selection.web) add('--filter', '@nihongo/web', 'run', 'typecheck')
    if (selection.admin) add('--filter', '@nihongo/admin', 'run', 'typecheck')
    if (selection.api) add('--filter', '@nihongo/api', 'run', 'typecheck')
  } else if (group === 'unit') {
    if (all) {
      add('run', 'test:static')
    } else {
      add('exec', 'node', '--test', 'scripts/ci/*.test.mjs')
      if (
        selection.shared ||
        selection.web ||
        selection.admin ||
        selection.api
      ) {
        add('exec', 'node', '--test', 'scripts/architecture/*.test.mjs')
      }
      if (selection.content) {
        add('exec', 'node', '--test', 'scripts/content/*.test.mjs')
      }
      if (selection.portable) {
        add('exec', 'node', '--test', 'scripts/operations/*.test.mjs')
      }
      if (selection.security || selection.browser) {
        add('exec', 'node', '--test', 'scripts/security/*.test.mjs')
      }
      if (selection.database) {
        add(
          'exec',
          'node',
          '--test',
          'scripts/phase7-local-provisioning.test.mjs',
          'scripts/phase9-database-contract.test.mjs'
        )
      }
      if (selection.web || selection.admin) {
        add(
          'exec',
          'node',
          '--test',
          'apps/web/scripts/phase10-production-bundle-contract.test.mjs'
        )
      }
    }
    if (selection.shared || all) {
      add('--filter', '@nihongo/contracts', 'run', 'test')
      add('--filter', '@nihongo/domain', 'run', 'test')
    }
    if (selection.api || all) add('--filter', '@nihongo/api', 'run', 'test')
    if (selection.web || all) add('--filter', '@nihongo/web', 'run', 'test')
    if (selection.web || selection.api || selection.shared || all) {
      add('--filter', '@nihongo/web', 'run', 'test:request-ledger')
    }
    if (selection.admin || all) add('--filter', '@nihongo/admin', 'run', 'test')
  } else if (group === 'audit') {
    add('run', 'test:dependency-audit:production')
    add('run', 'test:dependency-audit:development')
  } else if (group === 'build') {
    add('--filter', '@nihongo/contracts', 'run', 'build')
    add('--filter', '@nihongo/domain', 'run', 'build')
    if (selection.api) add('--filter', '@nihongo/api', 'run', 'build')
    if (selection.web || selection.admin) {
      add('--filter', '@nihongo/web', 'run', 'build')
      add('--filter', '@nihongo/admin', 'run', 'build')
    }
  } else if (group === 'bundle') {
    add('--filter', '@nihongo/web', 'run', 'test:bundle')
  } else if (group === 'integration') {
    add('run', 'test:api-regression')
  } else if (group === 'performance') {
    add('run', 'test:database-performance')
  } else {
    fail('CI_QUALITY_GROUP_INVALID')
  }
  return commands
}

const run = (args) => {
  const result = spawnSync('pnpm', args, { stdio: 'inherit', env: process.env })
  if (result.error) throw result.error
  if (result.signal) process.exit(result.signal === 'SIGINT' ? 130 : 143)
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const runProductionMockGuard = () => {
  const result = spawnSync(
    'pnpm',
    ['--filter', '@nihongo/web', 'run', 'build'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'production',
        VITE_API_MODE: 'mock'
      }
    }
  )
  if (result.error) throw result.error
  if (result.signal) process.exit(result.signal === 'SIGINT' ? 130 : 143)
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  if (
    result.status === 0 ||
    !output.includes('VITE_API_MODE=mock is forbidden in production.')
  ) {
    fail('CI_PRODUCTION_MOCK_GUARD_FAILED')
  }
}

const writeSelection = (selection) => {
  assert.ok(process.env.GITHUB_OUTPUT, 'CI_GITHUB_OUTPUT_MISSING')
  const serialized = JSON.stringify(selection)
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `metadata_only=${selection.mode === 'metadata'}\n${selectionFlags
      .map((flag) => `${flag}=${selection[flag]}`)
      .join('\n')}\nselection=${serialized}\n`
  )
  if (process.env.GITHUB_ENV) {
    appendFileSync(process.env.GITHUB_ENV, `CI_SELECTION=${serialized}\n`)
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `CI: ${selection.mode} / ${selection.reason}\n`
    )
  }
}

const runCli = () => {
  const [command, argument] = process.argv.slice(2)
  if (command === 'plan') {
    writeSelection(readSelection())
    return
  }
  const selection = JSON.parse(process.env.CI_SELECTION ?? 'null')
  assert.ok(
    selection &&
      selectionFlags.every((flag) => typeof selection[flag] === 'boolean'),
    'CI_SELECTION_INVALID'
  )
  if (command === 'format') {
    if (selection.mode !== 'pull_request') run(['run', 'format:check'])
    else {
      const files = selection.files.filter(
        (file) =>
          existsSync(file) &&
          /\.(?:[cm]?[jt]sx?|json|ya?ml|md|css|html)$/iu.test(file)
      )
      if (files.length) run(['exec', 'prettier', '--check', '--', ...files])
      else process.stdout.write('No changed formatter-supported files.\n')
    }
    return
  }
  if (command === 'quality') {
    if (argument === 'build' && (selection.web || selection.admin)) {
      runProductionMockGuard()
    }
    for (const args of qualityCommands(selection, argument)) run(args)
    return
  }
  fail('CI_SELECTION_COMMAND_INVALID')
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    runCli()
  } catch (error) {
    const code =
      error instanceof Error && /^CI_[A-Z0-9_]+$/u.test(error.message)
        ? error.message
        : 'CI_CLASSIFICATION_FAILED'
    process.stderr.write(`${JSON.stringify({ event: 'ci.failed', code })}\n`)
    process.exitCode = 1
  }
}
