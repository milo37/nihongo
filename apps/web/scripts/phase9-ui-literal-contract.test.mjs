import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { classifyCandidate } from './phase9-ui-literal-check.mts'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const policy = JSON.parse(
  readFileSync(
    resolve(scriptDirectory, 'phase9-ui-literal-policy.json'),
    'utf8'
  )
)

test('rejects new Korean literals outside catalog, fixture, and deferred UI scopes', () => {
  for (const path of [
    'src/api/example.ts',
    'src/libs/example.ts',
    'src/store/example.ts',
    'src/util/example.ts'
  ]) {
    assert.deepEqual(
      classifyCandidate(
        { path, literal: '검토되지 않은 사용자 문구입니다.' },
        policy
      ),
      { status: 'unreviewed' }
    )
  }
})

test('requires an exact path and normalized literal for allowlist matches', () => {
  const reviewed = policy.allowlist[0]
  assert.ok(reviewed)
  assert.equal(
    classifyCandidate(
      { path: reviewed.path, literal: `변경된 ${reviewed.literal}` },
      policy
    ).status,
    'unreviewed'
  )
  assert.equal(
    classifyCandidate(
      { path: `${reviewed.path}.copy`, literal: reviewed.literal },
      policy
    ).status,
    'unreviewed'
  )
})
