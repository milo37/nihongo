import { describe, expect, it } from 'vitest'
import {
  assertMigrationCompatibility,
  type AppliedMigration
} from './readiness.js'

const finishedAt = new Date('2026-11-12T00:00:00.000Z')
const expected = [
  { name: '20261105090000_baseline', checksum: 'a'.repeat(64) },
  { name: '20261106090000_second', checksum: 'b'.repeat(64) },
  { name: '20261107090000_third', checksum: 'c'.repeat(64) }
] as const
const applied = (
  migrations: ReadonlyArray<{ name: string; checksum: string }>
): AppliedMigration[] =>
  migrations.map(({ name, checksum }) => ({
    migrationName: name,
    checksum,
    finishedAt,
    rolledBackAt: null,
    logs: null
  }))
const newer = { name: '20261108090000_newer', checksum: 'd'.repeat(64) }

describe('assertMigrationCompatibility (JLP-857)', () => {
  it('accepts the exact repository migrations', () => {
    expect(() =>
      assertMigrationCompatibility(expected, applied(expected))
    ).not.toThrow()
  })

  it('accepts newer database migrations after the repository ones (image rollback)', () => {
    expect(() =>
      assertMigrationCompatibility(expected, applied([...expected, newer]))
    ).not.toThrow()
    // The applied rows may come in any start order.
    expect(() =>
      assertMigrationCompatibility(
        expected,
        applied([newer, ...expected].toReversed())
      )
    ).not.toThrow()
  })

  it('refuses a repository migration the database lacks', () => {
    expect(() =>
      assertMigrationCompatibility(
        expected,
        applied([expected[0], expected[2]])
      )
    ).toThrow('Database migration count does not match the repository.')
    expect(() =>
      assertMigrationCompatibility(
        expected,
        applied([expected[0], expected[2], newer])
      )
    ).toThrow('Database migration state is not compatible.')
  })

  it('refuses a database migration ordered before a repository one', () => {
    expect(() =>
      assertMigrationCompatibility(
        expected,
        applied([
          ...expected,
          { name: '20261106120000_between', checksum: 'e'.repeat(64) }
        ])
      )
    ).toThrow('Database migration state is not compatible.')
  })

  it('refuses a checksum mismatch, also in a database with newer migrations', () => {
    const changed = [
      expected[0],
      { ...expected[1], checksum: 'f'.repeat(64) },
      expected[2]
    ]
    expect(() =>
      assertMigrationCompatibility(expected, applied(changed))
    ).toThrow('Database migration state is not compatible.')
    expect(() =>
      assertMigrationCompatibility(expected, applied([...changed, newer]))
    ).toThrow('Database migration state is not compatible.')
  })

  it('refuses a duplicate active row and a pending or failed migration', () => {
    expect(() =>
      assertMigrationCompatibility(
        expected,
        applied([...expected, expected[2]])
      )
    ).toThrow('Database migration state is not compatible.')
    expect(() =>
      assertMigrationCompatibility(
        expected,
        applied([...expected, newer, newer])
      )
    ).toThrow('Database migration state is not compatible.')
    expect(() =>
      assertMigrationCompatibility(expected, [
        ...applied(expected),
        { ...applied([newer])[0]!, finishedAt: null }
      ])
    ).toThrow('Database contains a pending or failed migration.')
    expect(() =>
      assertMigrationCompatibility(expected, [
        ...applied(expected),
        { ...applied([newer])[0]!, logs: 'error' }
      ])
    ).toThrow('Database contains a pending or failed migration.')
  })
})
