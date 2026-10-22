import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadExpectedMigrationManifest } from './readiness.js'

const migrationsDirectory = fileURLToPath(
  new URL('../../prisma/migrations/', import.meta.url)
)
const migrationName = '20260816130000_phase3_wrong_note_dashboard_read_indexes'
const approvedPriorChecksums = {
  '20260812130000_phase3_operational_baseline':
    '1f87c37afd796fd68b0af03e9ed46e67a54ad3718207da66989c3b09cc036351',
  '20260814113000_phase3_question_catalog':
    '843b172300782f4cb06891b9058c3ba945ac9d10aa0c0073b9bc5c49badcbbe1',
  '20260814120000_phase3_question_catalog_integrity':
    'fbf91a5d8f9fa86182e5cfe827cc37a1341a571f640dca433d44a950c804b831',
  '20260814120500_phase3_seed_provenance_guard':
    'eda2ff366b7cc5f4c6e0a8d76535873f4ff0261f8d89084d7ca31c94da95cb00',
  '20260814121000_phase3_seed_provenance_backfill':
    '87eaff26c97f9d9c6a542d515048b6f7843af82ecf8956a51a0ec55834856210',
  '20260814122000_phase3_seed_provenance_constraints':
    '061f7631625a221da7b706e8f059dc79e5e721beca48ae51a81a7ae5966d3af2',
  '20260814123000_phase3_seed_provenance_guard_cleanup':
    'd39e9e94225feadb71a46366edce3e56656b15e86231819b85da4a0cca9b80da',
  '20260814130000_phase3_auth_guest_principal':
    '96375b88348e5f3c75da295fa608816b32fc818369b96fbbfc6007a96b1439fc',
  '20260814131000_phase3_auth_integrity':
    'ccf9a201104f5371ad61e150fdb37ed9fa033834edb293081f4743ba05648de7',
  '20260814132000_phase3_auth_invariants':
    'ede39c4c6a0e4bbf9f6487fa0149bb35705eb3dc6b20678c6777179e5f0a5dd1',
  '20260814140000_phase3_study_sessions':
    '6697f4a7b9253357cfa6281c3ccccde4b463d7f189a3c4d8c3912405a410a463',
  '20260814141000_phase3_study_session_fallback_semantics':
    '5e9e8cfafe17403f2009a5e3db042fec485fce0ce2b8b71afbbecefadb16c405',
  '20260814142000_phase3_study_session_integrity':
    '15e65ece09afdc142a63ab25ba3b6e88a48c7d8b58c7626ccbe6f5d2aab32629',
  '20260814143000_phase3_study_session_identity_integrity':
    'a96aec5f2845bc0ca6ecbc0f658da4a4967fe835578af7a1c77c3e328181773b',
  '20260814144000_phase3_study_session_existing_selection_guard':
    '07662a88c6f31893c25a288c16d172f8cee635e8acc186b4c6a1c5d7088fc336',
  '20260815100000_phase3_study_submission_facts':
    '38bbfb7755db34aa9cf17500f7a97a3145ac596bcd00657bbd5df1d1f302bb33',
  '20260815101000_phase3_study_submission_integrity':
    '3315643d77f0d41c737479aebba4801c4d9544bee9f5dd921866970032ba361a',
  '20260815102000_phase3_wrong_note_latest_wrong_integrity':
    '37071a0b9f47347440da95218f248330f8ea43a45701ac85563b667cea8f7374',
  '20260815103000_phase3_submission_retention_history_integrity':
    '55b2bc333fc9691dd5e0c287bae458a7b7fccfa679fe2c0f0fd643da5a33e492'
} as const

describe('Slice 5 read indexes migration', () => {
  it('기존 migration 1~19 byte와 append-only migration 20 순서를 고정한다', () => {
    const manifest = loadExpectedMigrationManifest(migrationsDirectory)

    expect(manifest.slice(0, 20).map(({ name }) => name)).toEqual([
      ...Object.keys(approvedPriorChecksums).toSorted(),
      migrationName
    ])
    for (const [name, checksum] of Object.entries(approvedPriorChecksums)) {
      const sql = readFileSync(join(migrationsDirectory, name, 'migration.sql'))
      expect(createHash('sha256').update(sql).digest('hex')).toBe(checksum)
    }
  })

  it('historical label trim guard와 두 read index만 append한다', () => {
    const sql = readFileSync(
      join(migrationsDirectory, migrationName, 'migration.sql'),
      'utf8'
    )

    expect(sql).toContain('BEGIN;')
    expect(sql).toContain('COMMIT;')
    expect(sql).toContain('"StudySession_userId_submittedAt_id_dashboard_idx"')
    expect(sql).toContain('"status" = \'SUBMITTED\'')
    expect(sql).toContain('"submittedAt" IS NOT NULL')
    expect(sql).toContain('"mode" = \'RANDOM\'')
    expect(sql).toContain('"QuestionVersionTag_label_snapshot_trimmed_check"')
    expect(sql).toContain('"labelSnapshot" <> btrim("labelSnapshot")')
    expect(sql).toContain("USING ERRCODE = '23514'")
    expect(sql).toContain('"WrongNote_userId_wrongCount_lastWrongAt_id_idx"')
    expect(sql.match(/^CREATE INDEX/gmu)).toHaveLength(2)
    expect(sql).not.toMatch(/CREATE TABLE|ADD COLUMN|DROP /u)
  })
})
