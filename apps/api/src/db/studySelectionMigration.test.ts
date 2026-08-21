import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadExpectedMigrationManifest } from './readiness.js'

const migrationsDirectory = fileURLToPath(
  new URL('../../prisma/migrations/', import.meta.url)
)
const migrationName = '20260818130000_phase4_study_selection_modes'
const migrationSql = readFileSync(
  `${migrationsDirectory}/${migrationName}/migration.sql`,
  'utf8'
)

describe('Phase 4 Slice 3 selection migration', () => {
  it('23번째 append-only migration으로만 추가한다', () => {
    const manifest = loadExpectedMigrationManifest(migrationsDirectory)

    expect(manifest).toHaveLength(23)
    expect(manifest.at(-1)?.name).toBe(migrationName)
  })

  it('review pointer와 evidence source를 fail-closed mode matrix로 고정한다', () => {
    expect(migrationSql).toContain(
      'Slice 3 requires every existing current review pointer to be null.'
    )
    expect(migrationSql).toContain(
      'Slice 3 requires every existing ReviewEvent source to match its mode.'
    )
    expect(migrationSql).toContain(
      'DROP CONSTRAINT "WrongNote_slice4_current_review_check"'
    )
    expect(migrationSql).toContain(
      'WrongNote current review pointer must start null.'
    )
    expect(migrationSql).toContain(
      'WrongNote current review pointer cannot return to null.'
    )
    expect(migrationSql).toContain(
      'WrongNote current review pointer cannot rewind.'
    )
    expect(migrationSql).toContain(
      "evidence_mode NOT IN ('WRONG_NOTE', 'DAILY_REVIEW')"
    )
    expect(migrationSql).toContain(
      "evidence_mode NOT IN ('RANDOM', 'WEAKNESS', 'BOOKMARK')"
    )
    expect(migrationSql).toContain(
      'BEFORE INSERT OR UPDATE OR DELETE ON "WrongNote"'
    )
  })

  it('owner-scoped selection과 all-mode dashboard index를 정확히 선언한다', () => {
    const expectedIndexes = [
      'StudySession_userId_level_subject_submittedAt_id_weakness_idx',
      'StudySession_guest_level_subject_submittedAt_id_weakness_idx',
      'WrongNote_user_status_lastWrongAt_wrongCount_questionId_idx',
      'WrongNote_userId_status_id_questionId_daily_idx',
      'StudySession_userId_submittedAt_id_dashboard_idx'
    ] as const

    for (const indexName of expectedIndexes) {
      expect(indexName.length).toBeLessThanOrEqual(63)
      expect(migrationSql).toContain(`"${indexName}"`)
    }
    expect(migrationSql).toContain(
      'DROP INDEX "StudySession_userId_submittedAt_id_dashboard_idx"'
    )
    const recreatedDashboardIndex = migrationSql.slice(
      migrationSql.lastIndexOf(
        'CREATE INDEX "StudySession_userId_submittedAt_id_dashboard_idx"'
      )
    )
    expect(recreatedDashboardIndex).not.toContain('"mode"')
  })

  it('Slice 4 Bookmark schema와 Slice 5 retry relation은 만들지 않는다', () => {
    expect(migrationSql).not.toMatch(/CREATE TABLE\s+"Bookmark"/u)
    expect(migrationSql).not.toMatch(/ADD COLUMN\s+"retryOf"/u)
    expect(migrationSql).not.toContain('STUDY_RETRY_CREATE')
  })
})
