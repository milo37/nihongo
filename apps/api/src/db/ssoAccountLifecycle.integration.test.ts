import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '../generated/prisma/client.js'
import {
  createSsoAccountErasureWorker,
  runSsoAccountErasureBatch
} from '../auth/ssoAccountRepository.js'
import { createSsoDbHarness, digest } from './ssoTestFixture.js'
import type { SsoFixture } from './ssoTestFixture.js'
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
  it('fresh account deletion revokes every app session and requires provider cleanup proof before erasure', async () => {
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
      ).toBe(false)
      expect(
        await gateway(
          'SELECT "phase7_sso_account_erasure_status"($1) AS result',
          [receipt]
        )
      ).toEqual({
        appStatus: 'DELETION_PENDING',
        providerCleanup: [{ provider: 'google', status: 'PENDING' }]
      })
      expect(
        (
          await h.owner.query(
            'SELECT count(*)::int AS count FROM "User" WHERE id=$1',
            [f.userId]
          )
        ).rows[0]?.count
      ).toBe(1)
      const claims = (
        await h.roleQuery<{
          result: Array<{ id: string; leaseToken: string }>
        }>(
          'nihongo_erasure_worker',
          'SELECT "phase7_claim_sso_provider_cleanups"(100,300,\'TEST\') AS result'
        )
      ).rows[0]!.result
      const leaseToken = claims.find((claim) => claim.id === job.id)!.leaseToken
      expect(
        (
          await h.roleQuery<{ ok: boolean }>(
            'nihongo_erasure_worker',
            "SELECT \"phase7_begin_sso_provider_cleanup\"($1,'google',$2,'TEST') AS ok",
            [job.id, leaseToken]
          )
        ).rows[0]?.ok
      ).toBe(true)
      const recordCleanup = async (status: 'COMPLETED' | 'FAILED') =>
        (
          await h.roleQuery<{ ok: boolean }>(
            'nihongo_erasure_worker',
            "SELECT \"phase7_record_sso_provider_cleanup\"($1,'google',$2,$3,'TEST') AS ok",
            [job.id, status, leaseToken]
          )
        ).rows[0]?.ok
      expect(await recordCleanup('FAILED')).toBe(true)
      expect(
        (
          await h.roleQuery<{ ok: boolean }>(
            'nihongo_erasure_worker',
            'SELECT "phase7_complete_sso_account_erasure"($1,\'TEST\') AS ok',
            [job.id]
          )
        ).rows[0]?.ok
      ).toBe(false)
      expect(
        await gateway(
          'SELECT "phase7_sso_account_erasure_status"($1) AS result',
          [receipt]
        )
      ).toEqual({
        appStatus: 'DELETION_PENDING',
        providerCleanup: [{ provider: 'google', status: 'FAILED' }]
      })
      expect(await recordCleanup('COMPLETED')).toBe(true)
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
        providerCleanup: [{ provider: 'google', status: 'COMPLETED' }]
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
  it('one-shot worker completes requests idempotently, retries partial failure and waits for provider cleanup', async () => {
    await h.rollback(async () => {
      const worker = createSsoAccountErasureWorker({
        $queryRawUnsafe: async (sql: string, ...args: unknown[]) =>
          (await h.roleQuery('nihongo_erasure_worker', sql, args)).rows
      } as unknown as Pick<PrismaClient, '$queryRawUnsafe'>)
      const request = async () => {
        const f = await h.fixture('google', 'USER')
        const receipt = digest()
        await gateway(
          'SELECT "phase7_request_sso_account_erasure"($1,$2,$3) AS result',
          [f.token, await verifyFresh(f), receipt]
        )
        const { id } = (
          await h.owner.query<{ id: string }>(
            'SELECT id FROM "SsoAccountErasureRequest" WHERE "receiptDigest"=$1',
            [receipt]
          )
        ).rows[0]!
        return { ...f, id }
      }
      const a = await request(),
        b = await request(),
        bystander = await h.fixture('google', 'USER')
      const mine = (ids: string[]) =>
        ids.filter((id) => id === a.id || id === b.id)
      const run = async () => {
        const r = await runSsoAccountErasureBatch(worker, 'TEST', 100)
        return {
          completedIds: mine(r.completedIds),
          providerCleanupPendingIds: mine(r.providerCleanupPendingIds),
          failedIds: mine(r.failedIds)
        }
      }
      for (const role of ['nihongo_auth_gateway', 'nihongo_app'] as const)
        await h.rejects(
          role,
          'SELECT "phase7_list_sso_account_erasures"(10,\'TEST\')',
          [],
          '42501'
        )
      const users = async (ids: string[]) =>
        (
          await h.owner.query<{ id: string; sessions: number }>(
            'SELECT u.id,(SELECT count(*)::int FROM "Session" s WHERE s."userId"=u.id) AS sessions FROM "User" u WHERE u.id=ANY($1::uuid[]) ORDER BY u.id',
            [ids]
          )
        ).rows
      expect(await run()).toEqual({
        completedIds: [],
        providerCleanupPendingIds: [a.id, b.id],
        failedIds: []
      })
      expect(await users([a.userId, b.userId])).toHaveLength(2)
      // Simulates a claimed dispatch and evidence from a future provider adapter.
      const claims = await worker.claimProviderCleanups(100, 300, 'TEST')
      const aToken = claims.find((claim) => claim.id === a.id)!.leaseToken
      const bToken = claims.find((claim) => claim.id === b.id)!.leaseToken
      expect(
        await worker.beginProviderCleanup(a.id, 'google', aToken, 'TEST')
      ).toBe(true)
      expect(
        await worker.beginProviderCleanup(b.id, 'google', bToken, 'TEST')
      ).toBe(true)
      expect(
        await worker.recordProviderCleanup(
          a.id,
          'google',
          'COMPLETED',
          aToken,
          'TEST'
        )
      ).toBe(true)
      expect(
        await worker.recordProviderCleanup(
          b.id,
          'google',
          'FAILED',
          bToken,
          'TEST'
        )
      ).toBe(true)
      expect(await run()).toEqual({
        completedIds: [a.id],
        providerCleanupPendingIds: [b.id],
        failedIds: []
      })
      await h.owner.query(
        'SET CONSTRAINTS "Phase7OperationIntent_must_finish" DEFERRED'
      )
      expect(await users([a.userId])).toEqual([])
      expect(await users([b.userId])).toEqual([{ id: b.userId, sessions: 0 }])
      expect(await users([bystander.userId])).toEqual([
        { id: bystander.userId, sessions: 1 }
      ])
      expect(
        await worker.recordProviderCleanup(
          b.id,
          'google',
          'COMPLETED',
          bToken,
          'TEST'
        )
      ).toBe(true)
      // Simulated partial app failure after provider cleanup is complete.
      await h.owner.query(
        'UPDATE "SsoAccountErasureRequest" SET "userId"=NULL WHERE id=$1',
        [b.id]
      )
      expect(await run()).toEqual({
        completedIds: [],
        providerCleanupPendingIds: [],
        failedIds: [b.id]
      })
      expect(await users([b.userId])).toEqual([{ id: b.userId, sessions: 0 }])
      await h.owner.query(
        'UPDATE "SsoAccountErasureRequest" SET "userId"=$2 WHERE id=$1',
        [b.id, b.userId]
      )
      expect(await run()).toEqual({
        completedIds: [b.id],
        providerCleanupPendingIds: [],
        failedIds: []
      })
      expect(await users([b.userId])).toEqual([])
      expect(await worker.complete(b.id, 'TEST')).toBe(true)
      expect(
        await worker.recordProviderCleanup(
          b.id,
          'google',
          'FAILED',
          bToken,
          'TEST'
        )
      ).toBe(false)
      expect(await run()).toEqual({
        completedIds: [],
        providerCleanupPendingIds: [],
        failedIds: []
      })
      expect(await users([bystander.userId])).toEqual([
        { id: bystander.userId, sessions: 1 }
      ])
      await h.owner.query('SET CONSTRAINTS ALL IMMEDIATE')
    })
  })
  it('fences stale claims, denies legacy recorders and retains uncertain dispatches after expiry', async () => {
    await h.rollback(async () => {
      const id = randomUUID()
      await h.owner.query(
        `INSERT INTO "SsoAccountErasureRequest" (id,"receiptDigest","providerCleanup","receiptExpiresAt","createdAt")
         VALUES ($1,$2,'[{"provider":"google","status":"PENDING"}]',clock_timestamp()+interval '1 day','2000-01-01')`,
        [id, digest()]
      )
      const worker = createSsoAccountErasureWorker({
        $queryRawUnsafe: async (sql: string, ...args: unknown[]) =>
          (await h.roleQuery('nihongo_erasure_worker', sql, args)).rows
      } as unknown as Pick<PrismaClient, '$queryRawUnsafe'>)
      const claim = async () =>
        (await worker.claimProviderCleanups(100, 300, 'TEST')).find(
          (row) => row.id === id
        )
      // A pre-fencing worker may still be dispatching after its lease expired.
      await h.owner.query(
        'UPDATE "SsoAccountErasureRequest" SET "leaseExpiresAt"=clock_timestamp()-interval \'1 second\' WHERE id=$1',
        [id]
      )
      expect(await claim()).toBeUndefined()
      await h.owner.query(
        'UPDATE "SsoAccountErasureRequest" SET "leaseExpiresAt"=NULL WHERE id=$1',
        [id]
      )
      const first = (await claim())!
      expect(first.leaseToken).toBeTruthy()
      expect(await claim()).toBeUndefined()
      await h.owner.query(
        'UPDATE "SsoAccountErasureRequest" SET "leaseExpiresAt"=clock_timestamp()-interval \'1 second\' WHERE id=$1',
        [id]
      )
      const second = (await claim())!
      expect(second.leaseToken).not.toBe(first.leaseToken)
      expect(
        await worker.beginProviderCleanup(
          id,
          'google',
          first.leaseToken,
          'TEST'
        )
      ).toBe(false)
      expect(
        await worker.beginProviderCleanup(
          id,
          'google',
          second.leaseToken,
          'TEST'
        )
      ).toBe(true)
      expect(
        await worker.beginProviderCleanup(
          id,
          'google',
          second.leaseToken,
          'TEST'
        )
      ).toBe(false)
      expect(
        await worker.recordProviderCleanup(
          id,
          'google',
          'COMPLETED',
          first.leaseToken,
          'TEST'
        )
      ).toBe(false)
      expect(
        await worker.recordProviderCleanup(
          id,
          'google',
          'UNAVAILABLE',
          second.leaseToken,
          'TEST'
        )
      ).toBe(true)
      expect(
        await worker.beginProviderCleanup(
          id,
          'google',
          second.leaseToken,
          'TEST'
        )
      ).toBe(true)
      expect(
        await worker.recordProviderCleanup(
          id,
          'google',
          'FAILED',
          second.leaseToken,
          'TEST'
        )
      ).toBe(true)
      expect(
        await worker.beginProviderCleanup(
          id,
          'google',
          second.leaseToken,
          'TEST'
        )
      ).toBe(false)
      for (const sql of [
        "SELECT \"phase7_record_sso_provider_cleanup\"($1,'google','COMPLETED')",
        "SELECT \"phase7_record_sso_provider_cleanup\"($1,'google','COMPLETED','TEST')"
      ])
        await h.rejects('nihongo_erasure_worker', sql, [id], '42501')
      for (const role of ['nihongo_app', 'nihongo_auth_gateway'] as const) {
        await h.rejects(
          role,
          "SELECT \"phase7_begin_sso_provider_cleanup\"($1,'google',$2,'TEST')",
          [id, second.leaseToken],
          '42501'
        )
        await h.rejects(
          role,
          "SELECT \"phase7_record_sso_provider_cleanup\"($1,'google','COMPLETED',$2,'TEST')",
          [id, second.leaseToken],
          '42501'
        )
      }
      await h.owner.query(
        'UPDATE "SsoAccountErasureRequest" SET "leaseExpiresAt"=clock_timestamp()-interval \'1 second\' WHERE id=$1',
        [id]
      )
      expect(await claim()).toBeUndefined()
      expect(
        await worker.recordProviderCleanup(
          id,
          'google',
          'COMPLETED',
          second.leaseToken,
          'TEST'
        )
      ).toBe(false)
      expect(
        (
          await h.owner.query(
            'SELECT "activeProvider","providerCleanup" FROM "SsoAccountErasureRequest" WHERE id=$1',
            [id]
          )
        ).rows
      ).toEqual([
        {
          activeProvider: 'google',
          providerCleanup: [{ provider: 'google', status: 'FAILED' }]
        }
      ])
    })
  })

  it('serializes independent claims/dispatches and rejects a record whose row-lock wait outlives its lease', async () => {
    const id = randomUUID()
    const peers = [h.createOwnerPeer(), h.createOwnerPeer()]
    await Promise.all(peers.map((peer) => peer.connect()))
    try {
      await h.owner.query(
        `INSERT INTO "SsoAccountErasureRequest" (id,"receiptDigest","providerCleanup","receiptExpiresAt","createdAt")
         VALUES ($1,$2,'[{"provider":"google","status":"PENDING"}]',clock_timestamp()+interval '1 day','2000-01-01')`,
        [id, digest()]
      )
      await Promise.all(
        peers.map((peer) => peer.query('SET ROLE "nihongo_erasure_worker"'))
      )
      const claims = await Promise.all(
        peers.map((peer) =>
          peer.query<{ result: Array<{ id: string; leaseToken: string }> }>(
            'SELECT "phase7_claim_sso_provider_cleanups"(1,300,\'TEST\') AS result'
          )
        )
      )
      const mine = claims
        .flatMap((result) => result.rows[0]!.result)
        .filter((claim) => claim.id === id)
      expect(mine).toHaveLength(1)
      const token = mine[0]!.leaseToken
      const starts = await Promise.all(
        peers.map((peer) =>
          peer.query<{ ok: boolean }>(
            "SELECT \"phase7_begin_sso_provider_cleanup\"($1,'google',$2,'TEST') AS ok",
            [id, token]
          )
        )
      )
      expect(starts.map((result) => result.rows[0]!.ok).sort()).toEqual([
        false,
        true
      ])
      const peer = peers[0]!
      const pid = (
        await peer.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
      ).rows[0]!.pid
      await h.owner.query('BEGIN')
      try {
        await h.owner.query(
          'SELECT id FROM "SsoAccountErasureRequest" WHERE id=$1 FOR UPDATE',
          [id]
        )
        const pending = peer.query<{ ok: boolean }>(
          "SELECT \"phase7_record_sso_provider_cleanup\"($1,'google','COMPLETED',$2,'TEST') AS ok",
          [id, token]
        )
        // Observe an actual independent-session lock wait before expiring the lease.
        let blocked = false
        for (let attempt = 0; attempt < 100; attempt += 1) {
          blocked = (
            await h.owner.query<{ blocked: boolean }>(
              'SELECT cardinality(pg_blocking_pids($1))>0 AS blocked',
              [pid]
            )
          ).rows[0]!.blocked
          if (blocked) break
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
        await h.owner.query(
          'UPDATE "SsoAccountErasureRequest" SET "leaseExpiresAt"=clock_timestamp()-interval \'1 second\' WHERE id=$1',
          [id]
        )
        await h.owner.query('COMMIT')
        expect((await pending).rows[0]!.ok).toBe(false)
        expect(blocked).toBe(true)
      } finally {
        await h.owner.query('ROLLBACK')
      }
      const retried = await peer.query<{ result: Array<{ id: string }> }>(
        'SELECT "phase7_claim_sso_provider_cleanups"(100,300,\'TEST\') AS result'
      )
      expect(retried.rows[0]!.result.some((claim) => claim.id === id)).toBe(
        false
      )
    } finally {
      await Promise.all(peers.map((peer) => peer.end()))
      await h.owner.query(
        'DELETE FROM "SsoAccountErasureRequest" WHERE id=$1',
        [id]
      )
    }
  })
})
