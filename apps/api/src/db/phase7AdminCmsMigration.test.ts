import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadExpectedMigrationManifest } from './readiness.js'

const migrationsDirectory = fileURLToPath(
  new URL('../../prisma/migrations/', import.meta.url)
)
const enumMigrationName = '20260827100000_phase7_admin_cms_enums' as const
const foundationMigrationName =
  '20260827101000_phase7_admin_cms_foundation' as const
const archiveVerifierMigrationName =
  '20260909120000_phase7_archive_empty_manifest_verifier' as const
const reauthenticationMigrationName =
  '20260916120000_phase7_reauthentication_foundation' as const
const enumMigrationSql = readFileSync(
  `${migrationsDirectory}/${enumMigrationName}/migration.sql`,
  'utf8'
)
const foundationMigrationSql = readFileSync(
  `${migrationsDirectory}/${foundationMigrationName}/migration.sql`,
  'utf8'
)
const archiveVerifierMigrationSql = readFileSync(
  `${migrationsDirectory}/${archiveVerifierMigrationName}/migration.sql`,
  'utf8'
)
const reauthenticationMigrationSql = readFileSync(
  `${migrationsDirectory}/${reauthenticationMigrationName}/migration.sql`,
  'utf8'
)
const removeDollarQuotedBodies = (sql: string) =>
  sql
    .replace(/^\s*--.*$/gmu, '')
    .replace(/\$([a-z_][a-z0-9_]*)\$[\s\S]*?\$\1\$/giu, '')
    .replace(/\$\$[\s\S]*?\$\$/gu, '')
const extractOperationManifestVerifier = (
  sql: string,
  createPrefix: 'CREATE FUNCTION' | 'CREATE OR REPLACE FUNCTION'
) => {
  const startMarker = `${createPrefix} "phase7_verify_operation_manifest"(operation_id UUID)`
  const endMarker = '\n$function$;'
  const start = sql.indexOf(startMarker)
  const end = sql.indexOf(endMarker, start)

  if (start < 0 || end < 0) {
    throw new Error(
      'Phase 7 operation manifest verifier definition is missing.'
    )
  }

  return sql.slice(start, end + endMarker.length)
}
const foundationTopLevelSql = foundationMigrationSql
  .replace(/^--.*$/gmu, '')
  .replace(/\$([a-z_][a-z0-9_]*)\$[\s\S]*?\$\1\$/giu, '')
  .replace(/\$\$[\s\S]*?\$\$/gu, '')
const archiveVerifierTopLevelSql = removeDollarQuotedBodies(
  archiveVerifierMigrationSql
)
const reauthenticationTopLevelSql = removeDollarQuotedBodies(
  reauthenticationMigrationSql
)

const approvedPrePhase7MigrationNames = [
  '20260812130000_phase3_operational_baseline',
  '20260814113000_phase3_question_catalog',
  '20260814120000_phase3_question_catalog_integrity',
  '20260814120500_phase3_seed_provenance_guard',
  '20260814121000_phase3_seed_provenance_backfill',
  '20260814122000_phase3_seed_provenance_constraints',
  '20260814123000_phase3_seed_provenance_guard_cleanup',
  '20260814130000_phase3_auth_guest_principal',
  '20260814131000_phase3_auth_integrity',
  '20260814132000_phase3_auth_invariants',
  '20260814140000_phase3_study_sessions',
  '20260814141000_phase3_study_session_fallback_semantics',
  '20260814142000_phase3_study_session_integrity',
  '20260814143000_phase3_study_session_identity_integrity',
  '20260814144000_phase3_study_session_existing_selection_guard',
  '20260815100000_phase3_study_submission_facts',
  '20260815101000_phase3_study_submission_integrity',
  '20260815102000_phase3_wrong_note_latest_wrong_integrity',
  '20260815103000_phase3_submission_retention_history_integrity',
  '20260816130000_phase3_wrong_note_dashboard_read_indexes',
  '20260817130000_phase4_practice_idempotency_operations',
  '20260817131000_phase4_study_draft_core',
  '20260818130000_phase4_study_selection_modes',
  '20260821130000_phase4_bookmarks',
  '20260821150000_phase4_result_retry',
  '20260821151000_phase5_targeted_review_operation',
  '20260821152000_phase5_review_center_foundation'
] as const

const approvedPrePhase7Checksums = [
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
  '3db1e757030803b9b8078673e4dcdc1743a929a98856a7529d6e5cbcd6c8c5da',
  'c5bbdd22cb1bc070f5037b9e8f5d332836690e108aff149152250eb411408275',
  '9223bbfa478b420fbd957e29c60ba71868f815fe7e39003635efeea65619c629'
] as const
const approvedPhase7Checksums = [
  'ceca4c83981de1e21c528952157fb8c0452583889c4374cba70e3875acbd2298',
  '6e34969b93b6b07c7be9e5fb13a1d2a4612a2825fe6e08871e8d1ea15e9355d7',
  'afa59638fa9ff3662fb00abe28fe8fb3a14777b98ecf3b2b8e8226493794adfe',
  'ae57562faf7342e2ae2ce1a83d35bf9cec00f1ecbe64c21f7d947a7bd3009e08'
] as const

describe('Phase 7 Slice 1 admin-CMS migrations', () => {
  it('기존39 migration의 순서와 모든 역사 prefix checksum을 보존하고 SSO4개를 pin한다', () => {
    const manifest = loadExpectedMigrationManifest(migrationsDirectory)

    expect(manifest).toHaveLength(44)
    expect(manifest.slice(0, 27).map(({ name }) => name)).toEqual(
      approvedPrePhase7MigrationNames
    )
    expect(manifest.slice(0, 27).map(({ checksum }) => checksum)).toEqual(
      approvedPrePhase7Checksums
    )
    expect(manifest.slice(27, 38).map(({ name }) => name)).toEqual([
      enumMigrationName,
      foundationMigrationName,
      archiveVerifierMigrationName,
      reauthenticationMigrationName,
      '20261005120000_phase7_reviewed_seed_revision2',
      '20261005183000_phase7_reviewed_catalog_current',
      '20261007060000_phase7_approved_reading_tags',
      '20261009060000_phase7_approved_n3_reading_tags',
      '20261009072500_phase7_approved_n4_n2_reading_tags',
      '20261009092000_phase7_n4_n2_revision2_digest_fix',
      '20261009120000_phase7_approved_n4_reading_batch7_tags'
    ])
    expect(manifest.slice(27, 38).map(({ checksum }) => checksum)).toEqual([
      ...approvedPhase7Checksums,
      'ca4d9e9bcc158f524038a63fe3158347e0f811a3f481e700c3aa22f3036af848',
      'c04b27c1ee7610c8648da58a05596c2d9573a48cfad20c1a1b8b9f818dc3554d',
      '366e534d1abda5668a5de4d3c5c3cf6c74ccf4f9b3bba646ef90a5efa32b630c',
      'b7635e991f50d7191aa184822133a69af78a1b8173a0cec57b0b85972c65d447',
      '75fb2cfe9305342dfc62c72f00ae103da142e1ac0424bb71f38e27078fe22e4d',
      '21f8911ff72d11405338df8c7a539c6eff92279593d895dfba2cc4dd236326aa',
      'd4d2caac296296fd941b7631cf6cf7016da2b1be1f764c01386d1d2b1413d806'
    ])
    const digest = (entries: readonly { name: string; checksum: string }[]) =>
      createHash('sha256')
        .update(
          entries.map(({ name, checksum }) => `${name}\0${checksum}\n`).join('')
        )
        .digest('hex')
    expect(digest(manifest.slice(0, 27))).toBe(
      '6870a93dd141b7a6c226de7aeed315d48ce313828c82bb92f91bf8a8861ed2ea'
    )
    const oldPhysical35 = manifest.slice(0, 35)
    expect(digest(oldPhysical35)).toBe(
      '6ce3cb9d17492c2806fab8e03b923b9440da30ca6be9b10c5a978abc1bd5d8a8'
    )
    const excludeCurrentCatalog = ({ name }: { name: string }) =>
      name !== '20261005183000_phase7_reviewed_catalog_current'
    const oldCanonical34 = oldPhysical35.filter(excludeCurrentCatalog)
    expect(oldCanonical34).toHaveLength(34)
    expect(digest(oldCanonical34)).toBe(
      '4448f7aa40804bb3058f1a986c6af5527eb26ca7375973bcca320fa1bf51d7f8'
    )
    const oldPhysical36 = manifest.slice(0, 36)
    expect(digest(oldPhysical36)).toBe(
      '8b9f35ed93aa7179cf5405a49039a10ff3f484171c54a33efbd1018b0494b02f'
    )
    const oldCanonical35 = oldPhysical36.filter(excludeCurrentCatalog)
    expect(oldCanonical35).toHaveLength(35)
    expect(digest(oldCanonical35)).toBe(
      'b1599310da408668bd4617f35ebc47109cb6e23d91e23dd737eaff521d49a393'
    )
    // File inventory candidates only; actual DB and recovery bindings are separate.
    const oldPhysical37 = manifest.slice(0, 37)
    expect(digest(oldPhysical37)).toBe(
      '89158202b48454a0d179913983fe1449dc139c0db25aec0ba4c5480040291aad'
    )
    const candidateCanonical36 = oldPhysical37.filter(excludeCurrentCatalog)
    expect(candidateCanonical36).toHaveLength(36)
    expect(digest(candidateCanonical36)).toBe(
      '96eebebc8d76d1eb858b1cc12d7559685a5e06559a57ff8d9aabdf3b067e3ab3'
    )
    expect(digest(manifest.slice(0, 38))).toBe(
      '6aa49828fc3138b2b544830794cad68c05ed11ae2ffa018b9e43a2800cb578dd'
    )
    const candidateCanonical37 = manifest
      .slice(0, 38)
      .filter(excludeCurrentCatalog)
    expect(candidateCanonical37).toHaveLength(37)
    expect(digest(candidateCanonical37)).toBe(
      '3ac8616bdde0bc95b4d8074297084308a3bbee9d3858899566f4b6c9003b266e'
    )
    expect(manifest[38]).toEqual({
      name: '20261010071000_phase7_approved308_tags',
      checksum:
        '600dd3ab067f2af20bb04ecf1dd0f7c30eb18c6c32eb8ab03d746735fa0b0401'
    })
    expect(digest(manifest.slice(0, 39))).toBe(
      '611c2ec676b54bc333706d2401775c242e5d65886c9eb8cb255f15d13dfbc0c1'
    )
    expect(manifest.slice(39, 43)).toEqual([
      {
        name: '20261019090000_sso_login_transactions',
        checksum:
          '4a89ac9d8b5665bcb5d5d3088ef2a933e22ac112431671556e8e8385b86d4cdc'
      },
      {
        name: '20261019093000_sso_apple_google_providers',
        checksum:
          '309095c6db46793acafd6a6ee0ddcd0d96243530f178d5cd00883bf95dc4227b'
      },
      {
        name: '20261019100000_sso_identity_mapping',
        checksum:
          '2e5cb49adf6566aa36715941548204b884e86896091b110ca871e34cf4895aa9'
      },
      {
        name: '20261019103000_sso_admin_fresh',
        checksum:
          'a9b152386e05eacf74ced813dbff4bd3875717958133d05ea6c8a1cdbc54e88c'
      }
    ])
    expect(digest(manifest.slice(0, 43))).toBe(
      '394a68aaeb5e7299dc623eb0094426e74dcac050bce467183c11b161aa4d0fec'
    )
    expect(manifest.slice(43)).toEqual([
      {
        name: '20261019110000_sso_admin_fresh_erasure_ownership',
        checksum:
          '3dd06daf9b64b780e5bfcf4c73012a0f7f87a3db63569e94dd7dea60c7dafd1b'
      }
    ])
    expect(digest(manifest.slice(39))).toBe(
      '7625f9212f1abd9f24c51153bd5ffc1c021bab63d1aa7faf8682a6597cac3abd'
    )
    expect(digest(manifest)).toBe(
      '9c273aa902d6f008b112badd9c6b327abdc96905e10569696d32850268aaead0'
    )
  })

  it.each([
    '20261019090000_sso_login_transactions',
    '20261019093000_sso_apple_google_providers',
    '20261019100000_sso_identity_mapping',
    '20261019103000_sso_admin_fresh',
    '20261019110000_sso_admin_fresh_erasure_ownership'
  ])(
    '%s creates in the owned target and hardens every exact definer signature',
    (name) => {
      const sql = readFileSync(
        `${migrationsDirectory}/${name}/migration.sql`,
        'utf8'
      )
      const ddlPath = sql.indexOf(
        '-- Keep the creation namespace on the owned target'
      )
      const firstCreate = sql.search(
        /CREATE(?: OR REPLACE)? (?:TABLE|FUNCTION)/u
      )
      expect(ddlPath).toBeGreaterThan(0)
      expect(ddlPath).toBeLessThan(firstCreate)
      expect(sql.slice(ddlPath, firstCreate)).toContain(
        "pg_catalog.quote_ident(pg_catalog.current_setting('app.phase7_target_schema', false)) ||\n  ', pg_temp', true)"
      )
      expect(sql.slice(ddlPath, firstCreate)).not.toContain("'pg_catalog, '")
      const definitions = [
        ...sql.matchAll(
          /CREATE(?: OR REPLACE)? FUNCTION "([^"]+)"\(([\s\S]*?)\)\s*RETURNS/gu
        )
      ]
      const signatures = definitions.map((match) => {
        const argumentTypes = match[2]!
          .split(',')
          .filter((argument) => argument.trim())
          .map((argument) => argument.trim().split(/\s+/u).at(-1))
        return `"${match[1]}"(${argumentTypes.join(',')})`
      })
      const hardenIndex = sql.indexOf('DO $harden_sso_functions$')
      const rolesBeforeHarden = [
        ...removeDollarQuotedBodies(sql.slice(0, hardenIndex)).matchAll(
          /SET LOCAL ROLE "([^"]+)";/gu
        )
      ]
      expect(rolesBeforeHarden.at(-1)?.[1]).toBe('nihongo_phase7_owner')
      expect(sql.indexOf('$harden_sso_functions$;')).toBeLessThan(
        sql.lastIndexOf('SET LOCAL ROLE "nihongo_phase7_migration";')
      )
      const harden = sql.slice(hardenIndex)
      const hardenedSignatures = [
        ...harden.matchAll(/'("[a-z0-9_]+"\([^']*\))'/gu)
      ].map((match) => match[1])
      expect(signatures.length).toBeGreaterThan(0)
      expect(hardenedSignatures).toEqual(signatures)
      expect(
        (sql.match(/SECURITY DEFINER SET search_path FROM CURRENT/gu) ?? [])
          .length
      ).toBe(signatures.length)
      expect(harden).toContain(
        'ALTER FUNCTION %I.%s SET search_path TO pg_catalog, %I, pg_temp'
      )
      expect(harden).toContain(
        'target_schema, function_signature, target_schema'
      )
      expect(sql.lastIndexOf('$function$;')).toBeLessThan(
        sql.indexOf('DO $harden_sso_functions$')
      )
      expect(sql.indexOf('$harden_sso_functions$;')).toBeLessThan(
        sql.lastIndexOf('COMMIT;')
      )
      expect(sql).not.toMatch(
        /GRANT[^;]*(?:CREATE|USAGE)[^;]*ON SCHEMA[^;]*pg_catalog/iu
      )
    }
  )

  it('Slice 3R은 append-only auth foundation과 partial live-intent fence를 선언한다', () => {
    expect(reauthenticationMigrationSql).toContain(
      'ADD COLUMN "authorizationState" "AuthSessionAuthorizationState"'
    )
    expect(reauthenticationMigrationSql).toContain(
      'CREATE TABLE "Phase7ReauthenticationIntent"'
    )
    expect(reauthenticationMigrationSql).toContain(
      'CREATE TABLE "Phase7AuthorityRevocationEvidence"'
    )
    expect(reauthenticationMigrationSql).toContain(
      'CREATE UNIQUE INDEX "Phase7ReauthenticationIntent_live_old_session_key"'
    )
    expect(reauthenticationMigrationSql).toContain(
      `WHERE "state" IN ('PREPARED', 'STAGED')`
    )
    expect(reauthenticationMigrationSql).not.toContain(
      'CREATE INDEX "Phase7ReauthenticationIntent_oldSessionId_state_idx"'
    )
    expect(reauthenticationTopLevelSql).not.toMatch(
      /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+"(?:User|Account|Session)"/iu
    )
  })

  it('Slice 4F는 verifier 한 개만 owner role에서 교체하고 hardened path를 복구한다', () => {
    const executableSql = archiveVerifierMigrationSql.replace(
      /^\s*--.*$/gmu,
      ''
    )
    const ownerRoleIndex = executableSql.indexOf(
      'SET LOCAL ROLE "nihongo_phase7_owner";'
    )
    const replaceIndex = executableSql.indexOf(
      'CREATE OR REPLACE FUNCTION "phase7_verify_operation_manifest"(operation_id UUID)'
    )
    const hardenedPathIndex = executableSql.indexOf(
      'ALTER FUNCTION %I.phase7_verify_operation_manifest(UUID) SET search_path TO pg_catalog, %I, pg_temp'
    )
    const migrationRoleIndex = executableSql.indexOf(
      'SET LOCAL ROLE "nihongo_phase7_migration";'
    )

    expect(
      executableSql.match(/\bCREATE\s+OR\s+REPLACE\s+FUNCTION\b/giu)
    ).toHaveLength(1)
    expect(executableSql).toContain('SECURITY DEFINER')
    expect(executableSql).toContain('SET search_path FROM CURRENT')
    expect(executableSql).toContain(
      'Phase 7 operation manifest verifier catalog is not exact.'
    )
    expect(executableSql).toContain(
      `procedure_record.proargtypes = '2950'::pg_catalog.oidvector`
    )
    expect(executableSql).toContain(
      `'search_path=pg_catalog, ' || target_schema || ', pg_temp'`
    )
    expect(ownerRoleIndex).toBeGreaterThan(-1)
    expect(replaceIndex).toBeGreaterThan(ownerRoleIndex)
    expect(hardenedPathIndex).toBeGreaterThan(replaceIndex)
    expect(migrationRoleIndex).toBeGreaterThan(hardenedPathIndex)
    expect(executableSql).not.toMatch(/\bRESET\s+ROLE\b/iu)
    expect(archiveVerifierTopLevelSql).not.toMatch(
      /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|TYPE|INDEX|SCHEMA)\b/iu
    )
    expect(archiveVerifierTopLevelSql).not.toMatch(
      /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\b/iu
    )
    expect(archiveVerifierTopLevelSql).not.toMatch(
      /\b(?:GRANT|REVOKE|ALTER\s+FUNCTION[^;]+OWNER)\b/iu
    )
    expect(executableSql).toContain(`WHEN 'PUBLICATION', 'RETIREMENT' THEN`)
    expect(executableSql).toContain(`WHEN 'QUESTION_ARCHIVE' THEN`)
    expect(executableSql).toContain(
      'WHEN cardinality(manifest_version_ids) = 0 THEN empty_ids'
    )
    expect(executableSql).not.toContain(
      `WHEN 'PUBLICATION', 'RETIREMENT', 'QUESTION_ARCHIVE' THEN`
    )
  })

  it('Slice 4F는 QUESTION_ARCHIVE predicate 외 기존 verifier 본문을 byte-equivalent하게 보존한다', () => {
    const foundationVerifier = extractOperationManifestVerifier(
      foundationMigrationSql,
      'CREATE FUNCTION'
    )
    const archiveVerifier = extractOperationManifestVerifier(
      archiveVerifierMigrationSql,
      'CREATE OR REPLACE FUNCTION'
    )
    const oldAggregateBranch = `    WHEN 'PUBLICATION', 'RETIREMENT', 'QUESTION_ARCHIVE' THEN
      IF question_delta_ids <> manifest_question_ids
        OR version_delta_ids <> manifest_version_ids
        OR version_delta_question_ids <> manifest_question_ids THEN
        RAISE EXCEPTION 'Aggregate lifecycle target set is not exact.'
          USING ERRCODE = '23514';
      END IF;`
    const splitArchiveBranch = `    WHEN 'PUBLICATION', 'RETIREMENT' THEN
      IF question_delta_ids <> manifest_question_ids
        OR version_delta_ids <> manifest_version_ids
        OR version_delta_question_ids <> manifest_question_ids THEN
        RAISE EXCEPTION 'Aggregate lifecycle target set is not exact.'
          USING ERRCODE = '23514';
      END IF;
    WHEN 'QUESTION_ARCHIVE' THEN
      IF question_delta_ids <> manifest_question_ids
        OR version_delta_ids <> manifest_version_ids
        OR version_delta_question_ids <> (CASE
          WHEN cardinality(manifest_version_ids) = 0 THEN empty_ids
          ELSE manifest_question_ids
        END) THEN
        RAISE EXCEPTION 'Aggregate lifecycle target set is not exact.'
          USING ERRCODE = '23514';
      END IF;`

    expect(archiveVerifier).toContain(splitArchiveBranch)
    expect(
      archiveVerifier
        .replace('CREATE OR REPLACE FUNCTION', 'CREATE FUNCTION')
        .replace(splitArchiveBranch, oldAggregateBranch)
    ).toBe(foundationVerifier)
  })

  it('두 schema-shape identity를 normalizer 전에 TEXT로 고정한다', () => {
    expect(enumMigrationSql).toMatch(
      /catalog_rows\(kind, identity, definition\) AS \(\s*SELECT 'EXT'::TEXT,\s*extension\.extname::TEXT,/u
    )
    expect(foundationMigrationSql).toMatch(
      /catalog_rows\(kind, identity, definition\) AS \(\s*SELECT 'EXT'::TEXT,\s*extension\.extname::TEXT,/u
    )
  })

  it('column shape는 이름과 dropped-hole 제외 논리 순서로 식별한다', () => {
    for (const migrationSql of [enumMigrationSql, foundationMigrationSql]) {
      expect(migrationSql).toContain(
        `SELECT 'COL', relation.relname || '.' || attribute.attname`
      )
      expect(migrationSql).toContain(`AND NOT logical_attribute.attisdropped`)
      expect(migrationSql).not.toContain(
        `relation.relname || '.' || attribute.attnum::TEXT`
      )
    }
  })

  it('enum schema-shape normalizer가 search_path와 exact schema token을 정규화한다', () => {
    expect(enumMigrationSql).toContain(
      `'SET search_path TO pg_catalog, ' || quote_ident(target_schema) ||`
    )
    expect(enumMigrationSql).toContain(
      `'SET search_path TO ''pg_catalog'', ' || quote_literal(target_schema) ||`
    )
    expect(enumMigrationSql).toContain(
      `'search_path=pg_catalog, ' || target_schema || ', pg_temp'`
    )
    expect(enumMigrationSql).toContain(
      `'search_path=' || target_schema || ', pg_catalog, pg_temp'`
    )
    expect(enumMigrationSql).toContain(
      `replace(normalized, target_schema::TEXT, '$SCHEMA')`
    )
  })

  it('두 번 재현한 schema-shape golden만 사용하고 capture 우회를 남기지 않는다', () => {
    const migrationSql = `${enumMigrationSql}\n${foundationMigrationSql}`

    expect(enumMigrationSql).toContain(
      'ed940b179d87a48e3e1591b50c799855783a32a6b173ce00d6cfad5396579f23'
    )
    expect(foundationMigrationSql).toContain(
      'ca2e172236d60d253c7d39c64538e96010260a591043662bd3337405054e043a'
    )
    expect(foundationMigrationSql).toContain(
      '09a071d20545f6868cb9838631180ee98e62c91cff3a42a683c55b0563686b91'
    )
    expect(migrationSql).not.toMatch(/PLACEHOLDER|CAPTURE_PHASE/u)
  })

  it('첫 migration은 안전 preflight 뒤 세 QuestionVersionStatus 값만 추가한다', () => {
    const executableSql = enumMigrationSql.replace(/^--.*$/gmu, '')
    const enumAdds = Array.from(
      executableSql.matchAll(
        /\bALTER\s+TYPE\s+"([^"]+)"\s+ADD\s+VALUE\s+'([^']+)'\s+AFTER\s+'([^']+)'\s*;/giu
      ),
      (match) => match.slice(1)
    )

    expect(enumAdds).toEqual([
      ['QuestionVersionStatus', 'IN_REVIEW', 'DRAFT'],
      ['QuestionVersionStatus', 'CHANGES_REQUESTED', 'IN_REVIEW'],
      ['QuestionVersionStatus', 'APPROVED', 'CHANGES_REQUESTED']
    ])
    expect(executableSql.match(/\bALTER\s+TYPE\b/giu)).toHaveLength(3)
    expect(executableSql).not.toMatch(/\b(?:CREATE|DROP)\s+TYPE\b/iu)
    expect(executableSql).not.toMatch(
      /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+pg_catalog\.(?:pg_enum|pg_type)\b/iu
    )
    expect(executableSql).toContain('DO $phase7_enum_preflight$')
    expect(executableSql).toMatch(
      /current_database\(\)\s*!~\s*'\(_test\|_dev\)\$'/u
    )
    expect(executableSql).toMatch(/owner_role\.rolname\s*=\s*CURRENT_USER/u)
    expect(executableSql).toContain(
      "ARRAY['DRAFT','PUBLISHED','RETIRED']::TEXT[]"
    )
    expect(executableSql.trim()).toMatch(/^BEGIN;[\s\S]*COMMIT;$/u)
  })

  it('두 번째 migration만 Phase 7 dependent foundation을 소유한다', () => {
    for (const fragment of [
      'CREATE TYPE "RetirementKind" AS ENUM',
      'CREATE TYPE "AccountActorLabel" AS ENUM',
      'CREATE TYPE "EvidenceActorKind" AS ENUM',
      'CREATE TYPE "EvidenceActorRole" AS ENUM',
      'CREATE TYPE "SystemActorLabel" AS ENUM',
      'CREATE TYPE "ContentReviewAction" AS ENUM',
      'CREATE TYPE "AdminAuditCommand" AS ENUM',
      'CREATE TYPE "AdminAuditTargetType" AS ENUM',
      'CREATE TYPE "AdminAuditEnvironment" AS ENUM',
      'CREATE TYPE "QuestionReportReason" AS ENUM',
      'CREATE TYPE "QuestionReportStatus" AS ENUM',
      'CREATE TYPE "QuestionReportResolutionOutcome" AS ENUM',
      'CREATE TYPE "AuthSessionFamilyStatus" AS ENUM',
      'CREATE TYPE "AuthSessionIssuerProtocolVersion" AS ENUM',
      'CREATE TYPE "AuthVerificationPurpose" AS ENUM',
      'CREATE TABLE "AuthIssuerActivation"',
      'CREATE TABLE "AuthSessionFamily"',
      'CREATE TABLE "AuthSessionRotationFence"',
      'CREATE TABLE "TagApplicability"',
      'CREATE TABLE "ContentReview"',
      'CREATE TABLE "AdminAuditLog"',
      'CREATE TABLE "QuestionReport"',
      'CREATE TABLE "Phase7OperationIntent"',
      'CREATE TABLE "Phase7OperationDelta"',
      'CREATE TABLE "Phase7TrustedExecution"',
      'CREATE TABLE "Phase7DatabaseCapability"',
      'ADD COLUMN "authorityGeneration"',
      'ADD COLUMN "sessionFamilyId"',
      'ADD COLUMN "rowVersion"',
      'ADD COLUMN "contentFingerprint"',
      'ADD COLUMN "normalizedNameSnapshot"',
      'CREATE FUNCTION "phase7_normalize_option_comparison"',
      'CREATE FUNCTION "phase7_question_version_fingerprint"',
      'CREATE FUNCTION "validate_phase7_question_aggregate"',
      'CREATE FUNCTION "validate_phase7_question_version_content"',
      'CREATE FUNCTION "validate_phase7_system_seed_catalog"',
      'CREATE FUNCTION "phase7_begin_admin_operation"',
      'CREATE FUNCTION "phase7_finish_admin_operation"',
      'CREATE FUNCTION "phase7_admin_audit_content_digest"',
      'CREATE FUNCTION "phase7_create_question_report"',
      'CREATE FUNCTION "phase7_register_database_capability"',
      'CREATE FUNCTION "phase7_request_password_reset"',
      'CREATE FUNCTION "phase7_consume_password_reset"',
      'CREATE FUNCTION "phase7_issue_v1_session"',
      'CREATE FUNCTION "phase7_confirm_v1_session_issuance"',
      'CREATE FUNCTION "phase7_reauthenticate_v1_session"',
      'CREATE FUNCTION "phase7_owned_sign_out"',
      'CREATE FUNCTION "phase7_cleanup_expired_auth_state"',
      'CREATE FUNCTION "phase7_erase_user"',
      'CREATE CONSTRAINT TRIGGER "Question_deferred_aggregate"',
      'CREATE CONSTRAINT TRIGGER "QuestionVersion_deferred_full_content"',
      'CREATE CONSTRAINT TRIGGER "Question_deferred_system_seed_catalog"',
      'CREATE CONSTRAINT TRIGGER "Phase7OperationIntent_must_finish"',
      'CREATE CONSTRAINT TRIGGER "QuestionReport_deferred_remediation"',
      'CREATE CONSTRAINT TRIGGER "User_deferred_credential_totality"',
      'GRANT EXECUTE ON FUNCTION "phase7_cleanup_expired_auth_state"'
    ]) {
      expect(foundationMigrationSql).toContain(fragment)
      expect(enumMigrationSql).not.toContain(fragment)
    }

    expect(foundationMigrationSql).not.toContain(
      'ALTER TYPE "QuestionVersionStatus" ADD VALUE'
    )
    expect(enumMigrationSql).toContain('$phase7_external_provisioning$')
    expect(enumMigrationSql).toContain("'nihongo_auth_gateway'")
    expect(enumMigrationSql).toContain("'nihongo_erasure_worker'")
    expect(enumMigrationSql).not.toMatch(/\bCREATE\s+ROLE\b/iu)
    expect(enumMigrationSql).not.toMatch(/\bCREATE\s+EXTENSION\b/iu)
    expect(enumMigrationSql).not.toMatch(/\bRESET\s+ROLE\b/iu)
    expect(foundationTopLevelSql).not.toMatch(
      /\b(?:DROP\s+TABLE|TRUNCATE|DELETE\s+FROM)\b/iu
    )
    const deletionOwners = Array.from(
      foundationMigrationSql.matchAll(
        /CREATE (?:OR REPLACE )?FUNCTION "([^"]+)"[\s\S]*?\bAS \$function\$([\s\S]*?)\$function\$;/gu
      )
    ).flatMap((functionMatch) =>
      Array.from(
        functionMatch[2]?.matchAll(/\bDELETE\s+FROM\s+"([^"]+)"/gu) ?? [],
        (deletionMatch) => `${functionMatch[1]} -> ${deletionMatch[1]}`
      )
    )
    expect(deletionOwners.toSorted()).toEqual(
      [
        'anonymize_question_creator_on_user_delete -> AuthSessionFamily',
        'anonymize_question_creator_on_user_delete -> AuthSessionRotationFence',
        'anonymize_question_creator_on_user_delete -> Session',
        'anonymize_question_creator_on_user_delete -> Verification',
        'phase7_activate_v1_issuer -> Session',
        'phase7_activate_v1_issuer -> Verification',
        'phase7_cleanup_expired_auth_state -> AuthSessionFamily',
        'phase7_cleanup_expired_auth_state -> AuthSessionRotationFence',
        'phase7_cleanup_expired_auth_state -> Session',
        'phase7_close_trusted_execution -> Phase7TrustedExecution',
        'phase7_consume_password_reset -> Verification',
        'phase7_erase_user -> User',
        'phase7_finish_admin_operation -> Phase7OperationIntent',
        'phase7_request_password_reset -> Verification',
        'phase7_owned_sign_out -> Session',
        'phase7_reauthenticate_v1_session -> Session',
        'protect_phase7_account -> Session',
        'validate_phase7_user_change -> Session'
      ].toSorted()
    )
    expect(foundationMigrationSql).toMatch(
      /SET CONSTRAINTS[\s\S]*?"Question_deferred_aggregate"[\s\S]*?IMMEDIATE;/u
    )
    expect(foundationMigrationSql.trim()).toMatch(/COMMIT;$/u)
  })

  it('password-reset request는 identity 비노출 atomic routine과 exact ACL로 고정한다', () => {
    const routine = foundationMigrationSql.match(
      /CREATE FUNCTION "phase7_request_password_reset"\([\s\S]*?AS \$function\$([\s\S]*?)\$function\$;/u
    )?.[1]

    expect(routine).toBeDefined()
    expect(routine).toContain(
      'PERFORM "phase7_require_caller_role"(\'nihongo_auth_gateway\')'
    )
    expect(routine).toMatch(
      /WHERE target_user\."id" = target_user_id[\s\S]*?FOR UPDATE;[\s\S]*?IF captured_generation IS NULL THEN RETURN false; END IF;/u
    )
    expect(routine).toContain('IF target_user_id IS NULL')
    expect(routine).toContain('"tokenSelector" = selector_value')
    expect(routine).toMatch(
      /FROM "Account"[\s\S]*?"accountId" = target_user_id::TEXT[\s\S]*?FOR UPDATE;[\s\S]*?IF NOT FOUND THEN RETURN false; END IF;/u
    )
    expect(routine).toContain('DELETE FROM "Verification"')
    expect(routine).toContain('INSERT INTO "Verification"')
    expect(foundationMigrationSql).toContain(
      'ALTER FUNCTION "phase7_request_password_reset"(TEXT, UUID, TEXT)\n  OWNER TO "nihongo_phase7_owner"'
    )
    expect(foundationMigrationSql).toContain(
      'GRANT EXECUTE ON FUNCTION "phase7_change_password_v1"(TEXT, TEXT, TEXT),\n  "phase7_request_password_reset"(TEXT, UUID, TEXT)'
    )
    expect(foundationMigrationSql).not.toContain('phase7_issue_password_reset')
  })

  it('issuer post-gate가 exact proof와 User→Family→Session lock order를 고정한다', () => {
    const functionBody = foundationMigrationSql.match(
      /CREATE FUNCTION "phase7_confirm_v1_session_issuance"\([\s\S]*?AS \$function\$([\s\S]*?)\$function\$;/u
    )?.[1]

    expect(functionBody).toBeDefined()
    expect(functionBody).toContain(
      `PERFORM "phase7_require_caller_role"('nihongo_auth_gateway')`
    )
    expect(functionBody).toContain(
      'session."id" = expected_session_id\n    AND session."userId" = expected_user_id\n    AND session."token" = raw_token'
    )
    const userLock = functionBody?.indexOf(
      'PERFORM 1 FROM "User" AS target_user'
    )
    const familyLock = functionBody?.indexOf(
      'PERFORM 1 FROM "AuthSessionFamily" AS family'
    )
    const sessionLock = functionBody?.indexOf(
      'PERFORM 1 FROM "Session" AS session',
      (familyLock ?? -1) + 1
    )

    expect(userLock).toBeGreaterThanOrEqual(0)
    expect(familyLock).toBeGreaterThan(userLock ?? Number.MAX_SAFE_INTEGER)
    expect(sessionLock).toBeGreaterThan(familyLock ?? Number.MAX_SAFE_INTEGER)
    expect(functionBody?.slice(userLock, familyLock)).toContain('FOR UPDATE')
    expect(functionBody?.slice(familyLock, sessionLock)).toContain('FOR UPDATE')
    expect(functionBody?.slice(sessionLock)).toContain('FOR UPDATE')
  })
  it('Batch7 installer keeps canonical36 and current37 as distinct exact completed prefixes', () => {
    const sql = readFileSync(
      `${migrationsDirectory}/20261009120000_phase7_approved_n4_reading_batch7_tags/migration.sql`,
      'utf8'
    )
    const predecessor = sql
      .split('DO $predecessor$')[1]
      ?.split('$predecessor$;')[0]
    expect(predecessor).toBeDefined()
    expect(predecessor).toContain('IF predecessor_count = 36 THEN')
    expect(predecessor).toContain('ELSIF predecessor_count = 37 THEN')
    expect(predecessor).toContain(
      '96eebebc8d76d1eb858b1cc12d7559685a5e06559a57ff8d9aabdf3b067e3ab3'
    )
    expect(predecessor).toContain(
      '89158202b48454a0d179913983fe1449dc139c0db25aec0ba4c5480040291aad'
    )
    expect(predecessor).toContain(
      '"migration_name" = \'20261005183000_phase7_reviewed_catalog_current\''
    )
    expect(predecessor).toContain(
      'c04b27c1ee7610c8648da58a05596c2d9573a48cfad20c1a1b8b9f818dc3554d'
    )
    for (const guard of [
      '"finished_at" IS NULL',
      '"rolled_back_at" IS NOT NULL',
      `COALESCE(btrim("logs"), '') <> ''`,
      '"applied_steps_count" <> 1',
      `"checksum" !~ '^[0-9a-f]{64}$'`
    ])
      expect(predecessor).toContain(guard)
    const legacy = predecessor
      ?.split('IF predecessor_count = 36 THEN')[1]
      ?.split('ELSIF predecessor_count = 37 THEN')[0]
    expect(legacy).toContain('(SELECT COUNT(*) FROM "Tag") <> 128')
    expect(legacy).toContain('(SELECT COUNT(*) FROM "TagApplicability") <> 151')
    expect(legacy).toContain(
      '(SELECT COUNT(*) FROM "Phase7ApprovedN4N2ReadingTagRegistration") <> 1'
    )
    const current = predecessor
      ?.split('ELSIF predecessor_count = 37 THEN')[1]
      ?.split('\n  ELSE')[0]
    for (const [table, count] of [
      ['Question', 65],
      ['QuestionVersion', 65],
      ['QuestionOption', 260],
      ['QuestionVersionTag', 130],
      ['Tag', 107],
      ['TagApplicability', 126]
    ]) {
      expect(current).toContain(`(SELECT COUNT(*) FROM "${table}") <> ${count}`)
    }
    for (const table of [
      'ContentReview',
      'AdminAuditLog',
      'QuestionReport',
      'Phase7OperationIntent',
      'Phase7ApprovedReadingTagRegistration',
      'Phase7ApprovedN3ReadingTagRegistration',
      'Phase7ApprovedN4N2ReadingTagRegistration'
    ]) {
      expect(current).toContain(`OR EXISTS (SELECT 1 FROM "${table}")`)
    }
    expect(current).not.toContain('WHERE NOT EXISTS')
    expect(current).not.toContain('"normalizedName" NOT IN')
    // Installation must never mutate data or ledger, or grant caller settings authority.
    expect(predecessor).not.toMatch(
      /\b(?:INSERT INTO|UPDATE|DELETE FROM|GRANT)\b/u
    )
    expect(predecessor).not.toContain('current_setting')
  })

  it('Batch7 current seed uses the existing reviewed projections and all three current pins', () => {
    const sql = readFileSync(
      `${migrationsDirectory}/20261009120000_phase7_approved_n4_reading_batch7_tags/migration.sql`,
      'utf8'
    )
    const current = sql
      .split('ELSIF predecessor_count = 37 THEN')[1]
      ?.split('$predecessor$;')[0]
    const foundation = foundationMigrationSql.split(
      'CREATE FUNCTION "validate_phase7_system_seed_catalog"()'
    )[1]
    const projection = (body: string | undefined) => {
      if (!body) throw new Error('Seed projection body is missing.')
      const start = body.indexOf(
        'SELECT encode(public.digest(convert_to(string_agg('
      )
      const end = body.indexOf('INTO semantic_digest;', start)
      if (start < 0 || end < 0)
        throw new Error('Seed projection boundaries are missing.')
      return body
        .slice(start, end + 'INTO semantic_digest;'.length)
        .split('\n')
        .map((line) => line.trim())
        .join('\n')
    }
    expect(projection(current)).toBe(projection(foundation))
    for (const pin of [
      '0e4f6c477108c053a924aa1ba0f3cba8e868853328b8626839f95939bb19c798',
      '81e1accc76657951962be7d3d21fdd976ea67d78c98ddb87abe6f9823edbc6ef',
      '4f8f2c077bc5e79a4755f007f96cd4b8e57bdd6b14f0f906faefaab79eff2fa9'
    ])
      expect(current).toContain(pin)
    expect(current?.match(/IS DISTINCT FROM '[0-9a-f]{64}'/gu)).toHaveLength(4)
    for (const guard of [
      'question."currentPublishedVersionId"',
      '"rowVersion" <> 1',
      `"createdByLabelSnapshot" <> 'SYSTEM_SEED'`,
      '"createdByUserId" IS NOT NULL',
      `"createdAt" <> '2026-01-01T00:00:00Z'::timestamptz`,
      `"updatedAt" <> '2026-01-01T00:00:00Z'::timestamptz`,
      'version."versionNumber" <> 1',
      `version."status" <> 'PUBLISHED'`,
      '"phase7_question_version_fingerprint"(version."id")'
    ])
      expect(current).toContain(guard)
  })

  it('Batch7 binds profile and actual full rows in its function constants, never caller parameters', () => {
    const sql = readFileSync(
      `${migrationsDirectory}/20261009120000_phase7_approved_n4_reading_batch7_tags/migration.sql`,
      'utf8'
    )
    const harden = sql.split('DO $harden$')[1]
    expect(harden).toContain("installation_profile := 'LEGACY_CANONICAL36'")
    expect(harden).toContain("installation_profile := 'CURRENT_PHYSICAL37'")
    for (const table of [
      'Tag',
      'TagApplicability',
      'Phase7ApprovedN4N2ReadingTagRegistration',
      'Question',
      'QuestionVersion',
      'QuestionOption',
      'QuestionVersionTag'
    ]) {
      expect(harden).toContain(`FROM "${table}"`)
    }
    expect(harden).toContain('to_jsonb(')
    expect(harden).toContain('predecessor_state::TEXT')
    expect(harden).toContain(
      "pg_catalog.quote_literal('JLP478_BATCH7_PREDECESSOR_DIGEST_UNSET')"
    )
    expect(harden).toContain(
      "pg_catalog.quote_literal('JLP483_BATCH7_PROFILE_UNSET')"
    )
    expect(harden).toContain('pg_catalog.quote_literal(predecessor_digest)')
    expect(harden).toContain('pg_catalog.quote_literal(installation_profile)')
    expect(sql).toContain(
      "sealed_installation_profile CONSTANT TEXT := 'JLP483_BATCH7_PROFILE_UNSET';"
    )
    expect(sql).toContain(
      "IF sealed_installation_profile = 'CURRENT_PHYSICAL37' THEN"
    )
    expect(sql).toContain(
      'Batch7 historical registration is unavailable on the current catalog.'
    )
    expect(sql).not.toContain("current_setting('app.phase7_batch7_")
    const registration = sql
      .split(
        'CREATE FUNCTION "register_phase7_approved_n4_reading_batch7_tag_rows"()'
      )[1]
      ?.split('$function$;')[0]
    for (const preserved of [
      'unchanged staged128/151',
      'completed canonical37 ledger',
      'Batch7 sealed predecessor rows drifted.',
      '(SELECT COUNT(*) FROM "Tag") <> 143',
      '(SELECT COUNT(*) FROM "TagApplicability") <> 166'
    ]) {
      expect(registration).toContain(preserved)
    }
  })
})

describe('migration-owned approved registration representation', () => {
  const schema = readFileSync(
    new URL('../../prisma/schema.prisma', import.meta.url),
    'utf8'
  )
  const registrations = [
    [
      '20261007060000_phase7_approved_reading_tags',
      'Phase7ApprovedReadingTagRegistration'
    ],
    [
      '20261009060000_phase7_approved_n3_reading_tags',
      'Phase7ApprovedN3ReadingTagRegistration'
    ],
    [
      '20261009072500_phase7_approved_n4_n2_reading_tags',
      'Phase7ApprovedN4N2ReadingTagRegistration'
    ],
    [
      '20261009120000_phase7_approved_n4_reading_batch7_tags',
      'Phase7ApprovedN4ReadingBatch7TagRegistration'
    ],
    [
      '20261010071000_phase7_approved308_tags',
      'Phase7Approved308TagRegistration'
    ]
  ] as const

  for (const [migration, model] of registrations) {
    it(`${model} matches its SQL table without exposing a Prisma delegate`, () => {
      const sql = readFileSync(
        `${migrationsDirectory}/${migration}/migration.sql`,
        'utf8'
      )
      const table = sql.match(
        new RegExp(String.raw`CREATE TABLE "${model}" \(([^;]+)\n\);`, 'u')
      )?.[1]
      expect(table).toBeDefined()
      const columns = table
        ?.trim()
        .split('\n')
        .map((line) => line.trim())
      expect(columns).toHaveLength(2)
      expect(columns?.[0]).toMatch(
        /^"batch" TEXT PRIMARY KEY CHECK \("batch" = '[a-z0-9-]+'\),$/u
      )
      expect(columns?.[1]).toBe(
        '"appliedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP'
      )
      const representation = schema.match(
        new RegExp(String.raw`model ${model} \{([^}]+)\}`, 'u')
      )?.[1]
      expect(representation?.replace(/\s+/gu, ' ').trim()).toBe(
        'batch String @id appliedAt DateTime @default(now()) @db.Timestamptz(6) @@ignore'
      )
    })
  }
})
