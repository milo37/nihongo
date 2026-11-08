import assert from 'node:assert/strict'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  assertAccessibilitySnapshotContract,
  assertAccessibilityRateLimitContract,
  readAccessibilityRateLimitDiagnostic,
  accessibilityDatabaseTables,
  accessibilityExpectedTableDeltas,
  accessibilityExpectedRateLimitCategories
} from './accessibility-database-contract.mjs'

const fingerprint = (suffix) => suffix.padStart(64, '0')

const createSnapshots = () => {
  const beforeTables = {}
  const afterTables = {}
  for (const [index, tableName] of accessibilityDatabaseTables.entries()) {
    const baselineFingerprint = fingerprint((index + 1).toString(16))
    const delta = accessibilityExpectedTableDeltas[tableName]
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
      tableNames: [...accessibilityDatabaseTables],
      tables: afterTables
    },
    before: {
      rateLimitRows: [],
      tableNames: [...accessibilityDatabaseTables],
      tables: beforeTables
    }
  }
}

test('accepts the exhaustive accessibility browser database delta', () => {
  const { after, before } = createSnapshots()
  assert.doesNotThrow(() => assertAccessibilitySnapshotContract(before, after))
})

test('rejects an unaccounted StudySessionQuestion write', () => {
  const { after, before } = createSnapshots()
  after.tables.StudySessionQuestion.count += 1
  assert.throws(
    () => assertAccessibilitySnapshotContract(before, after),
    /StudySessionQuestion count delta/u
  )
})

test('rejects a zero-delta content mutation by fingerprint', () => {
  const { after, before } = createSnapshots()
  after.tables.Question.fingerprint = fingerprint('ffff')
  assert.throws(
    () => assertAccessibilitySnapshotContract(before, after),
    /Question zero-delta fingerprint/u
  )
})

test('rejects an unknown database table', () => {
  const { after, before } = createSnapshots()
  after.tableNames.push('UnexpectedAccessibilityWrite')
  assert.throws(
    () => assertAccessibilitySnapshotContract(before, after),
    /final table inventory/u
  )
})

test('rejects an omitted allowlisted table snapshot', () => {
  const { after, before } = createSnapshots()
  delete after.tables.Bookmark
  assert.throws(
    () => assertAccessibilitySnapshotContract(before, after),
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
    [...accessibilityDatabaseTables].sort(),
    [...tables, '_prisma_migrations'].sort()
  )
})

test('rejects an unconsumed SSO login transaction', () => {
  const { after, before } = createSnapshots()
  after.tables.SsoLoginTransaction.count += 1
  assert.throws(
    () => assertAccessibilitySnapshotContract(before, after),
    /SsoLoginTransaction count delta/u
  )
})

test('rejects a same-count SSO proof mutation by fingerprint', () => {
  const { after, before } = createSnapshots()
  after.tables.SsoAccountFreshProof.fingerprint = fingerprint('ffff')
  assert.throws(
    () => assertAccessibilitySnapshotContract(before, after),
    /SsoAccountFreshProof zero-delta fingerprint/u
  )
})

const keySecret = randomBytes(32).toString('base64url')
const fixture = {
  learner: { userId: randomUUID() },
  author: { userId: randomUUID() }
}
const principalKey = (operation, userId) =>
  `application:${operation}:${createHmac('sha256', keySecret)
    .update(JSON.stringify([operation, 'USER', userId]))
    .digest('hex')}`

const createRateLimitSnapshots = () => ({
  before: { rateLimitRows: [] },
  after: {
    rateLimitRows: Object.entries(
      accessibilityExpectedRateLimitCategories
    ).flatMap(([category, count]) =>
      Array.from({ length: count }, (_, index) => ({
        key:
          category === 'application:study-draft-save'
            ? principalKey('study-draft-save', fixture.learner.userId)
            : category === 'application:study-submit'
              ? principalKey(
                  'study-submit',
                  [fixture.learner, fixture.author][index].userId
                )
              : `${category}:${fingerprint((index + 1).toString(16))}`,
        count: 1
      }))
    )
  }
})

test('accepts the exact Google start and callback rate-limit profile', () => {
  const { after, before } = createRateLimitSnapshots()
  assert.doesNotThrow(() =>
    assertAccessibilityRateLimitContract(before, after, fixture, keySecret)
  )
})

test('rejects a retired email sign-in rate-limit key', () => {
  const { after, before } = createRateLimitSnapshots()
  const row = after.rateLimitRows.find(({ key }) =>
    key.startsWith('application:auth:/api/auth/sign-in/social:')
  )
  assert.ok(row)
  row.key = row.key.replace('/social:', '/email:')
  assert.throws(
    () =>
      assertAccessibilityRateLimitContract(before, after, fixture, keySecret),
    /unexpected rate-limit category/u
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
    () =>
      assertAccessibilityRateLimitContract(before, after, fixture, keySecret),
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
    () =>
      assertAccessibilityRateLimitContract(before, after, fixture, keySecret),
    /callback\/google request count/u
  )
})

test('current two-actor rate-limit model is exact and rejects cardinality drift', () => {
  assert.equal(Object.keys(accessibilityExpectedRateLimitCategories).length, 24)
  assert.equal(
    accessibilityExpectedRateLimitCategories['application:study-read'],
    2
  )
  assert.equal(
    accessibilityExpectedRateLimitCategories[
      'application:dashboard-insights-read'
    ],
    1
  )
  assert.equal(
    accessibilityExpectedRateLimitCategories[
      'application:wrong-note-memo-read'
    ],
    1
  )
  assert.equal(
    Object.values(accessibilityExpectedRateLimitCategories).reduce(
      (sum, count) => sum + count,
      0
    ),
    28
  )
  assert.equal(accessibilityExpectedTableDeltas.RateLimit, 28)
  for (const category of [
    'application:study-read',
    'application:dashboard-insights-read'
  ]) {
    const expected = accessibilityExpectedRateLimitCategories[category]
    for (const count of [expected - 1, expected + 1]) {
      const { before, after } = createRateLimitSnapshots()
      after.rateLimitRows = after.rateLimitRows.filter(
        ({ key }) => !key.startsWith(category + ':')
      )
      after.rateLimitRows.push(
        ...Array.from({ length: count }, (_, index) => ({
          key: category + ':' + fingerprint((index + 1).toString(16)),
          count: 1
        }))
      )
      assert.throws(
        () =>
          assertAccessibilityRateLimitContract(
            before,
            after,
            fixture,
            keySecret
          ),
        /new rate-limit key count/u
      )
    }
  }
  const { before, after } = createRateLimitSnapshots()
  after.rateLimitRows[0] = {
    key: 'application:wrong-note-memo-read:' + fingerprint('f'),
    count: 1
  }
  assert.throws(
    () =>
      assertAccessibilityRateLimitContract(before, after, fixture, keySecret),
    /rate-limit categories/u
  )
})

test('rate-limit failure diagnostics expose allowed category counts without row identities', () => {
  const sentinel =
    'postgresql://private:password@203.0.113.9/secret?token=private-token'
  const { before, after } = createRateLimitSnapshots()
  before.rateLimitRows.push({
    key: 'application:study-read:' + fingerprint('a'),
    count: 42
  })
  after.rateLimitRows.push(
    ...before.rateLimitRows,
    { key: 'application:' + sentinel + ':' + fingerprint('b'), count: 43 },
    { key: sentinel, count: 44 }
  )
  const diagnostic = readAccessibilityRateLimitDiagnostic(before, after)
  assert.equal(diagnostic.expectedTotal, 28)
  assert.equal(diagnostic.before.total, 1)
  assert.equal(diagnostic.after.total, 31)
  assert.equal(diagnostic.newKeys.total, 30)
  assert.equal(diagnostic.newKeys.categories['application:study-read'], 2)
  assert.equal(diagnostic.newKeys.unknown, 1)
  assert.equal(diagnostic.newKeys.invalidShape, 1)
  assert.equal(JSON.stringify(diagnostic).includes(sentinel), false)
  assert.equal(JSON.stringify(diagnostic).includes(fingerprint('a')), false)
  assert.throws(
    () =>
      assertAccessibilityRateLimitContract(before, after, fixture, keySecret),
    (error) => {
      assert.match(
        error.message,
        /new rate-limit key count: expected 28, received 30/u
      )
      assert.ok(error.message.includes('rate-limit-diagnostic='))
      assert.equal(error.message.includes(sentinel), false)
      return true
    }
  )
  for (const badKey of [
    sentinel,
    'application:' + sentinel + ':' + fingerprint('b')
  ]) {
    const sample = createRateLimitSnapshots()
    sample.after.rateLimitRows[0] = { key: badKey, count: 1 }
    assert.throws(
      () =>
        assertAccessibilityRateLimitContract(
          sample.before,
          sample.after,
          fixture,
          keySecret
        ),
      (error) => {
        assert.match(
          error.message,
          /unexpected rate-limit (?:key shape|category)/u
        )
        assert.equal(error.message.includes(sentinel), false)
        return true
      }
    )
  }
  const snapshot = createSnapshots()
  snapshot.after.rateLimitRows = after.rateLimitRows
  snapshot.after.tables.RateLimit.count += 1
  assert.throws(
    () => assertAccessibilitySnapshotContract(snapshot.before, snapshot.after),
    (error) => {
      assert.match(
        error.message,
        /RateLimit count delta: expected 28, received 29/u
      )
      assert.ok(error.message.includes('rate-limit-diagnostic='))
      assert.equal(error.message.includes(sentinel), false)
      return true
    }
  )
})

test('rejects another principal with identical operation cardinality without exposing identities', () => {
  const { before, after } = createRateLimitSnapshots()
  const row = after.rateLimitRows.find(({ key }) =>
    key.startsWith('application:study-draft-save:')
  )
  assert.ok(row)
  row.key = principalKey('study-draft-save', fixture.author.userId)
  assert.throws(
    () =>
      assertAccessibilityRateLimitContract(before, after, fixture, keySecret),
    (error) => {
      assert.match(
        error.message,
        /unexpected rate-limit principal for study-draft-save/u
      )
      for (const privateValue of [
        keySecret,
        fixture.learner.userId,
        fixture.author.userId,
        row.key
      ]) {
        assert.equal(error.message.includes(privateValue), false)
      }
      return true
    }
  )
})
