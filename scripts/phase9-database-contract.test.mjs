import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  assertPhase9SnapshotContract,
  phase9DatabaseTables,
  phase9ExpectedTableDeltas
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
