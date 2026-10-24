import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  assertPhase9SnapshotContract,
  assertPhase9RateLimitContract,
  phase9DatabaseTables,
  phase9ExpectedTableDeltas,
  phase9ExpectedRateLimitCategories
} from './phase9-database-contract.mjs'

const fingerprint = (suffix) => suffix.padStart(64, '0')

const createSnapshots = () => {
  const beforeTables = {}
  const afterTables = {}
  for (const [index, tableName] of phase9DatabaseTables.entries()) {
    const baselineFingerprint = fingerprint((index + 1).toString(16))
    const delta = phase9ExpectedTableDeltas[tableName]
    beforeTables[tableName] = {
      count: 100,
      fingerprint: baselineFingerprint
    }
    afterTables[tableName] = {
      count: 100 + delta,
      fingerprint:
        delta === 0
          ? baselineFingerprint
          : fingerprint((index + 100).toString(16))
    }
  }
  return {
    after: {
      rateLimitRows: [],
      tableNames: [...phase9DatabaseTables],
      tables: afterTables
    },
    before: {
      rateLimitRows: [],
      tableNames: [...phase9DatabaseTables],
      tables: beforeTables
    }
  }
}

test('accepts the exhaustive Phase 9 browser database delta', () => {
  const { after, before } = createSnapshots()
  assert.doesNotThrow(() => assertPhase9SnapshotContract(before, after))
})

test('rejects an unaccounted StudySessionQuestion write', () => {
  const { after, before } = createSnapshots()
  after.tables.StudySessionQuestion.count += 1
  assert.throws(
    () => assertPhase9SnapshotContract(before, after),
    /StudySessionQuestion count delta/u
  )
})

test('rejects a zero-delta content mutation by fingerprint', () => {
  const { after, before } = createSnapshots()
  after.tables.Question.fingerprint = fingerprint('ffff')
  assert.throws(
    () => assertPhase9SnapshotContract(before, after),
    /Question zero-delta fingerprint/u
  )
})

test('rejects an unknown database table', () => {
  const { after, before } = createSnapshots()
  after.tableNames.push('UnexpectedPhase9Write')
  assert.throws(
    () => assertPhase9SnapshotContract(before, after),
    /final table inventory/u
  )
})

test('rejects an omitted allowlisted table snapshot', () => {
  const { after, before } = createSnapshots()
  delete after.tables.Bookmark
  assert.throws(
    () => assertPhase9SnapshotContract(before, after),
    /final snapshot inventory/u
  )
})

test('accounts for every current schema table explicitly', () => {
  const schema = readFileSync(
    new URL('../apps/api/prisma/schema.prisma', import.meta.url),
    'utf8'
  )
  const tables = [...schema.matchAll(/^model\s+(\w+)\s*\{/gmu)].map(
    (match) => match[1]
  )
  assert.deepEqual(
    [...phase9DatabaseTables].sort(),
    [...tables, '_prisma_migrations'].sort()
  )
})

test('rejects an unconsumed SSO login transaction', () => {
  const { after, before } = createSnapshots()
  after.tables.SsoLoginTransaction.count += 1
  assert.throws(
    () => assertPhase9SnapshotContract(before, after),
    /SsoLoginTransaction count delta/u
  )
})

test('rejects a same-count SSO proof mutation by fingerprint', () => {
  const { after, before } = createSnapshots()
  after.tables.SsoAccountFreshProof.fingerprint = fingerprint('ffff')
  assert.throws(
    () => assertPhase9SnapshotContract(before, after),
    /SsoAccountFreshProof zero-delta fingerprint/u
  )
})

const createRateLimitSnapshots = () => ({
  before: { rateLimitRows: [] },
  after: {
    rateLimitRows: Object.entries(phase9ExpectedRateLimitCategories).flatMap(
      ([category, count]) =>
        Array.from({ length: count }, (_, index) => ({
          key: `${category}:${fingerprint((index + 1).toString(16))}`,
          count: 1
        }))
    )
  }
})

test('accepts the exact Google start and callback rate-limit profile', () => {
  const { after, before } = createRateLimitSnapshots()
  assert.doesNotThrow(() => assertPhase9RateLimitContract(before, after))
})

test('rejects a retired email sign-in rate-limit key', () => {
  const { after, before } = createRateLimitSnapshots()
  const row = after.rateLimitRows.find(({ key }) =>
    key.startsWith('application:auth:/api/auth/sign-in/social:')
  )
  assert.ok(row)
  row.key = row.key.replace('/social:', '/email:')
  assert.throws(
    () => assertPhase9RateLimitContract(before, after),
    /unexpected rate-limit category application:auth:\/api\/auth\/sign-in\/email/u
  )
})

test('rejects a missing Google callback rate-limit key', () => {
  const { after, before } = createRateLimitSnapshots()
  const index = after.rateLimitRows.findIndex(({ key }) =>
    key.startsWith('application:auth:/api/auth/callback/google:')
  )
  assert.notEqual(index, -1)
  after.rateLimitRows.splice(index, 1)
  assert.throws(
    () => assertPhase9RateLimitContract(before, after),
    /new rate-limit key count/u
  )
})

test('rejects a repeated Google callback consumption', () => {
  const { after, before } = createRateLimitSnapshots()
  const row = after.rateLimitRows.find(({ key }) =>
    key.startsWith('application:auth:/api/auth/callback/google:')
  )
  assert.ok(row)
  row.count = 2
  assert.throws(
    () => assertPhase9RateLimitContract(before, after),
    /callback\/google request count/u
  )
})
