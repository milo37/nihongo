import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadExpectedMigrationManifest } from './readiness.js'

const migrationsDirectory = fileURLToPath(
  new URL('../../prisma/migrations/', import.meta.url)
)
const migrationName = '20260821150000_phase4_result_retry'
const migrationSql = readFileSync(
  `${migrationsDirectory}/${migrationName}/migration.sql`,
  'utf8'
)

describe('Phase 4 Slice 5 result retry migration', () => {
  it('25번째 append-only migration으로 추가한다', () => {
    const manifest = loadExpectedMigrationManifest(migrationsDirectory)
    expect(manifest).toHaveLength(25)
    expect(manifest.at(-1)?.name).toBe(migrationName)
  })

  it('owner-preserving deferred relation과 leaf-first index를 선언한다', () => {
    expect(migrationSql).toContain('ADD COLUMN "retryOfStudySessionId" UUID')
    for (const constraintName of [
      'StudySession_retryOfStudySessionId_fkey',
      'StudySession_retryOfStudySessionId_userId_fkey',
      'StudySession_retryOfStudySessionId_guestPrincipalId_fkey'
    ]) {
      const fragment = migrationSql.match(
        new RegExp(
          `ADD CONSTRAINT "${constraintName}"([\\s\\S]*?)(?=,\\n  ADD CONSTRAINT|;)`,
          'u'
        )
      )?.[0]
      expect(fragment).toContain('ON DELETE NO ACTION ON UPDATE CASCADE')
      expect(fragment).toContain('DEFERRABLE INITIALLY DEFERRED')
    }
    for (const indexName of [
      'StudySession_retry_user_source_idx',
      'StudySession_retry_guest_source_idx',
      'StudySession_retryOfStudySessionId_id_idx'
    ]) {
      expect(indexName.length).toBeLessThanOrEqual(63)
      expect(migrationSql).toContain(`"${indexName}"`)
    }
  })

  it('reserved preflight와 retry committed-state 7일 replay를 활성화한다', () => {
    expect(migrationSql).toContain('WHERE "operation" = \'STUDY_RETRY_CREATE\'')
    expect(migrationSql).toContain(
      'CREATE FUNCTION "validate_study_retry_relation"()'
    )
    expect(migrationSql).toContain('WITH RECURSIVE retry_ancestry AS')
    expect(migrationSql).toContain(
      'CREATE OR REPLACE FUNCTION "validate_idempotency_record_change"()'
    )
    expect(migrationSql).toContain(
      'CREATE OR REPLACE FUNCTION "validate_idempotency_record_committed_state"()'
    )
    expect(migrationSql).toContain("current_completed_at + INTERVAL '7 days'")
    expect(migrationSql).toContain(
      'expected_retry_session := JSONB_BUILD_OBJECT('
    )
    expect(migrationSql).toContain(
      'current_response_body IS DISTINCT FROM JSONB_BUILD_OBJECT('
    )
    expect(migrationSql).toContain("'questions', expected_retry_questions")
    expect(migrationSql).toContain('tag."labelSnapshot" COLLATE "C" ASC')
    expect(migrationSql).toContain(
      'CREATE OR REPLACE FUNCTION "validate_review_event_change"()'
    )
    expect(migrationSql).toContain('session."retryOfStudySessionId"')
    expect(migrationSql).toContain(
      'source_item."questionVersionId" = NEW."questionVersionId"'
    )
    expect(migrationSql).toContain('AND NOT source_answer."isCorrect"')
    expect(migrationSql).not.toContain(
      'currentReviewQuestionVersionId" = NEW."questionVersionId"'
    )
    expect(migrationSql).not.toContain('reserved until the Slice 5 migration')
  })
})
