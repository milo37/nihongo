import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  captureCheckoutEvidence,
  createCheckoutEvidence,
  runCheckoutEvidence
} from './checkout-evidence.mjs'

const head = 'a'.repeat(40)
const base = 'b'.repeat(40)
const merge = 'c'.repeat(40)
const tree = 'd'.repeat(40)
const environment = {
  GITHUB_REPOSITORY: 'fixture/project',
  GITHUB_JOB: 'build',
  GITHUB_RUN_ID: '1234',
  GITHUB_RUN_ATTEMPT: '2',
  GITHUB_EVENT_NAME: 'pull_request',
  GITHUB_REF: 'refs/pull/11/merge',
  GITHUB_SHA: merge,
  UNREQUESTED_VALUE: 'must never enter evidence'
}
const event = {
  number: 11,
  repository: { full_name: 'fixture/project' },
  pull_request: { head: { sha: head }, base: { sha: base } },
  unrequested: 'must never enter evidence'
}
const observed = {
  checkoutSha: merge,
  treeSha: tree,
  parents: [base, head],
  status: ''
}

test('PR evidence retains only its actual source/run allowlist', () => {
  const actual = createCheckoutEvidence({ environment, event, observed })
  assert.deepEqual(actual, {
    schemaVersion: 1,
    repository: 'fixture/project',
    producer: { job: 'build', runId: '1234', runAttempt: '2' },
    evaluation: {
      event: 'pull_request',
      ref: 'refs/pull/11/merge',
      sha: merge
    },
    source: {
      headSha: head,
      baseSha: base,
      checkoutSha: merge,
      treeSha: tree,
      parents: [base, head]
    }
  })
  assert.doesNotMatch(
    JSON.stringify(actual),
    /must never|unrequested|UNREQUESTED/u
  )
})

test('the observed PR44 stale-base tuple needs Git proof while retaining the exact merge and head', () => {
  const staleBase = '374954286f22cdaadbfb897ec1c21b0664e006d3'
  const currentBase = '3c0520e5b68ffbe8e11cd816195fcc8eb89ab565'
  const currentHead = 'e156a4c0878936722a7bda550c15efb3874c7d9b'
  const evaluatedMerge = '4d5acbaa949eba6ea68e652235c24c65f8481d6c'
  const frozenTree = '24e31246f9a51377e1ca48e94051717c5a546151'
  const fixture = {
    environment: {
      ...environment,
      GITHUB_REF: 'refs/pull/44/merge',
      GITHUB_SHA: evaluatedMerge
    },
    event: {
      ...event,
      number: 44,
      pull_request: { base: { sha: staleBase }, head: { sha: currentHead } }
    },
    observed: {
      ...observed,
      checkoutSha: evaluatedMerge,
      treeSha: frozenTree,
      parents: [currentBase, currentHead]
    }
  }
  assert.throws(() => createCheckoutEvidence(fixture))
  const actual = createCheckoutEvidence({
    ...fixture,
    isAncestor: (ancestor, descendant) => {
      assert.equal(ancestor, staleBase)
      assert.equal(descendant, currentBase)
      return true
    }
  })
  assert.deepEqual(actual.source, {
    headSha: currentHead,
    baseSha: staleBase,
    checkoutSha: evaluatedMerge,
    treeSha: frozenTree,
    parents: [currentBase, currentHead]
  })
})

test('push evidence accepts an initial zero before without mistaking it for the head', () => {
  const actual = createCheckoutEvidence({
    environment: {
      ...environment,
      GITHUB_EVENT_NAME: 'push',
      GITHUB_REF: 'refs/heads/work',
      GITHUB_SHA: head
    },
    event: {
      repository: event.repository,
      before: '0'.repeat(40),
      after: head,
      ref: 'refs/heads/work'
    },
    observed: { ...observed, checkoutSha: head, parents: [] }
  })
  assert.equal(actual.source.baseSha, '0'.repeat(40))
  assert.equal(actual.source.checkoutSha, head)
})

test('mismatched or incomplete evaluated/source/run tuples fail closed', () => {
  for (const patch of [
    { observed: { ...observed, checkoutSha: head } },
    { observed: { ...observed, parents: [head, base] } },
    { observed: { ...observed, parents: [base] } },
    { observed: { ...observed, treeSha: 'not-a-tree' } },
    { observed: { ...observed, status: ' M source.js' } },
    { observed: { ...observed, status: '?? injected.js' } },
    { environment: { ...environment, GITHUB_SHA: '0'.repeat(40) } },
    { environment: { ...environment, GITHUB_RUN_ATTEMPT: '0' } },
    { environment: { ...environment, GITHUB_RUN_ID: '' } },
    { environment: { ...environment, GITHUB_JOB: '../outside' } },
    { environment: { ...environment, GITHUB_EVENT_NAME: 'workflow_dispatch' } },
    { environment: { ...environment, GITHUB_REF: 'refs/pull/12/merge' } },
    { event: { ...event, number: undefined } },
    { event: { ...event, repository: { full_name: 'other/project' } } }
  ]) {
    assert.throws(() =>
      createCheckoutEvidence({ environment, event, observed, ...patch })
    )
  }
  assert.throws(() =>
    createCheckoutEvidence({
      environment: {
        ...environment,
        GITHUB_EVENT_NAME: 'push',
        GITHUB_REF: 'refs/heads/work',
        GITHUB_SHA: head
      },
      event: {
        repository: event.repository,
        before: base,
        after: merge,
        ref: 'refs/heads/work'
      },
      observed: { ...observed, checkoutSha: head }
    })
  )
})

test('a real temporary Git merge checkout is captured and written privately once', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'nihongo-checkout-evidence-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const repository = join(directory, 'repository')
  const gitEnvironment = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1'
  }
  const git = (...args) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.test',
        ...args
      ],
      {
        cwd: directory,
        encoding: 'utf8',
        env: gitEnvironment,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    ).trim()
  git('init', '--initial-branch=fixture', repository)
  const source = join(repository, 'source.txt')
  writeFileSync(source, 'base\n')
  git('-C', repository, 'add', 'source.txt')
  git('-C', repository, 'commit', '-m', 'base fixture')
  const actualBase = git('-C', repository, 'rev-parse', 'HEAD')
  writeFileSync(source, 'head\n')
  git('-C', repository, 'add', 'source.txt')
  git('-C', repository, 'commit', '-m', 'head fixture')
  const actualHead = git('-C', repository, 'rev-parse', 'HEAD')
  const actualTree = git('-C', repository, 'rev-parse', 'HEAD^{tree}')
  const actualMerge = git(
    '-C',
    repository,
    'commit-tree',
    actualTree,
    '-p',
    actualBase,
    '-p',
    actualHead,
    '-m',
    'merge fixture'
  )
  git('-C', repository, 'checkout', '--detach', actualMerge)
  const eventPath = join(directory, 'event.json')
  writeFileSync(
    eventPath,
    JSON.stringify({
      ...event,
      pull_request: { head: { sha: actualHead }, base: { sha: actualBase } }
    })
  )
  const fixtureEnvironment = {
    ...environment,
    GITHUB_SHA: actualMerge,
    GITHUB_EVENT_PATH: eventPath,
    RUNNER_TEMP: directory
  }
  const output = join(directory, 'checkout-source-1234-2-build.json')
  const actual = runCheckoutEvidence(
    ['--output', output],
    fixtureEnvironment,
    repository
  )
  assert.equal(actual.source.treeSha, actualTree)
  assert.equal(actual.source.checkoutSha, actualMerge)
  assert.deepEqual(actual.source.parents, [actualBase, actualHead])
  assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), actual)
  assert.equal(statSync(output).mode & 0o777, 0o600)
  const baseTree = git('-C', repository, 'rev-parse', actualBase + '^{tree}')
  const advancedBase = git(
    '-C',
    repository,
    'commit-tree',
    baseTree,
    '-p',
    actualBase,
    '-m',
    'forward base fixture'
  )
  const unrelatedBase = git(
    '-C',
    repository,
    'commit-tree',
    baseTree,
    '-m',
    'unrelated fixture'
  )
  const advancedMerge = git(
    '-C',
    repository,
    'commit-tree',
    actualTree,
    '-p',
    advancedBase,
    '-p',
    actualHead,
    '-m',
    'forward merge fixture'
  )
  const captureAt = (eventBase, checkout, expectedHead = actualHead) => {
    git('-C', repository, 'checkout', '--detach', checkout)
    writeFileSync(
      eventPath,
      JSON.stringify({
        ...event,
        pull_request: { head: { sha: expectedHead }, base: { sha: eventBase } }
      })
    )
    return captureCheckoutEvidence(
      { ...fixtureEnvironment, GITHUB_SHA: checkout },
      repository
    )
  }
  const forward = captureAt(actualBase, advancedMerge)
  assert.equal(forward.source.baseSha, actualBase)
  assert.deepEqual(forward.source.parents, [advancedBase, actualHead])
  for (const [eventBase, checkout, expectedHead] of [
    [advancedBase, actualMerge, actualHead],
    [unrelatedBase, advancedMerge, actualHead],
    [actualBase, advancedMerge, advancedBase],
    [actualBase, actualHead, actualHead],
    ['f'.repeat(40), advancedMerge, actualHead]
  ]) {
    assert.throws(() => captureAt(eventBase, checkout, expectedHead))
  }
  captureAt(actualBase, actualMerge)
  assert.throws(
    () =>
      runCheckoutEvidence(['--output', output], fixtureEnvironment, repository),
    { code: 'EEXIST' }
  )
  const otherOutput = join(directory, 'other.json')
  assert.throws(() =>
    runCheckoutEvidence(
      ['--output', otherOutput],
      fixtureEnvironment,
      repository
    )
  )
  writeFileSync(source, 'dirty\n')
  assert.throws(() => captureCheckoutEvidence(fixtureEnvironment, repository))
  writeFileSync(source, 'head\n')
  rmSync(output)
  symlinkSync(eventPath, output)
  assert.throws(
    () =>
      runCheckoutEvidence(['--output', output], fixtureEnvironment, repository),
    { code: 'EEXIST' }
  )
  assert.equal(JSON.parse(readFileSync(eventPath, 'utf8')).number, 11)
})

test('each required producer captures its evaluated checkout before work', () => {
  const workflow = readFileSync(
    new URL('../../.github/workflows/ci.yml', import.meta.url),
    'utf8'
  )
  const jobs = workflow.split('jobs:\n')[1]
  assert.deepEqual(
    [...jobs.matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_-]*):$/gmu)].map(
      (match) => match[1]
    ),
    ['plan', 'build', 'e2e', 'phase11_release']
  )
  for (const job of jobs.split(/^ {2}[A-Za-z_][A-Za-z0-9_-]*:$/mu).slice(1)) {
    assert.match(job, /ref: \$\{\{ github.sha \}\}/u)
    assert.match(job, /fetch-depth: 0/u)
    assert.match(job, /persist-credentials: false/u)
    if (job.includes('name: Select affected checks')) continue
    const record = job.indexOf('name: Record actual checkout evidence')
    assert.ok(record > job.indexOf('name: Setup Node.js'))
    assert.ok(record < job.indexOf('name: Install dependencies'))
    assert.match(job, /node scripts\/ci\/checkout-evidence\.mjs --output/u)
    assert.match(job, /actions\/upload-artifact@v4/u)
    assert.match(job, /if-no-files-found: error/u)
  }
  assert.match(workflow, /name: Quality and production build/u)
  assert.match(
    workflow,
    /run: node scripts\/ci\/check-selection\.mjs quality unit\n/u
  )
  assert.match(
    workflow,
    /run: node scripts\/ci\/check-selection\.mjs quality build\n/u
  )
  assert.doesNotMatch(
    workflow,
    /continue-on-error:|admission_binding:|required_gate:/u
  )
})

test('manual and tag candidates bind the evaluated commit without inventing a comparison base', () => {
  for (const ref of ['refs/heads/dev', 'refs/tags/v0.2.0']) {
    const actual = createCheckoutEvidence({
      environment: {
        ...environment,
        GITHUB_EVENT_NAME: 'workflow_dispatch',
        GITHUB_REF: ref,
        GITHUB_SHA: head
      },
      event: { repository: event.repository },
      observed: { ...observed, checkoutSha: head, parents: [base] }
    })
    assert.equal(actual.source.headSha, head)
    assert.equal(actual.source.baseSha, '0'.repeat(40))
    assert.equal(actual.evaluation.ref, ref)
    assert.throws(() =>
      createCheckoutEvidence({
        environment: {
          ...environment,
          GITHUB_EVENT_NAME: 'workflow_dispatch',
          GITHUB_REF: ref,
          GITHUB_SHA: head
        },
        event: { repository: event.repository },
        observed
      })
    )
  }
  const actual = createCheckoutEvidence({
    environment: {
      ...environment,
      GITHUB_EVENT_NAME: 'push',
      GITHUB_REF: 'refs/tags/v0.2.0',
      GITHUB_SHA: head
    },
    event: {
      repository: event.repository,
      ref: 'refs/tags/v0.2.0',
      after: head,
      before: '0'.repeat(40)
    },
    observed: { ...observed, checkoutSha: head, parents: [base] }
  })
  assert.equal(actual.source.headSha, head)
})
