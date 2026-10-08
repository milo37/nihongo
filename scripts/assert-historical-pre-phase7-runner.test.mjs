import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  assertHistoricalPrePhase7Runner,
  HISTORICAL_RUNNER_ERROR,
  PHASE7_MIGRATION_DIRECTORIES
} from './assert-historical-pre-phase7-runner.mjs'

const withMigrationDirectory = (callback) => {
  const directory = mkdtempSync(
    path.join(tmpdir(), 'nihongo-historical-runner-')
  )
  try {
    callback(directory)
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
}

test('allows a source ref containing only pre-Phase 7 migrations', () => {
  withMigrationDirectory((directory) => {
    mkdirSync(path.join(directory, '20260825000000_phase6_example'))
    assert.doesNotThrow(() => assertHistoricalPrePhase7Runner(directory))
  })
})

for (const migrationDirectory of PHASE7_MIGRATION_DIRECTORIES) {
  test(`rejects the historical runners when ${migrationDirectory} exists`, () => {
    withMigrationDirectory((directory) => {
      mkdirSync(path.join(directory, migrationDirectory))
      assert.throws(
        () => assertHistoricalPrePhase7Runner(directory),
        (error) =>
          error instanceof Error &&
          error.message.startsWith(HISTORICAL_RUNNER_ERROR)
      )
    })
  })
}

test('routes current-source seed verification to the Phase 7 DB gate and guards historical commands', () => {
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..'
  )
  const packageJson = JSON.parse(
    readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8')
  )

  assert.equal(
    packageJson.scripts['content:foundation-check:seed'],
    'pnpm run test:phase7:db'
  )
  for (const scriptName of [
    'test:e2e',
    'test:integration',
    'test:integration:slice3',
    'test:integration:slice5'
  ]) {
    assert.match(
      packageJson.scripts[scriptName],
      /^node scripts\/assert-historical-pre-phase7-runner\.mjs && /
    )
  }
})

test('guards every historical executable before environment or database setup', () => {
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..'
  )
  for (const runnerPath of [
    'apps/api/src/e2e/runSlice3Integration.ts',
    'apps/api/src/e2e/runSlice5Integration.ts',
    'apps/api/src/e2e/runSlice2E2e.ts'
  ]) {
    const source = readFileSync(path.join(repositoryRoot, runnerPath), 'utf8')
    const guardIndex = source.indexOf('assertHistoricalPrePhase7Runner(')
    const environmentIndex = source.indexOf('dotenv.config(')
    assert.notEqual(guardIndex, -1, `${runnerPath} must call the source guard`)
    assert.notEqual(
      environmentIndex,
      -1,
      `${runnerPath} must retain an environment setup boundary`
    )
    assert.ok(
      guardIndex < environmentIndex,
      `${runnerPath} must reject before reading runtime DB configuration`
    )
  }
})
