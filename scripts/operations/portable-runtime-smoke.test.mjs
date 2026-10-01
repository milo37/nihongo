import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  createRuntimeEnvironment,
  selectPrePhase7MigrationNames,
  verifyPortableRuntimeSmokeEvidence
} from './portable-runtime-smoke.mjs'

const releaseId = '1234567890abcdef1234567890abcdef12345678'

test('portable runtime environment is production-shaped without migration credentials', () => {
  const environment = createRuntimeEnvironment({
    databaseHost: 'database',
    databaseName: 'nihongo_smoke_test',
    databasePassword: 'test-password',
    databaseUser: 'runtime_user',
    releaseId
  })

  assert.equal(environment.NODE_ENV, 'production')
  assert.equal(environment.ADMIN_CMS_MODE, 'disabled')
  assert.equal(environment.PRACTICE_CONTRACT_RUNTIME, 'v1-v2')
  assert.equal(environment.RELEASE_ID, releaseId)
  assert.match(
    environment.DATABASE_URL,
    /sslmode=require&uselibpqcompat=true$/u
  )
  assert.equal('PHASE7_MIGRATION_DATABASE_URL' in environment, false)
  assert.equal('PRODUCTION_DATABASE_URL' in environment, false)
  assert.notEqual(
    environment.BETTER_AUTH_SECRET,
    environment.GUEST_COOKIE_SECRET
  )
})

test('portable runtime smoke selects exactly the pre-Phase-7 boundary', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nihongo-p11-migrations-'))
  try {
    for (let index = 0; index < 27; index += 1) {
      mkdirSync(
        join(directory, `202607${String(index).padStart(6, '0')}_migration`)
      )
    }
    mkdirSync(join(directory, '20260827100000_phase7_admin_cms_enums'))

    const selected = selectPrePhase7MigrationNames(directory)
    assert.equal(selected.length, 27)
    assert.equal(
      selected.includes('20260827100000_phase7_admin_cms_enums'),
      false
    )
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
})

test('portable runtime smoke evidence is closed and bound to TEST', () => {
  const evidence = {
    schemaVersion: 1,
    evidenceClassification: 'TEST',
    profile: 'isolated-production-mode',
    releaseId,
    imageId: `sha256:${'a'.repeat(64)}`,
    migrationCount: 27,
    databaseAccess: {
      migrationLedger: 'read-only',
      migrationAndRuntimeIdentitiesSeparated: true,
      runtimeElevatedAttributes: false
    },
    runtimeSecurity: {
      capabilities: 'none',
      filesystem: 'read-only',
      noNewPrivileges: true,
      temporaryDirectory: 'tmpfs'
    },
    smoke: {
      schemaVersion: 1,
      environment: 'TEST',
      releaseId,
      targetFingerprintSha256: 'b'.repeat(64),
      checks: [
        { durationMs: 1, path: '/health/live', status: 200 },
        { durationMs: 1, path: '/health/ready', status: 200 },
        { durationMs: 1, path: '/', status: 200 },
        { durationMs: 1, path: '/login', status: 200 },
        { durationMs: 1, path: '/assets/app-ABC.js', status: 200 },
        { durationMs: 1, path: '/mockServiceWorker.js', status: 404 }
      ]
    },
    shutdown: { exitCode: 0, signal: 'SIGTERM' }
  }

  assert.equal(verifyPortableRuntimeSmokeEvidence(evidence), evidence)
  assert.throws(
    () =>
      verifyPortableRuntimeSmokeEvidence({
        ...evidence,
        evidenceClassification: 'PRODUCTION'
      }),
    /identity is invalid/u
  )
  assert.throws(
    () => verifyPortableRuntimeSmokeEvidence({ ...evidence, provider: 'x' }),
    /invalid key set/u
  )
})
