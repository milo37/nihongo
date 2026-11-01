import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migrationSql = readFileSync(
  fileURLToPath(
    new URL(
      '../../prisma/migrations/20260916120000_phase7_reauthentication_foundation/migration.sql',
      import.meta.url
    )
  ),
  'utf8'
)
const schema = readFileSync(
  fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url)),
  'utf8'
)

const extractFunction = (name: string): string => {
  const markerPattern = new RegExp(
    `CREATE(?: OR REPLACE)? FUNCTION "${name}"\\(`,
    'u'
  )
  const start = migrationSql.search(markerPattern)
  const endMarker = '\n$function$;'
  const end = migrationSql.indexOf(endMarker, start)
  if (start < 0 || end < 0) {
    throw new Error(`Missing Phase 7 reauthentication function: ${name}`)
  }
  return migrationSql.slice(start, end + endMarker.length)
}

describe('Phase 7 Slice 3R reauthentication migration', () => {
  it('Prisma drift model은 SQL UUID defaults와 full indexes를 exact 반영한다', () => {
    const modelStart = schema.indexOf('model Phase7ReauthenticationIntent {')
    const modelEnd = schema.indexOf('\n}', modelStart)
    const model = schema.slice(modelStart, modelEnd)

    expect(model).toContain(
      '@id @default(dbgenerated("public.gen_random_uuid()")) @db.Uuid'
    )
    expect(model).toContain(
      '@unique @default(dbgenerated("public.gen_random_uuid()")) @db.Uuid'
    )
    expect(model).toContain('@@index([state, expiresAt, id])')
    expect(model).toContain('@@index([userId, sessionFamilyId, state])')
    expect(model).toContain('oldFenceTokenDigest')
    expect(model).not.toContain('@@index([oldSessionId, state])')
    expect(migrationSql).toContain(
      'CREATE UNIQUE INDEX "Phase7ReauthenticationIntent_live_old_session_key"'
    )
    expect(migrationSql).toContain(`WHERE "state" IN ('PREPARED', 'STAGED')`)
  })

  it('pending Session은 모든 일반 authority resolver에서 비권위 상태다', () => {
    for (const functionName of [
      'phase7_resolve_v1_principal',
      'phase7_resolve_session_credential',
      'phase7_refresh_remembered_session',
      'phase7_refresh_current_remembered_session'
    ]) {
      expect(extractFunction(functionName)).toContain(
        `session."authorizationState" = 'ACTIVE'`
      )
    }
    const stage = extractFunction('phase7_stage_reauthentication_session')
    expect(stage).toContain(`'PHASE7_V1', 'PENDING_REAUTH'`)
    expect(stage).toContain(`intent."state" <> 'PREPARED'`)
    expect(stage).toContain(`old_session."issuerProtocolVersion" = 'PHASE7_V1'`)
    expect(stage).toContain(
      `old_session."authorityGeneration" =\n          intent."capturedAuthorityGeneration"`
    )
    expect(stage).toContain(
      `"phase7_reauthentication_token_digest"(old_session."token") =\n          intent."oldTokenDigest"`
    )
  })

  it('old direct rotation은 revoke되고 bounded role별 facade만 grant된다', () => {
    const oldRevoke = migrationSql.indexOf(
      'REVOKE ALL ON FUNCTION "phase7_reauthenticate_v1_session"('
    )
    const gatewayGrant = migrationSql.indexOf(
      'GRANT EXECUTE ON FUNCTION "phase7_prepare_reauthentication"('
    )
    const appGrant = migrationSql.indexOf(
      'GRANT EXECUTE ON FUNCTION "phase7_classify_admin_authority"(TEXT)'
    )

    expect(oldRevoke).toBeGreaterThan(-1)
    expect(gatewayGrant).toBeGreaterThan(oldRevoke)
    expect(appGrant).toBeGreaterThan(gatewayGrant)
    expect(migrationSql.slice(gatewayGrant, appGrant)).not.toContain(
      'phase7_reauthenticate_v1_session'
    )
    expect(migrationSql).toContain(
      'TO "nihongo_auth_gateway";\n\nGRANT EXECUTE ON FUNCTION "phase7_classify_admin_authority"(TEXT)'
    )
    expect(migrationSql).toContain(
      'TO "nihongo_app";\n\nDO $phase7_reauthentication_hardened_paths$'
    )
  })

  it('raw auth relations는 runtime ACL 0이고 SECURITY DEFINER path를 고정한다', () => {
    for (const relationName of [
      'Phase7ReauthenticationIntent',
      'Phase7AuthorityRevocationEvidence'
    ]) {
      expect(migrationSql).toContain(
        `REVOKE ALL ON TABLE "${relationName}"\n  FROM PUBLIC, "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";`
      )
    }
    expect(migrationSql).toContain(
      `'User', 'Account', 'Session', 'AuthSessionFamily',\n      'AuthSessionRotationFence',\n      'Phase7ReauthenticationIntent', 'Phase7AuthorityRevocationEvidence'`
    )
    expect(migrationSql).toContain(
      `'ALTER FUNCTION %s SET search_path TO pg_catalog, %I, pg_temp'`
    )
    expect(migrationSql).toContain(
      `RAISE EXCEPTION 'Runtime role retained raw auth table privilege.'`
    )
    expect(migrationSql).toContain('pg_catalog.aclexplode(')
    expect(migrationSql).toContain(
      `RAISE EXCEPTION 'Runtime role retained raw auth column privilege.'`
    )
  })

  it('pending Session은 모든 기존 write facade 앞의 ACTIVE wrapper에서 차단된다', () => {
    expect(extractFunction('phase7_active_authorization_session')).toContain(
      `session."authorizationState" = 'ACTIVE'`
    )
    for (const functionName of [
      'phase7_begin_admin_operation',
      'phase7_create_question_report',
      'phase7_change_password_v1',
      'phase7_confirm_v1_session_issuance',
      'phase7_change_user_authority'
    ]) {
      expect(extractFunction(functionName)).toContain(
        '"phase7_active_authorization_session"('
      )
      expect(migrationSql).toContain(`"${functionName}_pre_reauthentication"`)
    }
    expect(extractFunction('phase7_finish_admin_operation')).toContain(
      `session."authorizationState" = 'ACTIVE'`
    )
    expect(migrationSql).toContain(
      'phase7_finish_admin_operation_pre_reauthentication'
    )
  })

  it('finalizer는 exact CAS/evidence 후 마지막 DB-clock authority fence만 수행한다', () => {
    const finalizer = extractFunction('phase7_finalize_reauthentication')
    const activateIndex = finalizer.indexOf(
      `SET "authorizationState" = 'ACTIVE'`
    )
    const deleteIndex = finalizer.indexOf('DELETE FROM "Session" AS session')
    const fenceIndex = finalizer.indexOf(
      'INSERT INTO "AuthSessionRotationFence"'
    )
    const auditIndex = finalizer.indexOf('INSERT INTO "AdminAuditLog"')
    const finishIndex = finalizer.indexOf(
      'PERFORM "phase7_finish_admin_operation"'
    )
    const finalClockIndex = finalizer.indexOf(
      'final_checked_at := clock_timestamp()'
    )
    const returnIndex = finalizer.indexOf(
      'RETURN QUERY SELECT activated_session."id"'
    )

    expect(activateIndex).toBeGreaterThan(-1)
    expect(deleteIndex).toBeGreaterThan(activateIndex)
    expect(fenceIndex).toBeGreaterThan(deleteIndex)
    expect(auditIndex).toBeGreaterThan(fenceIndex)
    expect(finishIndex).toBeGreaterThan(auditIndex)
    expect(finalClockIndex).toBeGreaterThan(finishIndex)
    expect(returnIndex).toBeGreaterThan(finalClockIndex)
    const finalFence = finalizer.slice(finalClockIndex, returnIndex)
    expect(finalFence).toContain(`old_session."expiresAt" <= final_checked_at`)
    expect(finalFence).toContain(
      `old_session."createdAt" + INTERVAL '30 days' <= final_checked_at`
    )
    expect(finalFence).toContain(`session."authorizationState" = 'ACTIVE'`)
    expect(finalFence).toContain(
      `target_user."authorityGeneration" =\n          intent."capturedAuthorityGeneration"`
    )
    expect(finalFence).not.toMatch(
      /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|PERFORM)\b/iu
    )
  })

  it('cleanup은 finalizer와 같은 User→family→Session→intent lock order다', () => {
    const cleanup = extractFunction('phase7_cleanup_reauthentication')
    const userLock = cleanup.indexOf('PERFORM 1 FROM "User" AS target_user')
    const familyLock = cleanup.indexOf(
      'PERFORM 1 FROM "AuthSessionFamily" AS family'
    )
    const sessionLock = cleanup.indexOf('PERFORM 1 FROM "Session" AS session')
    const intentLock = cleanup.indexOf(
      'PERFORM 1 FROM "Phase7ReauthenticationIntent" AS intent'
    )
    const firstDelete = cleanup.indexOf('DELETE FROM "Session" AS session')

    expect(userLock).toBeGreaterThan(-1)
    expect(familyLock).toBeGreaterThan(userLock)
    expect(sessionLock).toBeGreaterThan(familyLock)
    expect(intentLock).toBeGreaterThan(sessionLock)
    expect(firstDelete).toBeGreaterThan(intentLock)
    expect(cleanup.slice(0, userLock)).not.toContain('FOR UPDATE')
    expect(cleanup).toContain(
      `intent."state" IN ('PREPARED', 'STAGED')\n        AND intent."expiresAt" <= checked_at`
    )
    expect(cleanup).toContain(
      `intent."state" = 'FINALIZED'\n        AND intent."finalizedAt" <= checked_at - INTERVAL '15 minutes'`
    )
  })

  it('prepare 응답 유실은 server-owned intent id로 exact 복구할 수 있다', () => {
    const prepare = extractFunction('phase7_prepare_reauthentication')
    expect(prepare).toContain('intent_id_value UUID')
    expect(prepare).toContain('target_intent_id UUID := intent_id_value')
    expect(prepare).toContain('OR intent_id_value IS NULL')
    expect(prepare).toContain(
      `RAISE EXCEPTION 'A live reauthentication intent already owns this Session.'`
    )
    expect(prepare).toContain(`USING ERRCODE = '40001'`)
    expect(migrationSql).toContain(
      `"phase7_prepare_reauthentication"(\n  TEXT, UUID, UUID, "AdminAuditEnvironment", UUID\n)`
    )
  })

  it('classified abort는 canonical locks와 exact old-token digest 뒤에만 삭제한다', () => {
    const classifiedAbort = extractFunction(
      'phase7_abort_reauthentication_classified'
    )
    const userLock = classifiedAbort.indexOf(
      'PERFORM 1 FROM "User" WHERE "id" = intent."userId" FOR UPDATE'
    )
    const familyLock = classifiedAbort.indexOf(
      'PERFORM 1 FROM "AuthSessionFamily"'
    )
    const sessionLock = classifiedAbort.indexOf(
      'PERFORM 1 FROM "Session" AS session'
    )
    const intentLock = classifiedAbort.indexOf(
      'WHERE "id" = intent_id_value FOR UPDATE'
    )
    const digestFence = classifiedAbort.indexOf(
      'Classified reauthentication abort token mismatch.'
    )
    const intentDelete = classifiedAbort.indexOf(
      'DELETE FROM "Phase7ReauthenticationIntent"'
    )

    expect(userLock).toBeGreaterThan(-1)
    expect(familyLock).toBeGreaterThan(userLock)
    expect(sessionLock).toBeGreaterThan(familyLock)
    expect(intentLock).toBeGreaterThan(sessionLock)
    expect(digestFence).toBeGreaterThan(intentLock)
    expect(intentDelete).toBeGreaterThan(digestFence)
    expect(classifiedAbort).toContain(`USING ERRCODE = '22023'`)
    expect(classifiedAbort).toContain(
      'INTO active_admin, authority_lost, live_non_admin'
    )
    expect(classifiedAbort).toContain(
      'ELSIF authority_lost OR live_non_admin THEN'
    )
    expect(classifiedAbort).not.toMatch(/ELSIF\s+EXISTS\s*\(/u)
  })

  it('authority classifier 둘은 동일 digest·evidence·live shape를 끝까지 평가한 뒤 한 번만 분류한다', () => {
    for (const functionName of [
      'phase7_classify_admin_authority',
      'phase7_classify_reauthentication_authority'
    ]) {
      const classifier = extractFunction(functionName)
      const digestIndex = classifier.indexOf(
        'token_digest_value := "phase7_reauthentication_token_digest"'
      )
      const selectIndex = classifier.indexOf('SELECT EXISTS (')
      const intoIndex = classifier.indexOf(
        'INTO authority_lost, live_non_admin'
      )
      const caseIndex = classifier.indexOf('RETURN QUERY SELECT CASE')

      expect(digestIndex).toBeGreaterThan(-1)
      expect(selectIndex).toBeGreaterThan(digestIndex)
      expect(intoIndex).toBeGreaterThan(selectIndex)
      expect(caseIndex).toBeGreaterThan(intoIndex)
      expect(classifier.match(/EXISTS\s*\(/gu)).toHaveLength(2)
      expect(classifier.match(/RETURN QUERY SELECT CASE/gu)).toHaveLength(1)
      expect(classifier.slice(selectIndex, caseIndex)).not.toMatch(
        /\bIF\b|\bRETURN\b/gu
      )
    }
  })

  it('owned logout의 direct Session arm은 ACTIVE만 허용하고 fence arm은 보존한다', () => {
    const signOut = extractFunction('phase7_owned_sign_out')
    expect(signOut).toContain(`session."authorizationState" = 'ACTIVE'`)
    expect(signOut).toContain('FROM "AuthSessionRotationFence" AS fence')
    expect(signOut).toContain('WHERE fence."oldTokenDigest" = token_digest')
  })

  it('reconcile은 exact fence와 canonical audit content digest를 모두 증명한다', () => {
    const reconcile = extractFunction('phase7_reconcile_reauthentication')
    expect(reconcile).toContain(
      `fence."oldTokenDigest" = intent."oldFenceTokenDigest"`
    )
    expect(reconcile).toContain(
      `audit."contentDigest" = "phase7_admin_audit_content_digest"(`
    )
    expect(reconcile).toContain(`session."authorizationState" = 'ACTIVE'`)
    expect(reconcile).toContain(`intent."state" = 'FINALIZED'`)
  })
})
