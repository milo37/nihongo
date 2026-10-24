import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  lstatSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const shaPattern = /^[0-9a-f]{40}$/u
const zeroSha = '0'.repeat(40)
const positiveInteger = /^[1-9][0-9]*$/u
const requireSha = (value) => {
  assert.ok(shaPattern.test(value) && value !== zeroSha, 'Invalid source SHA.')
  return value
}

export const createCheckoutEvidence = ({ environment, event, observed }) => {
  assert.match(environment.GITHUB_REPOSITORY ?? '', /^[\w.-]+\/[\w.-]+$/u)
  assert.equal(event.repository?.full_name, environment.GITHUB_REPOSITORY)
  assert.match(environment.GITHUB_JOB ?? '', /^[A-Za-z_][A-Za-z0-9_-]*$/u)
  assert.match(environment.GITHUB_RUN_ID ?? '', positiveInteger)
  assert.match(environment.GITHUB_RUN_ATTEMPT ?? '', positiveInteger)
  const evaluatedSha = requireSha(environment.GITHUB_SHA)
  const checkoutSha = requireSha(observed.checkoutSha)
  const treeSha = requireSha(observed.treeSha)
  assert.equal(
    checkoutSha,
    evaluatedSha,
    'Checkout differs from evaluated SHA.'
  )
  assert.equal(observed.status, '', 'Checkout must have no source changes.')
  assert.ok(Array.isArray(observed.parents), 'Missing commit parents.')
  observed.parents.forEach(requireSha)

  let headSha
  let baseSha
  if (environment.GITHUB_EVENT_NAME === 'pull_request') {
    assert.ok(Number.isSafeInteger(event.number) && event.number > 0)
    assert.equal(
      environment.GITHUB_REF,
      'refs/pull/' + event.number + '/merge',
      'Expected the evaluated PR merge ref.'
    )
    headSha = requireSha(event.pull_request?.head?.sha)
    baseSha = requireSha(event.pull_request?.base?.sha)
    assert.deepEqual(
      observed.parents,
      [baseSha, headSha],
      'PR checkout parents differ from the event base/head.'
    )
  } else {
    assert.equal(environment.GITHUB_EVENT_NAME, 'push', 'Unsupported CI event.')
    assert.match(environment.GITHUB_REF ?? '', /^refs\/heads\/\S+$/u)
    assert.equal(event.ref, environment.GITHUB_REF)
    headSha = requireSha(event.after)
    assert.equal(headSha, evaluatedSha, 'Push head differs from evaluated SHA.')
    assert.ok(shaPattern.test(event.before), 'Missing push base SHA.')
    baseSha = event.before
  }

  return {
    schemaVersion: 1,
    repository: environment.GITHUB_REPOSITORY,
    producer: {
      job: environment.GITHUB_JOB,
      runId: environment.GITHUB_RUN_ID,
      runAttempt: environment.GITHUB_RUN_ATTEMPT
    },
    evaluation: {
      event: environment.GITHUB_EVENT_NAME,
      ref: environment.GITHUB_REF,
      sha: evaluatedSha
    },
    source: {
      headSha,
      baseSha,
      checkoutSha,
      treeSha,
      parents: observed.parents
    }
  }
}

export const captureCheckoutEvidence = (environment, workspace) => {
  const git = (...args) =>
    execFileSync('git', ['-C', workspace, ...args], {
      encoding: 'utf8',
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
    }).trim()
  return createCheckoutEvidence({
    environment,
    event: JSON.parse(readFileSync(environment.GITHUB_EVENT_PATH, 'utf8')),
    observed: {
      checkoutSha: git('rev-parse', 'HEAD'),
      treeSha: git('rev-parse', 'HEAD^{tree}'),
      parents: git('show', '-s', '--format=%P', 'HEAD')
        .split(' ')
        .filter(Boolean),
      status: git('status', '--porcelain=v1', '--untracked-files=all')
    }
  })
}

export const runCheckoutEvidence = (argumentsList, environment, workspace) => {
  assert.equal(argumentsList.length, 2, 'Expected --output and one path.')
  assert.equal(argumentsList[0], '--output', 'Expected --output and one path.')
  const evidence = captureCheckoutEvidence(environment, workspace)
  assert.ok(lstatSync(environment.RUNNER_TEMP).isDirectory())
  const output = resolve(argumentsList[1])
  const expected = resolve(
    environment.RUNNER_TEMP,
    'checkout-source-' +
      evidence.producer.runId +
      '-' +
      evidence.producer.runAttempt +
      '-' +
      evidence.producer.job +
      '.json'
  )
  assert.equal(
    output,
    expected,
    'Evidence must use its unique runner temp path.'
  )
  assert.equal(
    realpathSync(dirname(output)),
    realpathSync(environment.RUNNER_TEMP)
  )
  writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600
  })
  chmodSync(output, 0o600)
  return evidence
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    runCheckoutEvidence(process.argv.slice(2), process.env, process.cwd())
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message.split('\n')[0]
        : 'Checkout evidence failed.'
    process.stderr.write(message + '\n')
    process.exitCode = 1
  }
}
