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
})
