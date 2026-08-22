import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadExpectedMigrationManifest } from './readiness.js'

const migrationsDirectory = fileURLToPath(
  new URL('../../prisma/migrations/', import.meta.url)
)
const enumMigrationName =
  '20260821151000_phase5_targeted_review_operation' as const
const foundationMigrationName =
  '20260821152000_phase5_review_center_foundation' as const
const enumMigrationSql = readFileSync(
  `${migrationsDirectory}/${enumMigrationName}/migration.sql`,
  'utf8'
)
const foundationMigrationSql = readFileSync(
  `${migrationsDirectory}/${foundationMigrationName}/migration.sql`,
  'utf8'
)
const phase5Slice1Checksums = [
  'c5bbdd22cb1bc070f5037b9e8f5d332836690e108aff149152250eb411408275',
  '9223bbfa478b420fbd957e29c60ba71868f815fe7e39003635efeea65619c629'
] as const

const phase4Checksums = [
  '1f87c37afd796fd68b0af03e9ed46e67a54ad3718207da66989c3b09cc036351',
  '843b172300782f4cb06891b9058c3ba945ac9d10aa0c0073b9bc5c49badcbbe1',
  'fbf91a5d8f9fa86182e5cfe827cc37a1341a571f640dca433d44a950c804b831',
  'eda2ff366b7cc5f4c6e0a8d76535873f4ff0261f8d89084d7ca31c94da95cb00',
  '87eaff26c97f9d9c6a542d515048b6f7843af82ecf8956a51a0ec55834856210',
  '061f7631625a221da7b706e8f059dc79e5e721beca48ae51a81a7ae5966d3af2',
  'd39e9e94225feadb71a46366edce3e56656b15e86231819b85da4a0cca9b80da',
  '96375b88348e5f3c75da295fa608816b32fc818369b96fbbfc6007a96b1439fc',
  'ccf9a201104f5371ad61e150fdb37ed9fa033834edb293081f4743ba05648de7',
  'ede39c4c6a0e4bbf9f6487fa0149bb35705eb3dc6b20678c6777179e5f0a5dd1',
  '6697f4a7b9253357cfa6281c3ccccde4b463d7f189a3c4d8c3912405a410a463',
  '5e9e8cfafe17403f2009a5e3db042fec485fce0ce2b8b71afbbecefadb16c405',
  '15e65ece09afdc142a63ab25ba3b6e88a48c7d8b58c7626ccbe6f5d2aab32629',
  'a96aec5f2845bc0ca6ecbc0f658da4a4967fe835578af7a1c77c3e328181773b',
  '07662a88c6f31893c25a288c16d172f8cee635e8acc186b4c6a1c5d7088fc336',
  '38bbfb7755db34aa9cf17500f7a97a3145ac596bcd00657bbd5df1d1f302bb33',
  '3315643d77f0d41c737479aebba4801c4d9544bee9f5dd921866970032ba361a',
  '37071a0b9f47347440da95218f248330f8ea43a45701ac85563b667cea8f7374',
  '55b2bc333fc9691dd5e0c287bae458a7b7fccfa679fe2c0f0fd643da5a33e492',
  'bd7a6241b1404123fc227ff64597a3f1f4e021a8c155baaf0f2e86ede75de9b4',
  '241fded22c19cc6cfe2b9ac4d01885c8a6ad6ef4e14b94466c28ad4400665967',
  '01fcdc20e44c42fb0c9fbca7931a327681f2055f084faa02d18f533c3d68888e',
  'dca1afbcab1cc2fa83c2e16ab3d8f74f76ceb3a42e34c436150dc0b93c9ff852',
  '8ee6b5dde0e73e7c499e24f0fedd0b31ef6ff569f1422c7189cd8eb2499b746f',
  '3db1e757030803b9b8078673e4dcdc1743a929a98856a7529d6e5cbcd6c8c5da'
] as const

describe('Phase 5 Slice 1 review-center migrations', () => {
  it('기존 25개 checksum을 보존하고 enum-only/dependent 순서로 append한다', () => {
    const manifest = loadExpectedMigrationManifest(migrationsDirectory)

    expect(manifest).toHaveLength(27)
    expect(manifest.slice(0, 25).map(({ checksum }) => checksum)).toEqual(
      phase4Checksums
    )
    expect(manifest.slice(25).map(({ name }) => name)).toEqual([
      enumMigrationName,
      foundationMigrationName
    ])
    expect(manifest.slice(25).map(({ checksum }) => checksum)).toEqual(
      phase5Slice1Checksums
    )
  })

  it('첫 migration은 enum value만 추가하고 같은 transaction에서 소비하지 않는다', () => {
    expect(enumMigrationSql).toContain(
      "ADD VALUE 'STUDY_TARGETED_REVIEW_CREATE'"
    )
    expect(enumMigrationSql).not.toContain('FROM "IdempotencyRecord"')
    expect(enumMigrationSql).not.toContain('CREATE TABLE "UserMemo"')
    expect(enumMigrationSql).not.toContain(
      'CREATE INDEX "ReviewEvent_wrongNoteId_occurredAt_id_idx"'
    )
    expect(enumMigrationSql).toContain('trigger_record.tgqual IS NULL')
    expect(enumMigrationSql).toContain("trigger_record.tgattr = ''::int2vector")
    expect(enumMigrationSql).toContain('trigger_record.tgnargs = 0')
  })

  it('dependent migration이 memo/cursor/idempotency foundation을 forward-only로 선언한다', () => {
    for (const fragment of [
      'CREATE FUNCTION "normalize_user_memo_text"(TEXT)',
      'CREATE TABLE "UserMemo"',
      'CONSTRAINT "UserMemo_wrongNoteId_fkey"',
      'CONSTRAINT "UserMemo_text_normalized_check"',
      'CONSTRAINT "UserMemo_timestamp_order_check"',
      'CREATE INDEX "ReviewEvent_wrongNoteId_occurredAt_id_idx"',
      'CREATE OR REPLACE FUNCTION "validate_idempotency_record_change"()',
      'CREATE OR REPLACE FUNCTION "validate_idempotency_record_committed_state"()',
      "'STUDY_TARGETED_REVIEW_CREATE'",
      "current_completed_at + INTERVAL '7 days'"
    ]) {
      expect(foundationMigrationSql).toContain(fragment)
    }
    expect(foundationMigrationSql).toContain('trigger_record.tgqual IS NULL')
    expect(foundationMigrationSql).toContain(
      "trigger_record.tgattr = ''::int2vector"
    )
    expect(foundationMigrationSql).toContain('trigger_record.tgnargs = 0')
    expect(foundationMigrationSql).not.toMatch(
      /\b(?:DELETE FROM "WrongNote"|DROP TABLE|TRUNCATE|UPDATE "WrongNote")\b/u
    )
    expect(foundationMigrationSql).not.toContain(
      'DROP INDEX "ReviewEvent_wrongNoteId_occurredAt_idx"'
    )
  })

  it('기존 submit/draft/retry committed-state branch를 모두 보존한다', () => {
    for (const operation of [
      'STUDY_SUBMIT',
      'STUDY_DRAFT_SAVE',
      'STUDY_RETRY_CREATE',
      'STUDY_TARGETED_REVIEW_CREATE'
    ]) {
      expect(foundationMigrationSql).toContain(
        `current_operation = '${operation}'`
      )
    }
    expect(foundationMigrationSql).toContain(
      'tag."labelSnapshot" COLLATE "C" ASC'
    )
    expect(foundationMigrationSql).toContain('target_pointer_count <> 1')
  })
})
