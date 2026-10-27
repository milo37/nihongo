import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const sql = readFileSync(
  new URL(
    '../../prisma/migrations/20261020230000_sso_account_lifecycle/migration.sql',
    import.meta.url
  ),
  'utf8'
)
const body = (name: string) => {
  const start = sql.indexOf(`CREATE FUNCTION "${name}"(`)
  expect(start).toBeGreaterThan(-1)
  return sql.slice(start, sql.indexOf('$function$;', start) + 11)
}
const migrationBody = (source: string, declaration: string) => {
  const start = source.indexOf(declaration)
  expect(start).toBeGreaterThan(-1)
  return source.slice(start, source.indexOf('$function$;', start) + 11)
}
describe('SSO account lifecycle migration source contract (no DB)', () => {
  it('keeps forward-only canonical deployment and no runtime table grants', () => {
    expect(sql).toContain("CURRENT_USER <> 'nihongo_phase7_migration'")
    expect(sql).toContain("r.rolname = 'nihongo_phase7_owner'")
    expect(sql).toContain('SET search_path TO pg_catalog, %I, pg_temp')
    expect(sql).not.toMatch(
      /GRANT\s+(?:ALL|SELECT|INSERT|UPDATE|DELETE).*ON TABLE/u
    )
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION')
    expect(sql).not.toMatch(
      /ALTER TABLE "(?:User|Account|Session|AuthSessionFamily)"/u
    )
  })
  it('proofs cascade with User while erasure receipt survives without User identity', () => {
    expect(
      (sql.match(/ON DELETE CASCADE ON UPDATE CASCADE/gu) ?? []).length
    ).toBe(2)
    expect(sql).toContain(
      '"userId" UUID UNIQUE REFERENCES "User"("id") ON DELETE SET NULL'
    )
    expect(sql).not.toContain('"accessToken"')
    expect(sql).not.toContain('"refreshToken"')
  })
  it('same session, family, role and generation bind fresh/link contexts', () => {
    const b = body('phase7_sso_account_context_valid')
    for (const marker of [
      's."id"=(context_value->>\'sessionId\')::UUID',
      'u."role"::TEXT=context_value->>\'role\'',
      'u."authorityGeneration"=(context_value->>\'authorityGeneration\')::INTEGER',
      'f."status"=\'ACTIVE\'',
      's."token"=raw_token',
      'phase7_sso_account_proof_valid'
    ])
      expect(b).toContain(marker)
  })
  it('LINK uses LOGIN provider/sub lock order, never email or role promotion', () => {
    const b = body('phase7_complete_sso_account_link')
    expect(b.indexOf('pg_advisory_xact_lock')).toBeLessThan(
      b.indexOf('FROM "User"')
    )
    expect(b).toContain("'nihongo:sso:'")
    expect(b).toContain('IF existing_user IS NOT NULL')
    expect(b).toContain('INSERT INTO "Account"')
    expect(b).not.toContain('INSERT INTO "User"')
    expect(b).not.toContain('UPDATE "User"')
    expect(b).not.toContain('email')
    expect(b).toContain('p."context"->>\'freshProofDigest\'')
  })
  it('unlink serializes last-provider check and invalidates all own authority', () => {
    const b = body('phase7_unlink_sso_account')
    expect(b.indexOf('FROM "User"')).toBeLessThan(b.indexOf('FROM "Account"'))
    expect(b.indexOf('SSO_LAST_SIGN_IN_METHOD')).toBeLessThan(
      b.indexOf('DELETE FROM "Account"')
    )
    expect(b).toContain(
      '"providerId"<>provider_value AND "providerId"=ANY(available_providers)'
    )
    for (const marker of [
      '"authorityGeneration"="authorityGeneration"+1',
      'UPDATE "AuthSessionFamily" SET "status"=\'REVOKED\' WHERE "userId"=actor',
      'DELETE FROM "Session" WHERE "userId"=actor',
      'SSO_FRESH_REQUIRED'
    ])
      expect(b).toContain(marker)
    expect(b).not.toMatch(
      /(?:DELETE FROM|UPDATE) "(?:Study|WrongNote|Bookmark)/u
    )
  })
  it('delete admission requires fresh proof before pending/revocation and preserves physical worker boundary', () => {
    const b = body('phase7_request_sso_account_erasure')
    expect(b.indexOf('phase7_sso_account_proof_valid')).toBeLessThan(
      b.indexOf('INSERT INTO "SsoAccountErasureRequest"')
    )
    expect(b).toContain("'SSO_ACCOUNT_DELETION_BLOCKED'")
    expect(b).toContain('"accountStatus"=\'DELETION_PENDING\'')
    expect(b).not.toContain('DELETE FROM "User"')
  })
  it('physical worker alone calls existing erasure and external cleanup stays separate', () => {
    const b = body('phase7_complete_sso_account_erasure')
    expect(b).toContain(
      "phase7_require_caller_role\"('nihongo_erasure_worker')"
    )
    expect(b).toContain('"phase7_erase_user"(r."userId",environment_value)')
    expect(body('phase7_request_sso_account_erasure')).not.toContain(
      'phase7_erase_user'
    )
    expect(body('phase7_record_sso_provider_cleanup')).not.toContain(
      'phase7_erase_user'
    )
    expect(body('phase7_request_sso_account_erasure')).toContain(
      "'status','PENDING'"
    )
    expect(b).not.toContain('providerCleanup')
  })
  it('forward queue is worker-only, environment-bound and omits user identity', () => {
    const queue = readFileSync(
      new URL(
        '../../prisma/migrations/20261028090000_sso_account_erasure_worker_queue/migration.sql',
        import.meta.url
      ),
      'utf8'
    )
    expect(queue).toContain("CURRENT_USER <> 'nihongo_phase7_migration'")
    expect(queue).toContain(
      "phase7_require_caller_role\"('nihongo_erasure_worker')"
    )
    expect(queue).toContain(
      'GRANT EXECUTE ON FUNCTION "phase7_list_sso_account_erasures"(INTEGER,"AdminAuditEnvironment") TO "nihongo_erasure_worker";'
    )
    expect(queue).toContain(
      `ALTER TYPE "AdminAuditEnvironment" ADD VALUE IF NOT EXISTS 'PRODUCTION'`
    )
    const list = migrationBody(
      queue,
      'CREATE FUNCTION "phase7_list_sso_account_erasures"('
    )
    expect(list).toContain(
      'phase7_require_database_capability"(environment_value)'
    )
    expect(list).not.toMatch(/'userId'|"receiptDigest"/u)
    expect(queue).not.toMatch(/GRANT\s+(?:ALL|SELECT|INSERT|UPDATE|DELETE)/u)
    expect(queue).not.toContain('ALTER TABLE')
  })
  it('forward completion refuses provider-incomplete erasure and hardens cleanup recording', () => {
    const queue = readFileSync(
      new URL(
        '../../prisma/migrations/20261028090000_sso_account_erasure_worker_queue/migration.sql',
        import.meta.url
      ),
      'utf8'
    )
    const completion = migrationBody(
      queue,
      'CREATE OR REPLACE FUNCTION "phase7_complete_sso_account_erasure"('
    )
    expect(completion).toContain('jsonb_array_length(r."providerCleanup")=0')
    expect(completion).toContain("x->>'status' IS DISTINCT FROM 'COMPLETED'")
    expect(completion.indexOf('providerCleanup')).toBeLessThan(
      completion.indexOf('phase7_erase_user')
    )
    const recorder = migrationBody(
      queue,
      'CREATE FUNCTION "phase7_record_sso_provider_cleanup"('
    )
    expect(recorder).toContain(
      'phase7_require_database_capability"(environment_value)'
    )
    expect(recorder).toContain(
      'r."appStatus" IS DISTINCT FROM \'DELETION_PENDING\''
    )
    expect(recorder).toContain(
      "IF current_status='COMPLETED' THEN RETURN status_value='COMPLETED'"
    )
    expect(recorder).toContain('FOR UPDATE')
    expect(queue).toContain(
      'REVOKE ALL ON FUNCTION "phase7_record_sso_provider_cleanup"(UUID,TEXT,TEXT)'
    )
  })
  it('lease migration fences direct erasure and claims provider cleanup with SKIP LOCKED', () => {
    const lease = readFileSync(
      new URL(
        '../../prisma/migrations/20261028120000_sso_account_erasure_claim_lease/migration.sql',
        import.meta.url
      ),
      'utf8'
    )
    expect(lease).toContain("CURRENT_USER <> 'nihongo_phase7_migration'")
    expect(lease).toContain('RENAME TO "phase7_erase_user_unchecked"')
    expect(lease).toMatch(
      /REVOKE ALL ON FUNCTION "phase7_erase_user_unchecked"\(UUID,"AdminAuditEnvironment"\)\s+FROM PUBLIC,"nihongo_app","nihongo_auth_gateway","nihongo_erasure_worker";/u
    )
    expect(lease).not.toMatch(/GRANT[^;]*phase7_erase_user_unchecked/u)
    const direct = migrationBody(lease, 'CREATE FUNCTION "phase7_erase_user"(')
    expect(direct).toContain("IF environment_value IS DISTINCT FROM 'TEST'")
    expect(direct.indexOf("'TEST'")).toBeLessThan(
      direct.indexOf('phase7_erase_user_unchecked')
    )
    const completion = migrationBody(
      lease,
      'CREATE OR REPLACE FUNCTION "phase7_complete_sso_account_erasure"('
    )
    expect(completion).toContain('"phase7_erase_user_unchecked"(r."userId"')
    expect(completion.indexOf('providerCleanup')).toBeLessThan(
      completion.indexOf('phase7_erase_user_unchecked')
    )
    const claim = migrationBody(
      lease,
      'CREATE FUNCTION "phase7_claim_sso_provider_cleanups"('
    )
    expect(claim).toContain(
      'phase7_require_database_capability"(environment_value)'
    )
    expect(claim).toContain('FOR UPDATE SKIP LOCKED')
    expect(claim).toContain('"leaseExpiresAt"<=clock_timestamp()')
    expect(claim).toContain('lease_seconds NOT BETWEEN 30 AND 3600')
    expect(claim).not.toMatch(/'userId'|"receiptDigest"|Token"/u)
    expect(lease).not.toMatch(/GRANT\s+(?:ALL|SELECT|INSERT|UPDATE|DELETE)/u)
  })
})
