import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const wrapper = fileURLToPath(
  new URL('./run-retained-validator.mjs', import.meta.url)
)
const packageScripts = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
).scripts
const fixtureRoot = mkdtempSync(
  join(tmpdir(), 'content-wrapper-no-dependencies-')
)
const fixtureWrapper = join(
  fixtureRoot,
  'scripts/content/run-retained-validator.mjs'
)
mkdirSync(dirname(fixtureWrapper), { recursive: true })
copyFileSync(wrapper, fixtureWrapper)
after(() => rmSync(fixtureRoot, { recursive: true, force: true }))

const run = (entry, args) => {
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd: tmpdir(),
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: 256 * 1024
  })
  assert.equal(result.error, undefined)
  assert.equal(result.signal, null)
  return result
}
const failure = (result, code) => {
  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.deepEqual(JSON.parse(result.stderr), {
    schemaVersion: 1,
    mode: 'PASSIVE_ANALYSIS',
    status: 'ERROR',
    code
  })
  assert.equal(result.stderr.split('\n').length, 2)
}

for (const command of ['check', 'validate', 'coverage', 'duplicates']) {
  test(`root content:${command} analyzes the current inventory without granting trust`, () => {
    assert.equal(
      packageScripts[`content:${command}`],
      `node scripts/content/run-retained-validator.mjs ${command}`
    )
    const result = run(wrapper, [command])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stderr, '')
    assert.ok(Buffer.byteLength(result.stdout) <= 128 * 1024)
    assert.equal(result.stdout.split('\n').length, 2)
    const output = JSON.parse(result.stdout)
    assert.equal(output.schemaVersion, 1)
    assert.equal(output.command, `content:${command}`)
    assert.equal(output.mode, 'PASSIVE_ANALYSIS')
    assert.equal(output.status, 'ANALYZED')
    assert.equal(output.scope, 'CURRENT_APPROVED_SOURCES')
    assert.equal(output.itemCount, 373)
    assert.deepEqual(output.inventory, {
      foundationQuestionCount: 65,
      approvedQuestionCount: 308,
      foundationTaxonomyTagCount: 107,
      approvedRequiredTagNameCount: 388,
      approvedRequiredTagTupleCount: 437
    })
    assert.equal(output.trustVerified, false)
    assert.equal(output.fullTaxonomyApplicabilityVerified, false)
    if (command === 'check' || command === 'validate')
      assert.equal(output.structurallyValid, true)
    if (command === 'coverage') {
      assert.equal(output.coverage.scope, 'CURRENT_APPROVED_SOURCES')
      assert.equal(output.coverage.itemCount, 373)
    }
    if (command === 'duplicates') {
      assert.ok(output.duplicateAnalysis.reportedCandidateCount <= 100)
      assert.equal(
        output.duplicateAnalysis.candidates.length,
        output.duplicateAnalysis.reportedCandidateCount
      )
    }
  })
}

for (const command of [
  'author-prepare',
  'legacy-policy-finalize',
  'legacy-policy-prepare',
  'policy-finalize',
  'policy-prepare',
  'policy-activation-prepare',
  'policy-activation-finalize',
  'review-prepare',
  'review-check'
]) {
  test(`excluded ${command} is refused even without installed dependencies`, () => {
    assert.equal(
      packageScripts[`content:${command}`],
      `node scripts/content/run-retained-validator.mjs ${command}`
    )
    failure(run(fixtureWrapper, [command]), 'CONTENT_COMMAND_UNKNOWN')
  })
}

test('missing and unknown commands fail before loading the analysis runtime', () => {
  failure(run(fixtureWrapper, []), 'CONTENT_COMMAND_UNKNOWN')
  failure(
    run(fixtureWrapper, ['unknown-private-input']),
    'CONTENT_COMMAND_UNKNOWN'
  )
})

test('runtime loading failure exposes only the owned fixed error', () => {
  failure(run(fixtureWrapper, ['check']), 'CONTENT_ANALYSIS_FAILED')
})

test('argument ordering and input failures retain the backend boundary', () => {
  failure(
    run(wrapper, ['check', '--bundle', 'private-input']),
    'CONTENT_ARGUMENT_INVALID'
  )
  failure(run(wrapper, ['validate', '--bundle']), 'CONTENT_ARGUMENT_INVALID')
  failure(
    run(wrapper, [
      'validate',
      '--bundle',
      '/private/tmp/private-input-missing.json'
    ]),
    'CONTENT_INPUT_INVALID'
  )
})
