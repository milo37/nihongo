import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import { assertSafePhase7MigrationDatabase } from './databaseTargetGuard.js'
import { createPostgresStartupOptions } from './databaseOptions.js'
import { createSsoAdminFreshRepository } from '../auth/ssoAdminFreshRepository.js'
import { createSsoIdentityRepository } from '../auth/ssoIdentityRepository.js'
import type { PrismaClient } from '../generated/prisma/client.js'
import { loadExpectedMigrationManifest } from './readiness.js'
import { createSsoDbHarness, digest } from './phase7SsoTestFixture.js'
import type { SsoFixture } from './phase7SsoTestFixture.js'

// Imported only by the registered task-owned runner, never ordinary unit tests.
// All provider/sub proofs are synthetic SQL inputs; no OAuth network or browser.
let h: ReturnType<typeof createSsoDbHarness>
beforeAll(async () => {
  h = createSsoDbHarness()
  await h.connect()
})
afterAll(async () => {
  if (h) await h.close()
})
const committedFixture = async () => {
  await h.owner.query('BEGIN')
  try {
    const f = await h.fixture()
    await h.owner.query('COMMIT')
    return f
  } catch (error: unknown) {
    await h.owner.query('ROLLBACK')
    throw error
  }
}
const staged = async (f: SsoFixture) => {
  const context = await h.prepare(f)
  const proof = await h.stage(context)
  expect(proof.accepted).toBe(true)
  return { context, proof: proof.proof }
}
const fresh = async (token: string) =>
  (
    await h.roleQuery<{ fresh: boolean }>(
      'nihongo_app',
      'SELECT "phase7_sso_admin_session_is_fresh"($1) AS fresh',
      [token]
    )
  ).rows[0]?.fresh
const expectedRotation = {
  oldSessions: 0,
  activeSessions: 1,
  pendingSessions: 0,
  fences: 1,
  audits: 1,
  finalized: 1
}
const unchangedSession = {
  oldSessions: 1,
  activeSessions: 1,
  pendingSessions: 0,
  fences: 0,
  audits: 0,
  finalized: 0
}

describe('JLP-508 SSO task-owned PostgreSQL contract', () => {
  it('deploy and re-entry leave exactly47 completed names/checksums preserving the old46 prefix', async () => {
    const expected = loadExpectedMigrationManifest(
      fileURLToPath(new URL('../../prisma/migrations/', import.meta.url))
    )
    const actual = await h.owner.query<{
      name: string
      checksum: string
      complete: boolean
    }>(
      `SELECT migration_name AS name,checksum,finished_at IS NOT NULL AND rolled_back_at IS NULL AS complete FROM "_prisma_migrations" WHERE rolled_back_at IS NULL ORDER BY migration_name`
    )
    expect(expected).toHaveLength(47)
    expect(
      actual.rows.map(({ name, checksum }) => ({ name, checksum }))
    ).toEqual(expected)
    expect(actual.rows.every((row) => row.complete)).toBe(true)
    expect(
      actual.rows.slice(0, 44).map(({ name, checksum }) => ({ name, checksum }))
    ).toEqual(expected.slice(0, 44))
    expect(actual.rows[44]?.name).toBe(
      '20261019113000_sso_admin_fresh_column_qualification'
    )
    expect(actual.rows.slice(39, 44).map((row) => row.name)).toEqual([
      '20261019090000_sso_login_transactions',
      '20261019093000_sso_apple_google_providers',
      '20261019100000_sso_identity_mapping',
      '20261019103000_sso_admin_fresh',
      '20261019110000_sso_admin_fresh_erasure_ownership'
    ])
    expect(
      actual.rows.slice(0, 45).map(({ name, checksum }) => ({ name, checksum }))
    ).toEqual(expected.slice(0, 45))
    expect(actual.rows[45]?.name).toBe('20261020230000_sso_account_lifecycle')
    expect(
      actual.rows.slice(0, 46).map(({ name, checksum }) => ({ name, checksum }))
    ).toEqual(expected.slice(0, 46))
    expect(actual.rows[46]?.name).toBe(
      '20261020233000_sso_first_admin_bootstrap'
    )
    // Existing runner executes canonical deploy then db:migrate:deploy re-entry
    // before this suite. One completed row per name proves no duplicate apply.
    expect(new Set(actual.rows.map((row) => row.name)).size).toBe(47)
  })

  it('new private objects have exact owner, search_path and least-privilege ACLs', async () => {
    const tables = await h.owner.query<{
      name: string
      owner: string
      app: boolean
      gateway: boolean
      erasure: boolean
      publicGrant: boolean
    }>(
      `SELECT c.relname AS name,r.rolname AS owner,
      has_table_privilege('nihongo_app',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS app,
      has_table_privilege('nihongo_auth_gateway',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS gateway,
      has_table_privilege('nihongo_erasure_worker',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS erasure,
      EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=0) AS "publicGrant"
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner WHERE n.nspname=$1 AND c.relname=ANY($2) ORDER BY c.relname`,
      [
        h.schema,
        [
          'SsoLoginTransaction',
          'SsoAdminFreshTransaction',
          'SsoAdminFreshProof'
        ]
      ]
    )
    expect(tables.rows).toEqual(
      [
        'SsoAdminFreshProof',
        'SsoAdminFreshTransaction',
        'SsoLoginTransaction'
      ].map((name) => ({
        name,
        owner: 'nihongo_phase7_owner',
        app: false,
        gateway: false,
        erasure: false,
        publicGrant: false
      }))
    )
    const gatewayFunctions = [
      'phase7_create_sso_transaction_v2',
      'phase7_consume_sso_transaction_v2',
      'phase7_resolve_sso_identity',
      'phase7_prepare_sso_admin_fresh',
      'phase7_create_sso_admin_fresh_transaction',
      'phase7_consume_sso_admin_fresh_transaction',
      'phase7_stage_sso_admin_fresh_proof',
      'phase7_complete_sso_admin_fresh',
      'phase7_reconcile_sso_admin_fresh',
      'phase7_cancel_sso_admin_fresh_proof'
    ]
    const privateFunctions = [
      'phase7_create_sso_transaction',
      'phase7_consume_sso_transaction',
      'phase7_sso_fresh_context_valid',
      'validate_phase7_sso_fresh_operation'
    ]
    const names = [
      ...gatewayFunctions,
      ...privateFunctions,
      'phase7_sso_admin_session_is_fresh'
    ].toSorted()
    const routines = await h.owner.query<{
      name: string
      owner: string
      definer: boolean
      config: string[]
      app: boolean
      gateway: boolean
      erasure: boolean
      publicGrant: boolean
    }>(
      `SELECT p.proname AS name,r.rolname AS owner,p.prosecdef AS definer,p.proconfig AS config,
      has_function_privilege('nihongo_app',p.oid,'EXECUTE') AS app,has_function_privilege('nihongo_auth_gateway',p.oid,'EXECUTE') AS gateway,has_function_privilege('nihongo_erasure_worker',p.oid,'EXECUTE') AS erasure,
      EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS "publicGrant"
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname=$1 AND p.proname=ANY($2) ORDER BY p.proname`,
      [h.schema, names]
    )
    expect(routines.rows.map((row) => row.name)).toEqual(names)
    for (const row of routines.rows) {
      expect({
        owner: row.owner,
        definer: row.definer,
        app: row.app,
        gateway: row.gateway,
        erasure: row.erasure,
        publicGrant: row.publicGrant
      }).toEqual({
        owner: 'nihongo_phase7_owner',
        definer: true,
        app: row.name === 'phase7_sso_admin_session_is_fresh',
        gateway: gatewayFunctions.includes(row.name),
        erasure: false,
        publicGrant: false
      })
      expect(row.config).toEqual([
        `search_path=pg_catalog, ${h.schema}, pg_temp`
      ])
    }
    await h.rollback(async () => {
      for (const role of [
        'nihongo_app',
        'nihongo_auth_gateway',
        'nihongo_erasure_worker'
      ] as const) {
        await h.rejects(role, 'SELECT * FROM "SsoAdminFreshProof"', [], '42501')
      }
      await h.rejects(
        'nihongo_app',
        'SELECT "phase7_prepare_sso_admin_fresh"($1,$2)',
        ['missing', 'google'],
        '42501'
      )
      await h.rejects(
        'nihongo_erasure_worker',
        'SELECT "phase7_prepare_sso_admin_fresh"($1,$2)',
        ['missing', 'google'],
        '42501'
      )
      await h.rejects(
        'nihongo_auth_gateway',
        'SELECT "phase7_sso_fresh_context_valid"($1::jsonb)',
        ['{}'],
        '42501'
      )
    })
  })

  it.each(['apple', 'google'] as const)(
    '%s LOGIN state is provider/binding-bound, finite and one-use',
    async (provider) => {
      await h.rollback(async () => {
        const state = digest(),
          binding = digest()
        const create = (callback: string) =>
          h.roleQuery<{ ok: boolean }>(
            'nihongo_auth_gateway',
            'SELECT "phase7_create_sso_transaction_v2"($1,$2,$3,$4,$5,$6) AS ok',
            [provider, state, binding, 'n'.repeat(43), 'v'.repeat(86), callback]
          )
        expect((await create('//external.test')).rows[0]?.ok).toBe(false)
        expect((await create('/practice')).rows[0]?.ok).toBe(true)
        const consume = (p: string, b: string) =>
          h.roleQuery(
            'nihongo_auth_gateway',
            'SELECT * FROM "phase7_consume_sso_transaction_v2"($1,$2,$3)',
            [p, state, b]
          )
        expect((await consume(provider, digest())).rowCount).toBe(0)
        expect(
          (await consume(provider === 'apple' ? 'google' : 'apple', binding))
            .rowCount
        ).toBe(0)
        expect((await consume(provider, binding)).rowCount).toBe(1)
        expect((await consume(provider, binding)).rowCount).toBe(0)
      })
    }
  )

  it('provider/sub alone resolves stable IDs; contact conflicts never merge or promote; new identities are USER', async () => {
    await h.rollback(async () => {
      const f = await h.fixture()
      const before = await h.snapshot()
      const resolve = async (
        provider: string,
        subject: string,
        email: string
      ) =>
        (
          await h.roleQuery<{ identity: Record<string, unknown> }>(
            'nihongo_auth_gateway',
            'SELECT "phase7_resolve_sso_identity"($1,$2,$3,$4) AS identity',
            [provider, subject, email, 'SQL SSO fixture']
          )
        ).rows[0]?.identity
      expect(
        await resolve(f.provider, f.subject, `${randomUUID()}@example.test`)
      ).toMatchObject({
        outcome: 'RESOLVED',
        userId: f.userId,
        role: 'ADMIN',
        authorityGeneration: 1
      })
      expect(await h.snapshot()).toEqual(before)
      const email = (
        await h.owner.query<{ email: string }>(
          'SELECT email FROM "User" WHERE id=$1',
          [f.userId]
        )
      ).rows[0]?.email
      if (!email) throw new Error('Fixture contact unavailable.')
      expect(
        await resolve('apple', `different-${randomUUID()}`, email)
      ).toEqual({ outcome: 'TRANSITION_REQUIRED' })
      expect(await h.snapshot()).toEqual(before)
      const subject = `new-${randomUUID()}`,
        contact = `${randomUUID()}@example.test`
      const identity = await resolve('apple', subject, contact)
      expect(identity).toMatchObject({
        outcome: 'RESOLVED',
        role: 'USER',
        authorityGeneration: 1,
        accountStatus: 'ACTIVE'
      })
      expect(identity?.userId).not.toBe(f.userId)
      expect(await resolve('apple', subject, contact)).toEqual(identity)
      const after = await h.snapshot()
      expect(after.User?.count).toBe((before.User?.count ?? 0) + 1)
      expect(after.Account?.count).toBe((before.Account?.count ?? 0) + 1)
      for (const table of Object.keys(before).filter(
        (name) => !['User', 'Account'].includes(name)
      ))
        expect(after[table]).toEqual(before[table])
      // Keep the real repository calls inside this rollback and gateway role.
      const learner = await h.fixture('google', 'USER')
      const beforeSignIn = await h.snapshot()
      const authorizationSql = `SELECT 'Session' AS kind,s.id,md5(to_jsonb(s)::text) AS fingerprint FROM "Session" s
        UNION ALL SELECT 'AuthSessionFamily' AS kind,f.id,md5(to_jsonb(f)::text) AS fingerprint FROM "AuthSessionFamily" f ORDER BY kind,id`
      const authorizationBefore = (
        await h.owner.query<{ kind: string; id: string; fingerprint: string }>(
          authorizationSql
        )
      ).rows
      const gatewayQuery = async (sql: string, ...values: unknown[]) =>
        (await h.roleQuery('nihongo_auth_gateway', sql, values)).rows
      const repository = createSsoIdentityRepository({
        $queryRawUnsafe: gatewayQuery
      } as unknown as Pick<PrismaClient, '$queryRawUnsafe'>)
      const newAuthorizations = new Set<string>()
      const tokens = new Set<string>()
      for (const attempt of [1, 2]) {
        const signedIn = await repository.signIn(
          {
            provider: 'google',
            accountId: learner.subject,
            email: `${randomUUID()}@example.test`,
            name: 'SSO session bridge fixture'
          },
          { ipAddress: '127.0.0.1', userAgent: 'sso-db-session-bridge' }
        )
        expect(signedIn.kind).toBe('SESSION_CONFIRMED')
        if (signedIn.kind !== 'SESSION_CONFIRMED')
          throw new Error('SSO bridge session was not confirmed.')
        expect(tokens.has(signedIn.token)).toBe(false)
        tokens.add(signedIn.token)
        const issued = await h.owner.query<{ id: string; familyId: string }>(
          `SELECT s.id,s."sessionFamilyId" AS "familyId",s."userId",u.role::text AS role,
          u."accountStatus"::text AS "accountStatus",s."authorityGeneration",u."authorityGeneration" AS "userGeneration",
          s."issuerProtocolVersion"::text AS "issuerProtocolVersion",s."authorizationState"::text AS "authorizationState",
          family.status::text AS "familyStatus",s."createdAt",s."expiresAt"
          FROM "Session" s JOIN "User" u ON u.id=s."userId"
          JOIN "AuthSessionFamily" family ON family.id=s."sessionFamilyId" AND family."userId"=s."userId"
          WHERE s.token=$1`,
          [signedIn.token]
        )
        expect(issued.rows).toHaveLength(1)
        expect(issued.rows[0]).toMatchObject({
          userId: learner.userId,
          role: 'USER',
          accountStatus: 'ACTIVE',
          authorityGeneration: 1,
          userGeneration: 1,
          issuerProtocolVersion: 'PHASE7_V1',
          authorizationState: 'ACTIVE',
          familyStatus: 'ACTIVE',
          createdAt: signedIn.createdAt,
          expiresAt: signedIn.expiresAt
        })
        const session = issued.rows[0]
        if (!session) throw new Error('SSO bridge session row unavailable.')
        newAuthorizations.add(`Session:${session.id}`)
        newAuthorizations.add(`AuthSessionFamily:${session.familyId}`)
        expect(newAuthorizations.size).toBe(attempt * 2)
        const authorizationAfter = (
          await h.owner.query<(typeof authorizationBefore)[number]>(
            authorizationSql
          )
        ).rows
        expect(authorizationAfter).toHaveLength(
          authorizationBefore.length + attempt * 2
        )
        expect(
          authorizationAfter.filter(
            (row) => !newAuthorizations.has(`${row.kind}:${row.id}`)
          )
        ).toEqual(authorizationBefore)
        expect(await h.snapshot()).toEqual(beforeSignIn)
      }
      await h.owner.query('SET CONSTRAINTS ALL IMMEDIATE')
    })
  })

  it.each(['apple', 'google'] as const)(
    '%s ADMIN_FRESH atomically binds original session/user/gen/provider and preserves populated learning facts',
    async (provider) => {
      type Sso6Stage =
        | 'TX_BEGIN'
        | 'SESSION_FIXTURE'
        | 'LEARNING_FIXTURE'
        | 'BASELINE'
        | 'OLD_NOT_FRESH'
        | 'PREPARE_STAGE'
        | 'CONTEXT_BINDING'
        | 'ROTATE'
        | 'ROTATION_FACTS_FRESH'
        | 'DATA_UNCHANGED'
        | 'AUDIT'
        | 'REPLAY'
        | 'FINAL_CONSTRAINTS'
        | 'TX_ROLLBACK'
      const sso6Enabled =
        provider === 'apple' && process.env.PHASE7_DB_CASE === 'sso-ordinal6'
      let sso6Stage: Sso6Stage = 'TX_BEGIN'
      let sso6LineCount = 0
      let sso6FailureEmitted = false
      const sso6Emit = (state: 'BEGIN' | 'COMPLETE' | 'FAILED') => {
        if (!sso6Enabled || sso6LineCount >= 29) return
        sso6LineCount += 1
        try {
          process.stdout.write(
            `${JSON.stringify({
              event: 'phase7.db.integration.post_seed',
              stage: `SSO6_${sso6Stage}_${state}`
            })}\n`
          )
        } catch {
          // Diagnostic output must not change the test failure.
        }
      }
      const sso6Begin = (stage: Sso6Stage) => {
        sso6Stage = stage
        sso6Emit('BEGIN')
      }
      const sso6Complete = () => sso6Emit('COMPLETE')
      const sso6Failed = () => {
        if (sso6FailureEmitted) return
        sso6FailureEmitted = true
        sso6Emit('FAILED')
      }
      sso6Begin('TX_BEGIN')
      try {
        await h.rollback(async () => {
          sso6Complete()
          try {
            sso6Begin('SESSION_FIXTURE')
            const f = await h.fixture(provider)
            sso6Complete()
            sso6Begin('LEARNING_FIXTURE')
            await h.learningFixture(f.userId)
            sso6Complete()
            sso6Begin('BASELINE')
            const before = await h.snapshot()
            for (const table of [
              'StudySession',
              'StudySessionQuestion',
              'StudyDraft',
              'StudyDraftAnswer',
              'StudyAnswer',
              'StudyResult',
              'WrongNote',
              'ReviewSchedule',
              'ReviewEvent',
              'Bookmark'
            ])
              expect(before[table]?.count).toBeGreaterThan(0)
            sso6Complete()
            sso6Begin('OLD_NOT_FRESH')
            expect(await fresh(f.token)).toBe(false)
            sso6Complete()
            sso6Begin('PREPARE_STAGE')
            const { context, proof } = await staged(f)
            sso6Complete()
            sso6Begin('CONTEXT_BINDING')
            expect(context).toMatchObject({
              userId: f.userId,
              sessionId: f.sessionId,
              authorityGeneration: 1,
              provider,
              accountId: f.subject
            })
            sso6Complete()
            sso6Begin('ROTATE')
            const next = await h.rotate(f, proof)
            sso6Complete()
            sso6Begin('ROTATION_FACTS_FRESH')
            expect(await h.facts(f)).toEqual(expectedRotation)
            expect(await fresh(f.token)).toBe(false)
            expect(await fresh(next.token)).toBe(true)
            sso6Complete()
            sso6Begin('DATA_UNCHANGED')
            expect(await h.snapshot()).toEqual(before)
            sso6Complete()
            sso6Begin('AUDIT')
            const audit = await h.owner.query<{
              command: string
              afterState: string
              changedFields: unknown
              metadata: unknown
              verified: boolean
            }>(
              `SELECT command::text,"afterState","changedFields",metadata,"contentDigest"="phase7_admin_audit_content_digest"("operationId",command,"targetType","targetId","beforeState","afterState","beforeRowVersion","afterRowVersion","changedFields",metadata) AS verified FROM "AdminAuditLog" WHERE "actorId"=$1 AND command='REAUTHENTICATION'`,
              [f.userId]
            )
            expect(audit.rows).toEqual([
              {
                command: 'REAUTHENTICATION',
                afterState: 'SESSION_FRESH',
                changedFields: ['SESSION_ROTATION'],
                metadata: {
                  kind: 'REAUTHENTICATION_V1',
                  rotation: 'OLD_REVOKED_NEW_ISSUED'
                },
                verified: true
              }
            ])
            sso6Complete()
            sso6Begin('REPLAY')
            expect(
              (
                await h.roleQuery(
                  'nihongo_auth_gateway',
                  h.completeSql,
                  h.completeValues(f, proof).values
                )
              ).rowCount
            ).toBe(0)
            expect(await h.facts(f)).toEqual(expectedRotation)
            sso6Complete()
            sso6Begin('FINAL_CONSTRAINTS')
            await h.owner.query('SET CONSTRAINTS ALL IMMEDIATE')
            sso6Complete()
          } catch (sso6Error: unknown) {
            sso6Failed()
            throw sso6Error
          }
          sso6Begin('TX_ROLLBACK')
        })
        sso6Complete()
      } catch (sso6Error: unknown) {
        sso6Failed()
        throw sso6Error
      }
    },
    30_000
  )

  it('missing/USER/unlinked providers cannot prepare; a second session of the same ADMIN cannot finish the first proof', async () => {
    await h.rollback(async () => {
      const f = await h.fixture()
      const learner = await h.fixture('google', 'USER')
      for (const [token, provider] of [
        [f.token, 'apple'],
        [learner.token, 'google'],
        ['absent', 'google'],
        [f.token, 'credential']
      ])
        expect(
          (
            await h.roleQuery<{ value: unknown }>(
              'nihongo_auth_gateway',
              'SELECT "phase7_prepare_sso_admin_fresh"($1,$2) AS value',
              [token, provider]
            )
          ).rows[0]?.value
        ).toBeNull()
      const { proof } = await staged(f)
      const other = h.completeValues(f, proof)
      await h.roleQuery(
        'nihongo_auth_gateway',
        `SELECT * FROM "phase7_issue_v1_session"($1,1,'ADMIN','ACTIVE',$2,$3,'127.0.0.1','second-session',false)`,
        [f.userId, randomUUID(), other.token]
      )
      const result = await h.roleQuery('nihongo_auth_gateway', h.completeSql, [
        proof,
        other.token,
        randomUUID(),
        randomBytes(32).toString('base64url'),
        '127.0.0.1',
        'test'
      ])
      expect(result.rowCount).toBe(0)
      expect((await h.facts(f))?.oldSessions).toBe(1)
      expect((await h.facts(f))?.fences).toBe(0)
    })
  })

  it.each([
    'userId',
    'sessionId',
    'authorityGeneration',
    'provider',
    'accountId'
  ] as const)(
    'forged %s context or a different provider/sub cannot stage proof',
    async (key) => {
      await h.rollback(async () => {
        const f = await h.fixture()
        const context = await h.prepare(f)
        const forged = {
          ...context,
          [key]:
            key === 'authorityGeneration'
              ? 2
              : key === 'provider'
                ? 'apple'
                : key === 'accountId'
                  ? 'another-subject'
                  : randomUUID()
        }
        expect((await h.stage(forged)).accepted).toBe(false)
        expect(
          (await h.stage(context, digest(), 'apple', context.accountId))
            .accepted
        ).toBe(false)
        expect(
          (await h.stage(context, digest(), 'google', 'another-subject'))
            .accepted
        ).toBe(false)
        expect(await h.facts(f)).toEqual(unchangedSession)
      })
    }
  )

  it.each(['role', 'generation', 'link', 'family', 'session'] as const)(
    '%s lost after proof issuance rejects finalization without rotating',
    async (change) => {
      await h.rollback(async () => {
        const f = await h.fixture()
        const { proof } = await staged(f)
        const changes = {
          role: ['UPDATE "User" SET role=\'USER\' WHERE id=$1', f.userId],
          generation: [
            'UPDATE "User" SET "authorityGeneration"=2 WHERE id=$1',
            f.userId
          ],
          link: ['DELETE FROM "Account" WHERE "userId"=$1', f.userId],
          family: [
            'UPDATE "AuthSessionFamily" SET status=\'REVOKED\',"revokedAt"=clock_timestamp() WHERE id=$1',
            f.familyId
          ],
          session: [
            'UPDATE "Session" SET "expiresAt"=clock_timestamp() WHERE id=$1',
            f.sessionId
          ]
        } as const
        await h.fixtureMutation(changes[change][0], [changes[change][1]])
        expect(
          (
            await h.roleQuery(
              'nihongo_auth_gateway',
              h.completeSql,
              h.completeValues(f, proof).values
            )
          ).rowCount
        ).toBe(0)
        expect((await h.facts(f))?.oldSessions).toBe(1)
        expect((await h.facts(f))?.fences).toBe(0)
        expect((await h.facts(f))?.audits).toBe(0)
      })
    }
  )

  it('fresh transaction nonce/PKCE context is single-use; the two-minute boundary is closed', async () => {
    await h.rollback(async () => {
      const f = await h.fixture()
      const context = await h.prepare(f)
      const state = digest(),
        binding = digest()
      const created = await h.roleQuery<{ ok: boolean }>(
        'nihongo_auth_gateway',
        'SELECT "phase7_create_sso_admin_fresh_transaction"($1,$2,$3,$4,$5,$6,$7::jsonb) AS ok',
        [
          f.provider,
          state,
          binding,
          'n'.repeat(43),
          'v'.repeat(86),
          '/login',
          JSON.stringify(context)
        ]
      )
      expect(created.rows[0]?.ok).toBe(true)
      const lifetime = await h.owner.query<{ valid: boolean }>(
        `SELECT "expiresAt">"createdAt" AND "expiresAt"<="createdAt"+interval '2 minutes' AS valid FROM "SsoAdminFreshTransaction" WHERE "stateDigest"=$1`,
        [state]
      )
      expect(lifetime.rows).toEqual([{ valid: true }])
      const consume = (b: string) =>
        h.roleQuery(
          'nihongo_auth_gateway',
          'SELECT * FROM "phase7_consume_sso_admin_fresh_transaction"($1,$2,$3)',
          [f.provider, state, b]
        )
      expect((await consume(digest())).rowCount).toBe(0)
      const row = (await consume(binding)).rows[0]
      expect(row).toMatchObject({
        provider: f.provider,
        nonce: 'n'.repeat(43),
        codeVerifier: 'v'.repeat(86),
        callbackURL: '/login',
        context
      })
      expect((await consume(binding)).rowCount).toBe(0)
      await h.fixtureMutation(
        `UPDATE "Phase7ReauthenticationIntent" SET "createdAt"=clock_timestamp()-interval '2 minutes',"expiresAt"=clock_timestamp()-interval '1 millisecond' WHERE id=$1`,
        [context.intentId]
      )
      expect((await h.stage(context)).accepted).toBe(false)
      expect(await h.facts(f)).toEqual(unchangedSession)
    })
  })

  it('proof expiry and exact five-minute freshness boundaries fail closed; ordinary LOGIN has no fresh assurance', async () => {
    await h.rollback(async () => {
      const f = await h.fixture()
      const { proof } = await staged(f)
      await h.fixtureMutation(
        `UPDATE "SsoAdminFreshProof" SET "createdAt"=clock_timestamp()-interval '2 minutes',"expiresAt"=clock_timestamp()-interval '1 millisecond' WHERE "proofDigest"=$1`,
        [proof]
      )
      expect(
        (
          await h.roleQuery(
            'nihongo_auth_gateway',
            h.completeSql,
            h.completeValues(f, proof).values
          )
        ).rowCount
      ).toBe(0)
      expect(await h.facts(f)).toEqual(unchangedSession)
    })
    await h.rollback(async () => {
      const f = await h.fixture()
      const { proof } = await staged(f)
      const next = await h.rotate(f, proof)
      expect(await fresh(next.token)).toBe(true)
      await h.fixtureMutation(
        `UPDATE "Session" SET "createdAt"=clock_timestamp()-interval '5 minutes' WHERE id=$1`,
        [next.id]
      )
      expect(await fresh(next.token)).toBe(false)
    })
    await h.rollback(async () => {
      const f = await h.fixture()
      const { proof } = await staged(f)
      const next = await h.rotate(f, proof)
      await h.fixtureMutation(
        `UPDATE "SsoAdminFreshProof" SET "createdAt"=clock_timestamp()-interval '5 minutes',"completedAt"=clock_timestamp()-interval '5 minutes',"expiresAt"=clock_timestamp()+interval '1 minute' WHERE "proofDigest"=$1`,
        [proof]
      )
      expect(await fresh(next.token)).toBe(false)
    })
  })

  it('new SSO deferred operation guard rechecks expired assurance after successful admission', async () => {
    await h.rollback(async () => {
      await h.owner.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
      const f = await h.fixture()
      const { proof } = await staged(f)
      const next = await h.rotate(f, proof)
      await h.owner.query(
        'SET CONSTRAINTS "Phase7OperationIntent_must_finish" DEFERRED'
      )
      const begin = `SELECT * FROM "phase7_begin_admin_operation"('EXPORT',$1,$2,'TEST',ARRAY[$3]::uuid[])`
      await h.rejects(
        'nihongo_app',
        begin,
        [f.token, randomUUID(), f.userId],
        '42501'
      )
      expect(
        (
          await h.roleQuery('nihongo_app', begin, [
            next.token,
            randomUUID(),
            f.userId
          ])
        ).rowCount
      ).toBe(1)
      await h.fixtureMutation(
        `UPDATE "SsoAdminFreshProof" SET "expiresAt"=clock_timestamp() WHERE "proofDigest"=$1`,
        [proof]
      )
      await h.rejects(
        'nihongo_app',
        'SET CONSTRAINTS "Phase7OperationIntent_sso_fresh_commit" IMMEDIATE',
        [],
        '42501'
      )
    })
  })

  it('separate gateway connections race callback consumption and finalization: exactly one winner and audit/fence', async () => {
    const f = await committedFixture()
    const context = await h.prepare(f)
    const state = digest(),
      binding = digest()
    await h.roleQuery(
      'nihongo_auth_gateway',
      'SELECT "phase7_create_sso_admin_fresh_transaction"($1,$2,$3,$4,$5,$6,$7::jsonb)',
      [
        f.provider,
        state,
        binding,
        'n'.repeat(43),
        'v'.repeat(86),
        '/login',
        JSON.stringify(context)
      ]
    )
    const callbacks = await Promise.all(
      [h.gatewayA, h.gatewayB].map((client) =>
        client.query(
          'SELECT * FROM "phase7_consume_sso_admin_fresh_transaction"($1,$2,$3)',
          [f.provider, state, binding]
        )
      )
    )
    expect(callbacks.map((r) => r.rowCount).toSorted()).toEqual([0, 1])
    const { proof, accepted } = await h.stage(context)
    expect(accepted).toBe(true)
    const candidates = [h.completeValues(f, proof), h.completeValues(f, proof)]
    const rotations = await Promise.all(
      [h.gatewayA, h.gatewayB].map((client, i) =>
        client.query(h.completeSql, candidates[i]?.values)
      )
    )
    expect(rotations.map((r) => r.rowCount).toSorted()).toEqual([0, 1])
    expect(await h.facts(f)).toEqual(expectedRotation)
  })

  it.each(['lost-response', 'unknown'] as const)(
    '%s after real SQL commit reconciles or stays fail-closed without compensation',
    async (mode) => {
      const f = await committedFixture()
      const { proof } = await staged(f)
      const before = await h.snapshot()
      let completed = false,
        cancelled = false
      const query = async (
        sql: string,
        ...values: unknown[]
      ): Promise<unknown> => {
        if (sql.includes('cancel_sso')) cancelled = true
        if (sql.includes('reconcile_sso') && mode === 'unknown')
          throw new Error('Injected reconciliation transport unavailable.')
        const result = await h.gatewayA.query(sql, values)
        if (sql.includes('complete_sso')) {
          completed = true
          throw new Error(
            'Injected return loss after successful PostgreSQL commit.'
          )
        }
        return result.rows
      }
      const port = createSsoAdminFreshRepository({
        $queryRawUnsafe: query
      } as unknown as Pick<PrismaClient, '$queryRawUnsafe'>)
      if (mode === 'unknown')
        await expect(
          port.complete(proof, f.token, {
            ipAddress: '127.0.0.1',
            userAgent: 'test'
          })
        ).rejects.toThrow('commit outcome is unknown')
      else {
        const result = await port.complete(proof, f.token, {
          ipAddress: '127.0.0.1',
          userAgent: 'test'
        })
        expect(result?.userId).toBe(f.userId)
        expect(result && (await fresh(result.token))).toBe(true)
      }
      expect(completed).toBe(true)
      expect(cancelled).toBe(false)
      expect(await h.facts(f)).toEqual(expectedRotation)
      expect(await h.snapshot()).toEqual(before)
      expect(
        (
          await h.roleQuery<{ cancelled: boolean }>(
            'nihongo_auth_gateway',
            'SELECT "phase7_cancel_sso_admin_fresh_proof"($1) AS cancelled',
            [proof]
          )
        ).rows[0]?.cancelled
      ).toBe(false)
      expect(await h.facts(f)).toEqual(expectedRotation)
    }
  )

  it('a forced failure after native finalize rolls back fence/audit/session atomically before repository compensation', async () => {
    const f = await committedFixture()
    const { proof } = await staged(f)
    const before = await h.snapshot()
    await h.owner.query(
      `CREATE FUNCTION sso_test_reject_completion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD."proofDigest"=TG_ARGV[0] THEN RAISE EXCEPTION 'Injected SSO completion rollback' USING ERRCODE='P0001'; END IF; RETURN NEW; END $$`
    )
    await h.owner.query(
      `CREATE TRIGGER sso_test_reject_completion BEFORE UPDATE ON "SsoAdminFreshProof" FOR EACH ROW EXECUTE FUNCTION sso_test_reject_completion('${proof}')`
    )
    try {
      const query = async (sql: string, ...values: unknown[]) =>
        (await h.gatewayA.query(sql, values)).rows
      const port = createSsoAdminFreshRepository({
        $queryRawUnsafe: query
      } as unknown as Pick<PrismaClient, '$queryRawUnsafe'>)
      await expect(
        port.complete(proof, f.token, {
          ipAddress: '127.0.0.1',
          userAgent: 'test'
        })
      ).rejects.toThrow('rotation unavailable')
      expect(await h.facts(f)).toEqual(unchangedSession)
      expect(await h.snapshot()).toEqual(before)
      expect(
        (
          await h.owner.query(
            `SELECT count(*)::int AS count FROM "SsoAdminFreshProof" WHERE "proofDigest"=$1`,
            [proof]
          )
        ).rows
      ).toEqual([{ count: 0 }])
    } finally {
      await h.owner.query(
        'DROP TRIGGER sso_test_reject_completion ON "SsoAdminFreshProof"'
      )
      await h.owner.query('DROP FUNCTION sso_test_reject_completion()')
    }
  })

  it('cancel is idempotent and erasure invalidates pending proof without granting a new identity', async () => {
    await h.rollback(async () => {
      const f = await h.fixture()
      const { context, proof } = await staged(f)
      const before = await h.snapshot()
      expect(
        (
          await h.roleQuery<{ ok: boolean }>(
            'nihongo_auth_gateway',
            'SELECT "phase7_cancel_sso_admin_fresh_proof"($1) AS ok',
            [proof]
          )
        ).rows[0]?.ok
      ).toBe(true)
      expect(
        (
          await h.roleQuery<{ ok: boolean }>(
            'nihongo_auth_gateway',
            'SELECT "phase7_cancel_sso_admin_fresh_proof"($1) AS ok',
            [proof]
          )
        ).rows[0]?.ok
      ).toBe(true)
      expect(
        (
          await h.roleQuery(
            'nihongo_auth_gateway',
            h.completeSql,
            h.completeValues(f, proof).values
          )
        ).rowCount
      ).toBe(0)
      expect(await h.facts(f)).toEqual(unchangedSession)
      expect(await h.snapshot()).toEqual(before)
      expect(
        (
          await h.owner.query(
            'SELECT id FROM "Phase7ReauthenticationIntent" WHERE id=$1',
            [context.intentId]
          )
        ).rowCount
      ).toBe(0)
    })
    await h.rollback(async () => {
      const f = await h.fixture()
      await h.learningFixture(f.userId)
      const { proof } = await staged(f)
      const before = await h.snapshot()
      expect(
        (
          await h.roleQuery<{ erased: boolean }>(
            'nihongo_erasure_worker',
            'SELECT "phase7_erase_user"($1,\'TEST\') AS erased',
            [f.userId]
          )
        ).rows[0]?.erased
      ).toBe(true)
      expect(
        (
          await h.roleQuery(
            'nihongo_auth_gateway',
            h.completeSql,
            h.completeValues(f, proof).values
          )
        ).rowCount
      ).toBe(0)
      expect(await fresh(f.token)).toBe(false)
      const after = await h.snapshot()
      for (const [table, delta] of Object.entries({
        User: 1,
        Account: 1,
        StudySession: 2,
        StudySessionQuestion: 2,
        StudyDraft: 1,
        StudyDraftAnswer: 1,
        StudyAnswer: 1,
        StudyResult: 1,
        WrongNote: 1,
        ReviewSchedule: 1,
        ReviewEvent: 1,
        Bookmark: 1,
        IdempotencyRecord: 1
      }))
        expect(after[table]?.count).toBe((before[table]?.count ?? 0) - delta)
      for (const table of [
        'Question',
        'QuestionVersion',
        'QuestionOption',
        'QuestionVersionTag',
        'Tag',
        'Verification',
        'UserMemo'
      ])
        expect(after[table]).toEqual(before[table])
      // Forward ownership FK cascades the complete proof/context row.
      expect(
        (
          await h.owner.query(
            'SELECT count(*)::int AS count FROM "SsoAdminFreshProof" WHERE "proofDigest"=$1',
            [proof]
          )
        ).rows
      ).toEqual([{ count: 0 }])
      await h.owner.query('SET CONSTRAINTS ALL IMMEDIATE')
    })
  })
  it('LOGIN and ADMIN_FRESH stores never cross-consume and expired LOGIN remains unauthorized', async () => {
    await h.rollback(async () => {
      const f = await h.fixture()
      const context = await h.prepare(f)
      const state = digest(),
        binding = digest()
      await h.roleQuery(
        'nihongo_auth_gateway',
        'SELECT "phase7_create_sso_transaction_v2"($1,$2,$3,$4,$5,$6)',
        [
          f.provider,
          state,
          binding,
          'n'.repeat(43),
          'v'.repeat(86),
          '/practice'
        ]
      )
      expect(
        (
          await h.roleQuery(
            'nihongo_auth_gateway',
            'SELECT * FROM "phase7_consume_sso_admin_fresh_transaction"($1,$2,$3)',
            [f.provider, state, binding]
          )
        ).rowCount
      ).toBe(0)
      await h.roleQuery(
        'nihongo_auth_gateway',
        'SELECT "phase7_create_sso_admin_fresh_transaction"($1,$2,$3,$4,$5,$6,$7::jsonb)',
        [
          f.provider,
          state,
          binding,
          'n'.repeat(43),
          'v'.repeat(86),
          '/login',
          JSON.stringify(context)
        ]
      )
      expect(
        (
          await h.roleQuery(
            'nihongo_auth_gateway',
            'SELECT * FROM "phase7_consume_sso_admin_fresh_transaction"($1,$2,$3)',
            [f.provider, state, binding]
          )
        ).rowCount
      ).toBe(1)
      expect(
        (
          await h.owner.query(
            'SELECT count(*)::int AS count FROM "SsoLoginTransaction" WHERE "stateDigest"=$1',
            [state]
          )
        ).rows
      ).toEqual([{ count: 1 }])
      await h.fixtureMutation(
        `UPDATE "SsoLoginTransaction" SET "createdAt"=clock_timestamp()-interval '10 minutes',"expiresAt"=clock_timestamp()-interval '1 millisecond' WHERE "stateDigest"=$1`,
        [state]
      )
      expect(
        (
          await h.roleQuery(
            'nihongo_auth_gateway',
            'SELECT * FROM "phase7_consume_sso_transaction_v2"($1,$2,$3)',
            [f.provider, state, binding]
          )
        ).rowCount
      ).toBe(0)
      expect(await h.facts(f)).toEqual(unchangedSession)
    })
  })

  it.each(['apple', 'google'] as const)(
    'retained legacy credential does not allow removing sole %s SSO at deferred validation',
    async (provider) => {
      await h.rollback(async () => {
        const f = await h.fixture(provider)
        await h.owner.query(
          `INSERT INTO "Account" (id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES ($1,$2::uuid::text,'credential',$2,'unused-retained-fixture-hash',clock_timestamp(),clock_timestamp())`,
          [randomUUID(), f.userId]
        )
        const before = await h.snapshot()
        await h.owner.query('SAVEPOINT last_sso')
        try {
          await h.owner.query(
            'DELETE FROM "Account" WHERE "userId"=$1 AND "providerId"=$2',
            [f.userId, provider]
          )
          await expect(
            h.owner.query('SET CONSTRAINTS ALL IMMEDIATE')
          ).rejects.toMatchObject({ code: '23514' })
        } finally {
          await h.owner.query('ROLLBACK TO SAVEPOINT last_sso')
          await h.owner.query('RELEASE SAVEPOINT last_sso')
        }
        expect(await h.snapshot()).toEqual(before)
        await h.rejects(
          'nihongo_auth_gateway',
          'DELETE FROM "Account" WHERE "userId"=$1',
          [f.userId],
          '42501'
        )
      })
    }
  )

  it('two owner fixture transactions deleting different SSO methods cannot commit an existing active User without SSO', async () => {
    const f = await committedFixture()
    await h.owner.query(
      `INSERT INTO "Account" (id,"accountId","providerId","userId","createdAt","updatedAt") VALUES ($1,$2,'apple',$3,clock_timestamp(),clock_timestamp())`,
      [randomUUID(), `apple-${randomUUID()}`, f.userId]
    )
    const peer = h.createOwnerPeer()
    await peer.connect()
    try {
      await h.owner.query('BEGIN ISOLATION LEVEL READ COMMITTED')
      await peer.query('BEGIN ISOLATION LEVEL READ COMMITTED')
      await h.owner.query(
        'DELETE FROM "Account" WHERE "userId"=$1 AND "providerId"=\'google\'',
        [f.userId]
      )
      await peer.query(
        'DELETE FROM "Account" WHERE "userId"=$1 AND "providerId"=\'apple\'',
        [f.userId]
      )
      const commits = await Promise.allSettled([
        h.owner.query('COMMIT'),
        peer.query('COMMIT')
      ])
      expect(
        commits.filter((result) => result.status === 'fulfilled')
      ).toHaveLength(1)
      const rejection = commits.find((result) => result.status === 'rejected')
      expect(
        rejection?.status === 'rejected'
          ? (rejection.reason as { code?: unknown }).code
          : undefined
      ).toBe('23514')
      const rows = await h.owner.query<{ active: boolean; methods: number }>(
        `SELECT role='ADMIN' AND "accountStatus"='ACTIVE' AS active,(SELECT count(*)::int FROM "Account" WHERE "userId"=$1 AND "providerId" IN ('apple','google')) AS methods FROM "User" WHERE id=$1`,
        [f.userId]
      )
      expect(rows.rows).toEqual([{ active: true, methods: 1 }])
    } finally {
      await h.owner.query('ROLLBACK')
      await peer.query('ROLLBACK')
      await peer.end()
    }
  })

  it('a real app transaction rolls back its admitted operation when the deferred SSO constraint observes proof expiry', async () => {
    const f = await committedFixture()
    const { proof } = await staged(f)
    const next = await h.rotate(f, proof)
    // Set the expiry before REPEATABLE READ captures its snapshot. Another
    // connection's later UPDATE is invisible to the admitted transaction.
    await h.owner.query(
      `UPDATE "SsoAdminFreshProof" SET "expiresAt"=clock_timestamp()+interval '3 seconds' WHERE "proofDigest"=$1`,
      [proof]
    )
    const before = await h.snapshot()
    await h.app.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
    try {
      const operation = await h.app.query<{ operationId: string }>(
        `SELECT * FROM "phase7_begin_admin_operation"('EXPORT',$1,$2,'TEST',ARRAY[$3]::uuid[])`,
        [next.token, randomUUID(), f.userId]
      )
      const operationId = operation.rows[0]?.operationId
      expect(operationId).toBeDefined()
      expect(operation.rowCount).toBe(1)
      // The database clock advances beyond the recorded deadline; the wait is
      // bounded at 3.05 seconds and does not depend on a JavaScript fake clock.
      await h.owner.query('SELECT pg_sleep(3.05)')
      const expiry = await h.owner.query<{ expired: boolean }>(
        'SELECT "expiresAt"<=clock_timestamp() AS expired FROM "SsoAdminFreshProof" WHERE "proofDigest"=$1',
        [proof]
      )
      expect(expiry.rows).toEqual([{ expired: true }])
      await expect(
        h.app.query(
          'SET CONSTRAINTS "Phase7OperationIntent_sso_fresh_commit" IMMEDIATE'
        )
      ).rejects.toMatchObject({ code: '42501' })
      expect((await h.app.query('COMMIT')).command).toBe('ROLLBACK')
      expect(
        (
          await h.owner.query(
            'SELECT count(*)::int AS count FROM "Phase7OperationIntent" WHERE "operationId"=$1',
            [operationId]
          )
        ).rows
      ).toEqual([{ count: 0 }])
      expect(await h.snapshot()).toEqual(before)
      expect(await h.facts(f)).toEqual(expectedRotation)
      expect(await fresh(next.token)).toBe(false)
    } finally {
      await h.app.query('ROLLBACK')
    }
  }, 10_000)
  it('ERASURE cascades pending transaction context and denies its callback authority', async () => {
    await h.rollback(async () => {
      const f = await h.fixture()
      const context = await h.prepare(f)
      const state = digest(),
        binding = digest()
      const created = await h.roleQuery<{ created: boolean }>(
        'nihongo_auth_gateway',
        'SELECT "phase7_create_sso_admin_fresh_transaction"($1,$2,$3,$4,$5,$6,$7::jsonb) AS created',
        [
          f.provider,
          state,
          binding,
          'n'.repeat(43),
          'v'.repeat(86),
          '/login',
          JSON.stringify(context)
        ]
      )
      expect(created.rows).toEqual([{ created: true }])
      expect(
        (
          await h.owner.query<{ count: number }>(
            `SELECT count(*)::int AS count FROM "SsoAdminFreshTransaction" WHERE "stateDigest"=$1 AND "userId"=$2 AND context=$3::jsonb`,
            [state, f.userId, JSON.stringify(context)]
          )
        ).rows
      ).toEqual([{ count: 1 }])
      expect(
        (
          await h.roleQuery<{ erased: boolean }>(
            'nihongo_erasure_worker',
            'SELECT "phase7_erase_user"($1,\'TEST\') AS erased',
            [f.userId]
          )
        ).rows[0]?.erased
      ).toBe(true)
      const residual = await h.owner.query<{
        count: number
        exactContext: boolean
      }>(
        `SELECT count(*)::int AS count,bool_and(context=$2::jsonb) AS "exactContext" FROM "SsoAdminFreshTransaction" WHERE "stateDigest"=$1`,
        [state, JSON.stringify(context)]
      )
      expect(residual.rows).toEqual([{ count: 0, exactContext: null }])
      expect(
        (
          await h.roleQuery(
            'nihongo_auth_gateway',
            'SELECT * FROM "phase7_consume_sso_admin_fresh_transaction"($1,$2,$3)',
            [f.provider, state, binding]
          )
        ).rowCount
      ).toBe(0)
      expect((await h.stage(context)).accepted).toBe(false)
      expect(
        (
          await h.roleQuery(
            'nihongo_auth_gateway',
            h.completeSql,
            h.completeValues(f, digest()).values
          )
        ).rowCount
      ).toBe(0)
    })
  })
  it('both fresh context tables enforce immediate User FK cascade and exact JSON ownership', async () => {
    const keys = await h.owner.query<{
      table: string
      column: string
      parent: string
      delete: string
      update: string
      validated: boolean
      deferred: boolean
    }>(
      `SELECT child.relname AS table,attribute.attname AS column,parent.relname AS parent,c.confdeltype AS delete,c.confupdtype AS update,c.convalidated AS validated,c.condeferrable AS deferred FROM pg_constraint c JOIN pg_class child ON child.oid=c.conrelid JOIN pg_namespace n ON n.oid=child.relnamespace JOIN pg_class parent ON parent.oid=c.confrelid JOIN pg_attribute attribute ON attribute.attrelid=child.oid AND attribute.attnum=c.conkey[1] WHERE n.nspname=$1 AND c.contype='f' AND child.relname=ANY($2) ORDER BY child.relname`,
      [h.schema, ['SsoAdminFreshTransaction', 'SsoAdminFreshProof']]
    )
    expect(keys.rows).toEqual(
      ['SsoAdminFreshProof', 'SsoAdminFreshTransaction'].map((table) => ({
        table,
        column: 'userId',
        parent: 'User',
        delete: 'c',
        update: 'a',
        validated: true,
        deferred: false
      }))
    )
    await h.rollback(async () => {
      const f = await h.fixture(),
        other = await h.fixture()
      const { proof } = await staged(f)
      await h.owner.query('SAVEPOINT bad_owner')
      await expect(
        h.owner.query(
          'UPDATE "SsoAdminFreshProof" SET "userId"=$1 WHERE "proofDigest"=$2',
          [other.userId, proof]
        )
      ).rejects.toMatchObject({ code: '23514' })
      await h.owner.query('ROLLBACK TO SAVEPOINT bad_owner')
      const absent = randomUUID()
      await expect(
        h.owner.query(
          `INSERT INTO "SsoAdminFreshProof" ("userId","proofDigest",context,"callbackURL","createdAt","expiresAt") SELECT $1::uuid,$2,context||jsonb_build_object('userId',$1::text),"callbackURL","createdAt","expiresAt" FROM "SsoAdminFreshProof" WHERE "proofDigest"=$3`,
          [absent, digest(), proof]
        )
      ).rejects.toMatchObject({ code: '23503' })
      await h.owner.query('ROLLBACK TO SAVEPOINT bad_owner')
      await h.owner.query('RELEASE SAVEPOINT bad_owner')
    })
  })

  it('erasing one User removes its proof/context while preserving another User transaction, completed proof and active fresh session', async () => {
    await h.rollback(async () => {
      const target = await h.fixture(),
        other = await h.fixture()
      const targetProof = await staged(target)
      const otherProof = await staged(other),
        current = await h.rotate(other, otherProof.proof)
      await h.owner.query(
        'SET CONSTRAINTS "Phase7OperationIntent_must_finish" DEFERRED'
      )
      const currentOther = {
        ...other,
        token: current.token,
        sessionId: current.id
      }
      const context = await h.prepare(currentOther),
        state = digest(),
        binding = digest()
      await h.roleQuery(
        'nihongo_auth_gateway',
        'SELECT "phase7_create_sso_admin_fresh_transaction"($1,$2,$3,$4,$5,$6,$7::jsonb)',
        [
          other.provider,
          state,
          binding,
          'n'.repeat(43),
          'v'.repeat(86),
          '/login',
          JSON.stringify(context)
        ]
      )
      const readOther = async () =>
        (
          await h.owner.query(
            `SELECT md5(jsonb_build_object('user',to_jsonb(u),'session',(SELECT to_jsonb(s) FROM "Session" s WHERE s.id=$2),'proof',(SELECT to_jsonb(p) FROM "SsoAdminFreshProof" p WHERE p."userId"=u.id),'transaction',(SELECT to_jsonb(t) FROM "SsoAdminFreshTransaction" t WHERE t."userId"=u.id))::text) AS fingerprint FROM "User" u WHERE u.id=$1`,
            [other.userId, current.id]
          )
        ).rows
      const before = await readOther()
      expect(before).toHaveLength(1)
      expect(await fresh(current.token)).toBe(true)
      expect(
        (
          await h.roleQuery<{ erased: boolean }>(
            'nihongo_erasure_worker',
            'SELECT "phase7_erase_user"($1,\'TEST\') AS erased',
            [target.userId]
          )
        ).rows[0]?.erased
      ).toBe(true)
      expect(
        (
          await h.owner.query(
            `SELECT (SELECT count(*)::int FROM "SsoAdminFreshProof" WHERE "userId"=$1) AS proofs,(SELECT count(*)::int FROM "SsoAdminFreshTransaction" WHERE "userId"=$1) AS transactions`,
            [target.userId]
          )
        ).rows
      ).toEqual([{ proofs: 0, transactions: 0 }])
      expect(
        (
          await h.roleQuery(
            'nihongo_auth_gateway',
            h.completeSql,
            h.completeValues(target, targetProof.proof).values
          )
        ).rowCount
      ).toBe(0)
      expect(await readOther()).toEqual(before)
      expect(await fresh(current.token)).toBe(true)
      expect(
        (
          await h.owner.query(
            `SELECT (SELECT count(*)::int FROM "SsoAdminFreshProof" WHERE "userId"=$1) AS proofs,(SELECT count(*)::int FROM "SsoAdminFreshTransaction" WHERE "userId"=$1) AS transactions`,
            [other.userId]
          )
        ).rows
      ).toEqual([{ proofs: 1, transactions: 1 }])
    })
  })

  it('concurrent fresh transaction creation and erasure cannot leave an orphan context', async () => {
    const f = await committedFixture(),
      context = await h.prepare(f),
      state = digest(),
      binding = digest()
    const outcomes = await Promise.allSettled([
      h.gatewayA.query<{ ok: boolean }>(
        'SELECT "phase7_create_sso_admin_fresh_transaction"($1,$2,$3,$4,$5,$6,$7::jsonb) AS ok',
        [
          f.provider,
          state,
          binding,
          'n'.repeat(43),
          'v'.repeat(86),
          '/login',
          JSON.stringify(context)
        ]
      ),
      h.roleQuery<{ erased: boolean }>(
        'nihongo_erasure_worker',
        'SELECT "phase7_erase_user"($1,\'TEST\') AS erased',
        [f.userId]
      )
    ])
    const creation = outcomes[0],
      erasure = outcomes[1]
    expect(
      erasure?.status === 'fulfilled' && erasure.value.rows[0]?.erased
    ).toBe(true)
    if (creation?.status === 'rejected')
      expect((creation.reason as { code?: unknown }).code).toBe('23503')
    else expect(typeof creation?.value.rows[0]?.ok).toBe('boolean')
    expect(
      (
        await h.owner.query(
          `SELECT (SELECT count(*)::int FROM "User" WHERE id=$1) AS users,(SELECT count(*)::int FROM "SsoAdminFreshTransaction" WHERE "userId"=$1 OR context->>'userId'=$1::text) AS transactions,(SELECT count(*)::int FROM "SsoAdminFreshProof" WHERE "userId"=$1 OR context->>'userId'=$1::text) AS proofs`,
          [f.userId]
        )
      ).rows
    ).toEqual([{ users: 0, transactions: 0, proofs: 0 }])
  })
  it('the exact forward backfill safely removes malformed/orphan contexts and preserves existing User contexts', async () => {
    const sql = readFileSync(
      new URL(
        '../../prisma/migrations/20261019110000_sso_admin_fresh_erasure_ownership/migration.sql',
        import.meta.url
      ),
      'utf8'
    )
    expect(sql.indexOf('LOCK TABLE "User" IN EXCLUSIVE MODE')).toBeLessThan(
      sql.indexOf('ALTER TABLE "SsoAdminFreshTransaction"')
    )
    await h.rollback(async () => {
      const first = await h.fixture(),
        second = await h.fixture()
      const before = await h.snapshot()
      for (const table of ['SsoAdminFreshTransaction', 'SsoAdminFreshProof']) {
        const temporary = `sso_backfill_${randomUUID().replaceAll('-', '_')}`
        await h.owner.query(
          `CREATE TEMP TABLE "${temporary}" (id int PRIMARY KEY,context jsonb,"userId" uuid)`
        )
        const contexts = [
          { userId: first.userId, accountId: first.subject },
          {},
          { userId: 'malformed' },
          { userId: 17 },
          { userId: [first.userId] },
          { userId: randomUUID() },
          { userId: second.userId, accountId: second.subject }
        ]
        for (const [index, context] of contexts.entries())
          await h.owner.query(
            `INSERT INTO "${temporary}" (id,context) VALUES ($1,$2::jsonb)`,
            [index, JSON.stringify(context)]
          )
        const start = sql.indexOf(`DELETE FROM "${table}" AS context_row`)
        const end = sql.indexOf(
          `ALTER TABLE "${table}" ALTER COLUMN "userId" SET NOT NULL;`,
          start
        )
        expect(start).toBeGreaterThan(0)
        expect(end).toBeGreaterThan(start)
        await h.owner.query(
          sql.slice(start, end).replaceAll(`"${table}"`, `"${temporary}"`)
        )
        expect(
          (
            await h.owner.query(
              `SELECT id,context,"userId" FROM "${temporary}" ORDER BY id`
            )
          ).rows
        ).toEqual([
          { id: 0, context: contexts[0], userId: first.userId },
          { id: 6, context: contexts[6], userId: second.userId }
        ])
      }
      expect(await h.snapshot()).toEqual(before)
    })
  })
})

describe('JLP-527 first Google ADMIN operator bootstrap', () => {
  const bootstrapSql =
    'SELECT "phase7_bootstrap_first_google_admin"($1::uuid,$2::text,$3::integer,$4::text,$5::"AdminAuditEnvironment") AS generation'
  const operatorClient = () => {
    const migrationUrl = process.env.PHASE7_MIGRATION_DATABASE_URL
    assertSafePhase7MigrationDatabase({
      nodeEnvironment: h.environment.NODE_ENV,
      migrationDatabaseUrl: migrationUrl,
      runtimeDatabaseUrl: h.environment.DATABASE_URL,
      productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
    })
    if (!migrationUrl) throw new Error('Canonical migration URL required.')
    const url = new URL(migrationUrl)
    const allowed = new Set([
      'schema',
      'options',
      'sslmode',
      'sslrootcert',
      'sslcert',
      'sslkey'
    ])
    if ([...url.searchParams.keys()].some((key) => !allowed.has(key)))
      throw new Error('Connection override refused.')
    url.searchParams.delete('schema')
    url.searchParams.delete('options')
    return new Client({
      connectionString: url.toString(),
      options: createPostgresStartupOptions(
        h.schema,
        'nihongo_phase7_migration'
      ),
      connectionTimeoutMillis: 5000,
      query_timeout: 15000,
      statement_timeout: 10000
    })
  }
  // Executed only by the registered disposable TEST database suite.
  it('enforces the canonical operator, existing identity, session invalidation and serialized first-admin decision', async () => {
    const previous = (
      await h.owner.query<{ id: string }>(
        'SELECT id FROM "User" WHERE role=\'ADMIN\' AND "accountStatus"=\'ACTIVE\' ORDER BY id'
      )
    ).rows.map(({ id }) => id)
    const targets: SsoFixture[] = []
    const erased = new Set<string>()
    const operators: Client[] = []
    const activeAdmins = async () =>
      (
        await h.owner.query<{ id: string }>(
          'SELECT id FROM "User" WHERE role=\'ADMIN\' AND "accountStatus"=\'ACTIVE\' ORDER BY id'
        )
      ).rows.map(({ id }) => id)
    const restorePreviousAdmins = async () => {
      await h.owner.query('BEGIN')
      try {
        await h.fixtureMutation(
          'UPDATE "User" SET role=\'ADMIN\' WHERE id=ANY($1::uuid[])',
          [previous]
        )
        await h.owner.query('COMMIT')
      } catch (error: unknown) {
        await h.owner.query('ROLLBACK')
        throw error
      }
    }
    const values = (f: SsoFixture) => [f.userId, f.subject, 1, h.schema, 'TEST']
    const erase = async (f: SsoFixture) => {
      if (erased.has(f.userId)) return
      await h.roleQuery(
        'nihongo_erasure_worker',
        'SELECT "phase7_erase_user"($1,\'TEST\')',
        [f.userId]
      )
      erased.add(f.userId)
    }
    try {
      await h.owner.query('BEGIN')
      await h.fixtureMutation(
        'UPDATE "User" SET role=\'USER\' WHERE id=ANY($1::uuid[])',
        [previous]
      )
      for (const provider of [
        'google',
        'google',
        'google',
        'apple',
        'google'
      ] as const)
        targets.push(await h.fixture(provider, 'USER'))
      const [first, second, third, apple, inactive] = targets
      if (!first || !second || !third || !apple || !inactive)
        throw new Error('Missing bootstrap fixtures.')
      await h.fixtureMutation(
        'UPDATE "User" SET "accountStatus"=\'DELETION_PENDING\' WHERE id=$1',
        [inactive.userId]
      )
      await h.owner.query('COMMIT')
      expect(await activeAdmins()).toEqual([])
      const counts = async () =>
        (
          await h.owner.query<{ users: number; accounts: number }>(
            'SELECT (SELECT count(*)::int FROM "User") AS users,(SELECT count(*)::int FROM "Account") AS accounts'
          )
        ).rows[0]
      const beforeCounts = await counts()
      const acl = (
        await h.owner.query<{
          owner: string
          config: string[]
          migration: boolean
          app: boolean
          gateway: boolean
          erasure: boolean
          public: boolean
        }>(
          `SELECT r.rolname AS owner,p.proconfig AS config,
        has_function_privilege('nihongo_phase7_migration',p.oid,'EXECUTE') AS migration,
        has_function_privilege('nihongo_app',p.oid,'EXECUTE') AS app,
        has_function_privilege('nihongo_auth_gateway',p.oid,'EXECUTE') AS gateway,
        has_function_privilege('nihongo_erasure_worker',p.oid,'EXECUTE') AS erasure,
        EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
          WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        JOIN pg_roles r ON r.oid=p.proowner
        WHERE p.proname='phase7_bootstrap_first_google_admin' AND n.nspname=$1`,
          [h.schema]
        )
      ).rows
      expect(acl).toEqual([
        {
          owner: 'nihongo_phase7_owner',
          config: ['search_path=pg_catalog, ' + h.schema + ', pg_temp'],
          migration: true,
          app: false,
          gateway: false,
          erasure: false,
          public: false
        }
      ])
      const a = operatorClient(),
        b = operatorClient()
      operators.push(a, b)
      await Promise.all([a.connect(), b.connect()])
      for (const client of operators) {
        const principal = (
          await client.query(`SELECT session_user AS login,current_user AS role,
          current_setting('role') AS effective,current_schema() AS schema,
          current_setting('session_replication_role') AS replication,
          current_setting('transaction_isolation') AS isolation`)
        ).rows
        expect(principal).toEqual([
          {
            login: 'nihongo_test_phase7_migration_login',
            role: 'nihongo_phase7_migration',
            effective: 'nihongo_phase7_migration',
            schema: h.schema,
            replication: 'origin',
            isolation: 'read committed'
          }
        ])
      }
      for (const client of [h.app, h.gatewayA]) {
        await expect(
          client.query(bootstrapSql, values(first))
        ).rejects.toMatchObject({ code: '42501' })
      }
      await expect(
        h.roleQuery('nihongo_phase7_migration', bootstrapSql, values(first))
      ).rejects.toMatchObject({ code: '42501' })
      await a.query('BEGIN ISOLATION LEVEL READ COMMITTED')
      const rejected: [unknown[], string][] = [
        [[first.userId, second.subject, 1, h.schema, 'TEST'], '23514'],
        [[randomUUID(), first.subject, 1, h.schema, 'TEST'], '23514'],
        [[first.userId, first.subject, 2, h.schema, 'TEST'], '23514'],
        [[apple.userId, apple.subject, 1, h.schema, 'TEST'], '23514'],
        [values(inactive), '23514'],
        [
          [first.userId, first.subject, 1, h.schema + '_other', 'TEST'],
          '42501'
        ],
        [[first.userId, first.subject, 1, h.schema, 'DEVELOPMENT'], '42501'],
        [[first.userId, '', 1, h.schema, 'TEST'], '22023']
      ]
      for (const [args, code] of rejected) {
        await a.query('SAVEPOINT refused_bootstrap')
        await expect(a.query(bootstrapSql, args)).rejects.toMatchObject({
          code
        })
        await a.query('ROLLBACK TO SAVEPOINT refused_bootstrap')
        await a.query('RELEASE SAVEPOINT refused_bootstrap')
      }
      await b.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
      await expect(b.query(bootstrapSql, values(first))).rejects.toMatchObject({
        code: '42501'
      })
      await b.query('ROLLBACK')
      expect((await a.query(bootstrapSql, values(first))).rows).toEqual([
        { generation: 2 }
      ])
      await a.query('COMMIT')
      expect(await counts()).toEqual(beforeCounts)
      expect(
        (
          await h.owner.query(
            'SELECT role,"authorityGeneration" AS generation FROM "User" WHERE id=$1',
            [first.userId]
          )
        ).rows
      ).toEqual([{ role: 'ADMIN', generation: 2 }])
      expect(
        (
          await h.owner.query(
            'SELECT "providerId","accountId" FROM "Account" WHERE "userId"=$1',
            [first.userId]
          )
        ).rows
      ).toEqual([{ providerId: 'google', accountId: first.subject }])
      expect(
        (
          await h.owner.query('SELECT id FROM "Session" WHERE "userId"=$1', [
            first.userId
          ])
        ).rows
      ).toEqual([])
      expect(
        (
          await h.owner.query(
            'SELECT status FROM "AuthSessionFamily" WHERE id=$1',
            [first.familyId]
          )
        ).rows
      ).toEqual([{ status: 'REVOKED' }])
      await expect(b.query(bootstrapSql, values(second))).rejects.toMatchObject(
        { code: '42501' }
      )
      await erase(first)
      expect(await activeAdmins()).toEqual([])

      // Observe the loser waiting while the first transition holds its table lock.
      await a.query('BEGIN ISOLATION LEVEL READ COMMITTED')
      await b.query('BEGIN ISOLATION LEVEL READ COMMITTED')
      const aPid = (
        await a.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
      ).rows[0]!.pid
      const bPid = (
        await b.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
      ).rows[0]!.pid
      expect((await a.query(bootstrapSql, values(second))).rows).toEqual([
        { generation: 2 }
      ])
      const competing = b.query(bootstrapSql, values(third)).then(
        () => ({ code: 'UNEXPECTED_SUCCESS' }),
        (error: unknown) => error
      )
      await vi.waitFor(async () => {
        const row = (
          await h.owner.query<{ blockers: number[] }>(
            'SELECT pg_blocking_pids($1) AS blockers',
            [bPid]
          )
        ).rows[0]
        expect(row?.blockers).toContain(aPid)
      })
      await a.query('COMMIT')
      expect(await competing).toMatchObject({ code: '42501' })
      await b.query('ROLLBACK')
      expect(await activeAdmins()).toEqual([second.userId])
      expect(
        (
          await h.owner.query(
            'SELECT role,"authorityGeneration" AS generation FROM "User" WHERE id=$1',
            [third.userId]
          )
        ).rows
      ).toEqual([{ role: 'USER', generation: 1 }])
    } finally {
      // Close operator sessions before owner fixture cleanup, including on assertion failure.
      await Promise.allSettled(
        operators.map(async (client) => {
          try {
            await client.query('ROLLBACK')
          } finally {
            await client.end()
          }
        })
      )
      await h.owner.query('ROLLBACK')
      try {
        for (const target of targets) await erase(target)
      } finally {
        await restorePreviousAdmins()
      }
      expect(await activeAdmins()).toEqual(previous)
    }
  }, 30_000)
})
