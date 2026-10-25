import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSsoDbHarness, digest } from './phase7SsoTestFixture.js'
import type { SsoFixture } from './phase7SsoTestFixture.js'
let h: ReturnType<typeof createSsoDbHarness>
beforeAll(async () => {
  h = createSsoDbHarness()
  await h.connect()
})
afterAll(async () => {
  if (h) await h.close()
})
const gateway = async (sql: string, args: readonly unknown[] = []) =>
  (await h.roleQuery<{ result: unknown }>('nihongo_auth_gateway', sql, args))
    .rows[0]?.result
const verifyFresh = async (f: SsoFixture) => {
  const context = await gateway(
    'SELECT "phase7_prepare_sso_account_fresh"($1,$2) AS result',
    [f.token, f.provider]
  )
  expect(context).toBeTruthy()
  const proof = digest()
  expect(
    await gateway(
      'SELECT "phase7_stage_sso_account_fresh_proof"($1::jsonb,$2,$3,$4,$5) AS result',
      [JSON.stringify(context), f.provider, f.subject, proof, '/login']
    )
  ).toBe(true)
  expect(
    await gateway(
      'SELECT "phase7_complete_sso_account_fresh"($1,$2) AS result',
      [proof, f.token]
    )
  ).toBe('/login')
  return proof
}
const link = async (f: SsoFixture, proof: string, subject: string) => {
  const context = await gateway(
    'SELECT "phase7_prepare_sso_account_link"($1,\'apple\',$2) AS result',
    [f.token, proof]
  )
  expect(context).toBeTruthy()
  const staged = digest()
  expect(
    await gateway(
      "SELECT \"phase7_stage_sso_account_fresh_proof\"($1::jsonb,'apple',$2,$3,'/login') AS result",
      [JSON.stringify(context), subject, staged]
    )
  ).toBe(true)
  return gateway('SELECT "phase7_complete_sso_account_link"($1,$2) AS result', [
    staged,
    f.token
  ])
}
describe('JLP-483 SSO account lifecycle task-owned PostgreSQL contract', () => {
  it('account LINK/unlink preserve one internal user and learning while rejecting cross-user identities and last method', async () => {
    await h.rollback(async () => {
      const f = await h.fixture('google', 'USER'),
        other = await h.fixture('apple', 'USER')
      await h.learningFixture(f.userId)
      const before = await h.snapshot(),
        proof = await verifyFresh(f)
      expect(await link(f, proof, other.subject)).toBeNull()
      expect(await link(f, proof, 'linked-' + randomUUID())).toBe('/login')
      const owner = (
        await h.owner.query(
          'SELECT role,"authorityGeneration" FROM "User" WHERE id=$1',
          [f.userId]
        )
      ).rows[0]
      expect(owner).toEqual({ role: 'USER', authorityGeneration: 1 })
      expect(
        await gateway(
          "SELECT \"phase7_unlink_sso_account\"($1,'google',ARRAY['apple','google'],$2) AS result",
          [f.token, null]
        )
      ).toEqual({ unlinked: true, sessionRevoked: true })
      const after = await h.snapshot()
      for (const table of Object.keys(before).filter(
        (t) => !['User', 'Account'].includes(t)
      ))
        expect(after[table]).toEqual(before[table])
      expect(
        (
          await h.owner.query(
            'SELECT (SELECT count(*)::int FROM "Session" WHERE "userId"=$1) AS sessions,(SELECT count(*)::int FROM "AuthSessionFamily" WHERE "userId"=$1 AND status=\'ACTIVE\') AS active,(SELECT count(*)::int FROM "Account" WHERE "userId"=$1 AND "providerId" IN (\'apple\',\'google\')) AS accounts',
            [f.userId]
          )
        ).rows
      ).toEqual([{ sessions: 0, active: 0, accounts: 1 }])
      const remaining = await h.fixture('google', 'USER')
      expect(
        await gateway(
          "SELECT \"phase7_unlink_sso_account\"($1,'google',ARRAY['apple','google'],NULL) AS result",
          [remaining.token]
        )
      ).toEqual({ code: 'SSO_LAST_SIGN_IN_METHOD' })
      await h.owner.query('SET CONSTRAINTS ALL IMMEDIATE')
    })
  })
  it('concurrent account unlinks cannot remove both sign-in methods', async () => {
    await h.owner.query('BEGIN')
    let f: SsoFixture
    try {
      f = await h.fixture('google', 'USER')
      await h.owner.query(
        'INSERT INTO "Account"(id,"providerId","accountId","userId","createdAt","updatedAt") VALUES($1,\'apple\',$2,$3,clock_timestamp(),clock_timestamp())',
        [randomUUID(), 'second-' + randomUUID(), f.userId]
      )
      await h.owner.query('COMMIT')
    } catch (error: unknown) {
      await h.owner.query('ROLLBACK')
      throw error
    }
    const outcomes = await Promise.all([
      h.gatewayA.query<{ result: { unlinked?: boolean; code?: string } }>(
        "SELECT \"phase7_unlink_sso_account\"($1,'google',ARRAY['apple','google'],NULL) AS result",
        [f.token]
      ),
      h.gatewayB.query<{ result: { unlinked?: boolean; code?: string } }>(
        "SELECT \"phase7_unlink_sso_account\"($1,'apple',ARRAY['apple','google'],NULL) AS result",
        [f.token]
      )
    ])
    expect(
      outcomes.filter((v) => v.rows[0]?.result.unlinked === true)
    ).toHaveLength(1)
    expect(
      outcomes.filter(
        (v) => v.rows[0]?.result.code === 'AUTHENTICATION_REQUIRED'
      )
    ).toHaveLength(1)
    expect(
      (
        await h.owner.query(
          'SELECT count(*)::int AS count FROM "Account" WHERE "userId"=$1 AND "providerId" IN (\'apple\',\'google\')',
          [f.userId]
        )
      ).rows[0]?.count
    ).toBe(1)
  })
  it('fresh account deletion revokes every app session before worker-only erasure and keeps provider cleanup independent', async () => {
    await h.rollback(async () => {
      const f = await h.fixture('google', 'USER')
      await h.learningFixture(f.userId)
      const receipt = digest()
      expect(
        await gateway(
          'SELECT "phase7_request_sso_account_erasure"($1,NULL,$2) AS result',
          [f.token, receipt]
        )
      ).toEqual({ code: 'SSO_FRESH_REQUIRED' })
      const proof = await verifyFresh(f)
      expect(
        await gateway(
          'SELECT "phase7_request_sso_account_erasure"($1,$2,$3) AS result',
          [f.token, proof, receipt]
        )
      ).toEqual({
        appStatus: 'DELETION_PENDING',
        providerCleanup: [{ provider: 'google', status: 'PENDING' }]
      })
      expect(
        (
          await h.owner.query(
            'SELECT (SELECT count(*)::int FROM "Session" WHERE "userId"=$1) AS sessions,(SELECT count(*)::int FROM "AuthSessionFamily" WHERE "userId"=$1 AND status=\'ACTIVE\') AS active,(SELECT "accountStatus"::text FROM "User" WHERE id=$1) AS status',
            [f.userId]
          )
        ).rows
      ).toEqual([{ sessions: 0, active: 0, status: 'DELETION_PENDING' }])
      const job = (
        await h.owner.query<{ id: string }>(
          'SELECT id FROM "SsoAccountErasureRequest" WHERE "receiptDigest"=$1',
          [receipt]
        )
      ).rows[0]!
      await h.rejects(
        'nihongo_auth_gateway',
        'SELECT "phase7_complete_sso_account_erasure"($1,\'TEST\')',
        [job.id],
        '42501'
      )
      expect(
        (
          await h.roleQuery<{ ok: boolean }>(
            'nihongo_erasure_worker',
            'SELECT "phase7_complete_sso_account_erasure"($1,\'TEST\') AS ok',
            [job.id]
          )
        ).rows[0]?.ok
      ).toBe(true)
      expect(
        await gateway(
          'SELECT "phase7_sso_account_erasure_status"($1) AS result',
          [receipt]
        )
      ).toEqual({
        appStatus: 'DELETED',
        providerCleanup: [{ provider: 'google', status: 'PENDING' }]
      })
      await h.roleQuery(
        'nihongo_erasure_worker',
        "SELECT \"phase7_record_sso_provider_cleanup\"($1,'google','FAILED')",
        [job.id]
      )
      expect(
        await gateway(
          'SELECT "phase7_sso_account_erasure_status"($1) AS result',
          [receipt]
        )
      ).toEqual({
        appStatus: 'DELETED',
        providerCleanup: [{ provider: 'google', status: 'FAILED' }]
      })
      expect(
        (
          await h.owner.query(
            'SELECT (SELECT count(*)::int FROM "User" WHERE id=$1) AS users,(SELECT count(*)::int FROM "SsoAccountFreshProof" WHERE "userId"=$1) AS proofs,(SELECT count(*)::int FROM "Bookmark" WHERE "userId"=$1) AS bookmarks',
            [f.userId]
          )
        ).rows
      ).toEqual([{ users: 0, proofs: 0, bookmarks: 0 }])
      await h.owner.query('SET CONSTRAINTS ALL IMMEDIATE')
    })
  })
})
