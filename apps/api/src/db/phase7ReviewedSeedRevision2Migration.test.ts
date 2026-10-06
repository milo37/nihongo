import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readMigration = (name: string): string =>
  readFileSync(
    new URL(`../../prisma/migrations/${name}/migration.sql`, import.meta.url),
    'utf8'
  )
const foundation = readMigration('20260827101000_phase7_admin_cms_foundation')
const revision = readMigration('20261005120000_phase7_reviewed_seed_revision2')
const start = foundation.indexOf(
  'CREATE FUNCTION "validate_phase7_system_seed_catalog"()'
)
const end = foundation.indexOf('\n$function$;', start)
const original = foundation.slice(start, end)
const replacements = [
  [
    '4e3f91b5341b90fed7064fc3d810cf5d6cfa581707012e92440c8b041e1130b1',
    'd129fccba730359b574914bf68d2e0af13a6b80ab11b6ce5269412fda3535584'
  ],
  [
    'a180a0ea8dac51200b533fbe99624036fc19984be9cfbdd0c972c624e764444c',
    'b19be0f3cea53f0918c50f81f2e67978e0933595d3637aa07844b3b68683d103'
  ]
] as const

const applyReviewedReplacement = (definition: string): string => {
  for (const [previous, next] of replacements) {
    if (definition.split(previous).length !== 2 || definition.includes(next)) {
      throw new Error('PRIOR_PIN_DRIFT')
    }
  }
  return replacements.reduce(
    (result, [previous, next]) => result.replace(previous, next),
    definition
  )
}

describe('reviewed committed catalog revision2 migration', () => {
  it('changes exactly the two calibrated pins while preserving the definition', () => {
    const next = applyReviewedReplacement(original)
    let restored = next
    for (const [previous, replacement] of replacements) {
      expect(revision).toContain(`'${previous}',\n    '${replacement}'`)
      restored = restored.replace(replacement, previous)
    }
    expect(restored).toBe(original)
    expect([...revision.matchAll(/pg_catalog\.replace\(/gu)].length).toBe(4)
    for (const unchanged of [
      '(SELECT COUNT(*) FROM "Tag") <> 108',
      '(SELECT COUNT(*) FROM "TagApplicability") <> 127',
      'adeca1ed1c85338c85aa3ec13299d43532f9bf4e0f0515775a29563567f4b078',
      'DISTINCT "contentFingerprint"',
      '"phase7_question_version_fingerprint"',
      "USING ERRCODE = '23514'"
    ]) {
      expect(next).toContain(unchanged)
    }
  })

  it('rejects missing, duplicated and already replaced previous pins', () => {
    for (const [previous, next] of replacements) {
      expect(() =>
        applyReviewedReplacement(original.replace(previous, 'bad'))
      ).toThrow('PRIOR_PIN_DRIFT')
      expect(() => applyReviewedReplacement(original + previous)).toThrow(
        'PRIOR_PIN_DRIFT'
      )
      expect(() =>
        applyReviewedReplacement(original.replace(previous, next))
      ).toThrow('PRIOR_PIN_DRIFT')
    }
    expect(revision).toContain(') <> 64')
    expect(revision).toContain(
      'Reviewed seed validator prior digest pins drifted.'
    )
  })

  it('retains function identity, owner, privileges and security configuration', () => {
    for (const condition of [
      'p.pronargs = 0',
      "p.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype",
      'p.prosecdef',
      "r.rolname = 'nihongo_phase7_owner'",
      'p.proacl IS DISTINCT FROM original_acl',
      'p.proconfig IS DISTINCT FROM original_config',
      "p.proowner <> 'nihongo_phase7_owner'::pg_catalog.regrole",
      'pg_catalog.pg_get_functiondef(function_oid) <> replacement',
      'SET LOCAL ROLE "nihongo_phase7_migration";',
      "pg_catalog.set_config('search_path', 'pg_catalog, pg_temp', true)"
    ]) {
      expect(revision).toContain(condition)
    }
    expect(revision).not.toMatch(
      /DISABLE TRIGGER|UPDATE "Question"|DELETE FROM|DROP FUNCTION|GRANT |REVOKE /u
    )
  })
})
