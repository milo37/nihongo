import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadExpectedMigrationManifest } from './readiness.js'

const migrationsDirectory = fileURLToPath(
  new URL('../../prisma/migrations/', import.meta.url)
)
const migrationName = '20260821130000_phase4_bookmarks'
const migrationSql = readFileSync(
  `${migrationsDirectory}/${migrationName}/migration.sql`,
  'utf8'
)

describe('Phase 4 Slice 4 Bookmark migration', () => {
  it('24번째 append-only migration으로 추가한다', () => {
    const manifest = loadExpectedMigrationManifest(migrationsDirectory)
    expect(manifest).toHaveLength(24)
    expect(manifest.at(-1)?.name).toBe(migrationName)
  })

  it('owner identity, retention FK와 exact index manifest를 선언한다', () => {
    expect(migrationSql).toContain('CREATE TABLE "Bookmark"')
    expect(migrationSql).toContain(
      'CONSTRAINT "Bookmark_userId_questionId_key" UNIQUE ("userId", "questionId")'
    )
    expect(migrationSql).toMatch(
      /"Bookmark_userId_fkey"[\s\S]*ON DELETE CASCADE ON UPDATE CASCADE/u
    )
    expect(migrationSql).toMatch(
      /"Bookmark_questionId_fkey"[\s\S]*ON DELETE RESTRICT ON UPDATE CASCADE/u
    )

    for (const indexName of [
      'Bookmark_userId_createdAt_id_idx',
      'Bookmark_userId_createdAt_questionId_idx',
      'Bookmark_questionId_id_idx'
    ]) {
      expect(indexName.length).toBeLessThanOrEqual(63)
      expect(migrationSql).toContain(`"${indexName}"`)
    }
  })
})
