import assert from 'node:assert/strict'
import test from 'node:test'

import { verifyCandidateSource } from './candidate-source.mjs'

const releaseId = 'a'.repeat(40)
const baseEnvironment = {
  GITHUB_EVENT_NAME: 'push',
  GITHUB_REF: 'refs/tags/v0.1.0',
  GITHUB_SHA: 'b'.repeat(40)
}
const createGit =
  ({ resolved = releaseId, status = '' } = {}) =>
  (_command, args) => {
    if (args[0] === 'status') return status
    if (args[0] === 'rev-parse') return `${resolved}\n`
    throw new Error('unexpected git call')
  }
const tagPushEvent = {
  after: 'c'.repeat(40),
  ref: baseEnvironment.GITHUB_REF
}

test('verifies normalized tag, event SHA and checkout identity', () => {
  const result = verifyCandidateSource({
    env: baseEnvironment,
    event: tagPushEvent,
    repositoryRoot: process.cwd(),
    git: createGit()
  })
  assert.deepEqual(result, {
    releaseId,
    ref: 'refs/tags/v0.1.0'
  })
})

test('allows manual candidates only on protected branches or version tags', () => {
  assert.doesNotThrow(() =>
    verifyCandidateSource({
      env: {
        ...baseEnvironment,
        GITHUB_EVENT_NAME: 'workflow_dispatch',
        GITHUB_REF: 'refs/heads/main'
      },
      event: {},
      repositoryRoot: process.cwd(),
      git: createGit()
    })
  )
  assert.throws(
    () =>
      verifyCandidateSource({
        env: {
          ...baseEnvironment,
          GITHUB_EVENT_NAME: 'workflow_dispatch',
          GITHUB_REF: 'refs/heads/feature'
        },
        event: {},
        repositoryRoot: process.cwd(),
        git: createGit()
      }),
    /CANDIDATE_SOURCE_EVENT_INVALID/u
  )
})

test('fails closed on ref mismatch and dirty source', () => {
  let calls = 0
  assert.throws(
    () =>
      verifyCandidateSource({
        env: baseEnvironment,
        event: tagPushEvent,
        repositoryRoot: process.cwd(),
        git: (_command, args) => {
          if (args[0] === 'status') return ''
          calls += 1
          return `${calls === 2 ? 'd'.repeat(40) : releaseId}\n`
        }
      }),
    /CANDIDATE_SOURCE_MISMATCH/u
  )
  assert.throws(
    () =>
      verifyCandidateSource({
        env: baseEnvironment,
        event: tagPushEvent,
        repositoryRoot: process.cwd(),
        git: createGit({ status: ' M package.json' })
      }),
    /CANDIDATE_SOURCE_DIRTY/u
  )
})

test('rejects ambiguous tag push identity before resolving revisions', () => {
  for (const event of [
    { ...tagPushEvent, after: 'HEAD' },
    { ...tagPushEvent, ref: 'refs/tags/v9.9.9' }
  ]) {
    assert.throws(
      () =>
        verifyCandidateSource({
          env: baseEnvironment,
          event,
          repositoryRoot: process.cwd(),
          git: createGit()
        }),
      /CANDIDATE_SOURCE_EVENT_INVALID/u
    )
  }
})
