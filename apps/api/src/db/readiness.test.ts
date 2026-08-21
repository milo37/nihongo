import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  assertMigrationCompatibility,
  createSingleFlightReadiness,
  loadExpectedMigrationManifest,
  type AppliedMigration
} from './readiness.js'

const migrationDirectory = fileURLToPath(
  new URL('../../prisma/migrations/', import.meta.url)
)
const migrationSql = readFileSync(
  `${migrationDirectory}/20260812130000_phase3_operational_baseline/migration.sql`
)
const checksum = createHash('sha256').update(migrationSql).digest('hex')
const completeMigration: AppliedMigration = {
  migrationName: '20260812130000_phase3_operational_baseline',
  checksum,
  finishedAt: new Date('2026-08-12T13:00:00.000Z'),
  rolledBackAt: null,
  logs: null
}

describe('database readiness', () => {
  it('repository migration SQL에서 Prisma checksum manifest를 만든다', () => {
    const manifest = loadExpectedMigrationManifest(migrationDirectory)

    expect(manifest).toHaveLength(24)
    expect(manifest.at(-1)?.name).toBe('20260821130000_phase4_bookmarks')
    expect(manifest).toContainEqual({
      name: completeMigration.migrationName,
      checksum
    })
    expect(manifest.map(({ name }) => name)).toEqual(
      manifest.map(({ name }) => name).toSorted()
    )
  })

  it('완료된 migration과 repository manifest가 정확히 일치해야 한다', () => {
    const expected = loadExpectedMigrationManifest(migrationDirectory)
    const applied = expected.map<AppliedMigration>((migration) => ({
      migrationName: migration.name,
      checksum: migration.checksum,
      finishedAt: new Date('2026-08-12T13:00:00.000Z'),
      rolledBackAt: null,
      logs: null
    }))

    expect(() => assertMigrationCompatibility(expected, applied)).not.toThrow()

    expect(() =>
      assertMigrationCompatibility(
        expected,
        applied.map((migration, index) =>
          index === 0 ? { ...migration, logs: '' } : migration
        )
      )
    ).not.toThrow()

    const [firstMigration] = applied

    if (!firstMigration) {
      throw new Error('Migration fixture가 필요합니다.')
    }

    for (const invalid of [
      { ...firstMigration, finishedAt: null },
      { ...firstMigration, logs: 'migration failed' },
      { ...firstMigration, checksum: 'mismatch' },
      { ...firstMigration, migrationName: 'unexpected_migration' }
    ]) {
      expect(() =>
        assertMigrationCompatibility(expected, [invalid, ...applied.slice(1)])
      ).toThrow()
    }
  })
  it('동시 readiness를 하나로 합치고 완료 후 새 검사를 허용한다', async () => {
    let resolveCheck: (() => void) | undefined
    const check = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCheck = resolve
        })
    )
    const run = createSingleFlightReadiness(check)
    const first = run()
    const second = run()

    expect(first).toBe(second)
    await Promise.resolve()
    expect(check).toHaveBeenCalledOnce()
    resolveCheck?.()
    await first

    const third = run()
    expect(third).not.toBe(first)
    await Promise.resolve()
    expect(check).toHaveBeenCalledTimes(2)
    resolveCheck?.()
    await third
  })
})
