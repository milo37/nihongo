import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const flags = [
  'code',
  'web',
  'api',
  'shared',
  'content',
  'operations',
  'database',
  'browser',
  'security',
  'performance',
  'portable'
]
const full = (mode, reason) => ({
  mode,
  reason,
  files: [],
  ...Object.fromEntries(flags.map((key) => [key, true]))
})
const shaPattern = /^[a-f0-9]{40}$/u

export const selectChecks = ({ eventName, ref, event, changedFiles }) => {
  if (
    eventName === 'workflow_dispatch' ||
    eventName === 'release' ||
    (eventName === 'push' && ref?.startsWith('refs/tags/'))
  )
    return full('candidate', 'release candidate')
  if (
    eventName === 'push' &&
    ['refs/heads/dev', 'refs/heads/main'].includes(ref)
  )
    return full('integration', 'protected branch integration')
  if (eventName !== 'pull_request')
    return full('conservative', 'unrecognized event/ref')
  const pr = event?.pull_request
  if (pr?.base?.ref === 'main')
    return full('candidate', 'main integration candidate')
  if (
    pr?.base?.ref !== 'dev' ||
    !shaPattern.test(pr?.base?.sha ?? '') ||
    !shaPattern.test(pr?.head?.sha ?? '') ||
    !Array.isArray(changedFiles)
  )
    return full('conservative', 'comparison unavailable')
  const result = {
    mode: 'pull_request',
    reason: 'changed and dependent areas',
    files: changedFiles,
    ...Object.fromEntries(flags.map((key) => [key, false]))
  }
  for (const file of changedFiles) {
    if (
      typeof file !== 'string' ||
      !file ||
      file.startsWith('/') ||
      file.split('/').includes('..')
    )
      return full('conservative', 'invalid changed path')
    if (/\.(?:md|txt)$/iu.test(file) && !file.startsWith('.github/workflows/'))
      continue
    if (
      /^(?:\.github\/|scripts\/|package\.json$|pnpm-|tsconfig|eslint|prettier|\.prettier|\.node|\.nvm|\.npm|\.env|vite|vitest|playwright)/u.test(
        file
      )
    )
      return full('conservative', 'CI or common configuration')
    if (
      /^(?:Dockerfile|compose\.|\.dockerignore$|operations\/|infra\/)/u.test(
        file
      )
    )
      return full('conservative', 'runtime/container operations impact')
    if (
      /(?:^|\/)(?:package\.json|tsconfig[^/]*\.json|vite\.config\.[cm]?[jt]s|vitest[^/]*config\.[cm]?[jt]s)$/u.test(
        file
      ) ||
      /^(?:packages\/|apps\/web\/(?:scripts\/|src\/(?:libs|provider)\/)|apps\/api\/(?:prisma\/|src\/(?:auth|db|e2e|config)\/))/u.test(
        file
      )
    )
      return full(
        'conservative',
        'shared, configuration or authentication/database foundation'
      )
    if (file.startsWith('apps/web/')) result.web = true
    else if (file.startsWith('apps/api/')) result.api = true
    else if (file.startsWith('packages/')) result.shared = true
    else if (file.startsWith('content/')) result.content = true
    else return full('conservative', 'unclassified impact')
  }
  if (result.shared || result.content) result.web = result.api = true
  result.code = result.web || result.api
  // Both transports exercise distinct auth/storage and MSW boundaries; keep all six labels.
  result.browser = result.code
  result.database =
    result.api ||
    result.files.some(
      (file) =>
        !/\.(?:md|txt)$/iu.test(file) &&
        /^apps\/web\/src\/(?:api|stores|app\/(?:auth|practice|admin)|mocks)\//u.test(
          file
        )
    )
  result.security = result.code
  return result
}

export const readSelection = (env = process.env, git = execFileSync) => {
  let event
  let files
  try {
    event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))
    if (env.GITHUB_EVENT_NAME === 'pull_request') {
      const { base, head } = event.pull_request
      assert.ok(
        shaPattern.test(base.sha) &&
          shaPattern.test(head.sha) &&
          shaPattern.test(env.GITHUB_SHA)
      )
      git('git', ['merge-base', '--is-ancestor', head.sha, env.GITHUB_SHA], {
        stdio: 'pipe'
      })
      files = git(
        'git',
        [
          'diff',
          '--no-renames',
          '--name-only',
          '-z',
          `${base.sha}...${head.sha}`
        ],
        { encoding: 'utf8', stdio: 'pipe' }
      )
        .split('\0')
        .filter(Boolean)
    }
  } catch {
    return full('conservative', 'event or Git comparison unavailable')
  }
  return selectChecks({
    eventName: env.GITHUB_EVENT_NAME,
    ref: env.GITHUB_REF,
    event,
    changedFiles: files
  })
}

export const qualityCommands = (selection, group) => {
  const { web, api, shared, content, mode } = selection
  const all = mode !== 'pull_request' || selection.operations
  const commands = []
  const add = (...args) => commands.push(args)
  if (group === 'prepare') {
    add('run', 'build:contracts')
    add('run', 'build:domain')
  } else if (group === 'lint') {
    add(
      'exec',
      'eslint',
      ...(all
        ? ['.']
        : [web && 'apps/web', api && 'apps/api', shared && 'packages'].filter(
            Boolean
          )),
      '--max-warnings',
      '0'
    )
  } else if (group === 'typecheck') {
    // App builds cover their own types; the shared browser workspace needs its complete check.
    if (web) add('--filter', '@nihongo/browser', 'run', 'typecheck')
    if (api) {
      add('run', 'db:generate')
      add('--filter', '@nihongo/api', 'exec', 'tsc', '--noEmit')
    }
  } else if (group === 'unit') {
    add('run', 'test:phase7:static')
    add('run', 'test:architecture')
    if (content || all) add('run', 'test:content-runtime')
    if (shared || all) {
      add('run', 'test:contracts')
      add('run', 'test:domain')
    }
    if (api)
      add(
        '--filter',
        '@nihongo/api',
        'exec',
        'vitest',
        'run',
        '--exclude',
        '**/*.integration.test.ts'
      )
    if (web) {
      add('run', 'test:web')
      add('--filter', '@nihongo/admin', 'run', 'test')
    }
  } else if (group === 'build') {
    if (api)
      add(
        '--filter',
        '@nihongo/api',
        'exec',
        'tsc',
        '-p',
        'tsconfig.build.json'
      )
    if (web) {
      add('--filter', '@nihongo/web', 'run', 'build')
      add('--filter', '@nihongo/admin', 'run', 'build')
    }
  } else throw new Error('CI_QUALITY_GROUP_INVALID')
  return commands
}

const requiredSteps = {
  build: {
    always: ['format', 'selection_contracts'],
    code: [
      'prepare',
      'lint',
      'architecture',
      'admin_boundary',
      'typecheck',
      'static_contracts',
      'static_phase10',
      'static_phase11',
      'unit',
      'build'
    ],
    web: ['production_mock', 'worker_exclusion'],
    database: ['integration'],
    content: ['foundation'],
    security: ['phase10_security_evidence'],
    performance: ['phase10_performance_evidence']
  },
  e2e: {
    browser: [
      'phase10_playwright_initialize',
      'phase10_browser_real',
      'phase10_browser_mock',
      'phase10_playwright_evidence'
    ]
  },
  phase11_release: { portable: ['phase11_release'] }
}

export const assertSelectedResults = ({
  job,
  planResult,
  selection,
  steps
}) => {
  assert.equal(planResult, 'success', 'CI selection job did not succeed')
  assert.ok(requiredSteps[job], 'unknown required check')
  assert.ok(
    selection && flags.every((key) => typeof selection[key] === 'boolean'),
    'invalid CI selection'
  )
  assert.ok(steps && typeof steps === 'object', 'step outcomes missing')
  for (const step of Object.values(steps))
    assert.ok(
      !['failure', 'cancelled'].includes(step.outcome),
      'upstream step failed or was cancelled'
    )
  for (const [flag, ids] of Object.entries(requiredSteps[job])) {
    if (flag === 'always' || selection[flag])
      for (const id of ids)
        assert.equal(
          steps[id]?.outcome,
          'success',
          `selected step ${id} did not succeed`
        )
  }
  return Object.entries(requiredSteps[job])
    .filter(([flag]) => flag === 'always' || selection[flag])
    .flatMap(([, ids]) => ids)
}

const run = (args) => {
  const result = spawnSync('pnpm', args, { stdio: 'inherit', env: process.env })
  if (result.error) throw result.error
  if (result.signal) process.exit(result.signal === 'SIGINT' ? 130 : 143)
  if (result.status !== 0) process.exit(result.status ?? 1)
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [command, argument] = process.argv.slice(2)
  if (command === 'plan') {
    const selection = readSelection()
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `${flags.map((key) => `${key}=${selection[key]}`).join('\n')}\nselection=${JSON.stringify(selection)}\n`
    )
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `CI: ${selection.mode} / ${selection.reason}\n\n${flags.map((key) => `- ${key}: ${selection[key]}`).join('\n')}\n`
      )
  } else {
    const selection = JSON.parse(process.env.CI_SELECTION ?? 'null')
    assert.equal(
      process.env.CI_PLAN_RESULT,
      'success',
      'CI selection did not succeed'
    )
    if (command === 'verify') {
      const selected = assertSelectedResults({
        job: argument,
        planResult: process.env.CI_PLAN_RESULT,
        selection,
        steps: JSON.parse(process.env.CI_STEPS ?? 'null')
      })
      const message = `${argument}: ${selected.length ? selected.join(', ') : 'No runtime checks selected for this change'} (${selection.mode})`
      process.stdout.write(`${message}\n`)
      if (process.env.GITHUB_STEP_SUMMARY)
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`)
    } else if (command === 'format') {
      if (selection.mode !== 'pull_request') run(['run', 'format:check'])
      else {
        const files = selection.files.filter(
          (file) =>
            existsSync(file) &&
            /\.(?:[cm]?[jt]sx?|json|ya?ml|md|css|html|txt)$/iu.test(file) &&
            !file.endsWith('.txt')
        )
        if (files.length) run(['exec', 'prettier', '--check', '--', ...files])
        else process.stdout.write('No changed formatter-supported files.\n')
      }
    } else if (command === 'quality')
      for (const args of qualityCommands(selection, argument)) run(args)
    else throw new Error('CI_SELECTION_COMMAND_INVALID')
  }
}
