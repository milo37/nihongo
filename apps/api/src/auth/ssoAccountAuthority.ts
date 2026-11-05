import type { Prisma, PrismaClient } from '../generated/prisma/client.js'
import { reauthenticationTokenDigest } from './adminFreshAuthority.js'

/**
 * SSO account fresh, link, unlink and provider cleanup in the API transaction
 * (#504 P7 PR5a).
 *
 * This keeps phase7_prepare_sso_account_fresh/_link,
 * phase7_create/consume_sso_account_fresh_transaction,
 * phase7_stage_sso_account_fresh_proof, phase7_complete_sso_account_fresh/_link,
 * phase7_sso_account_capabilities, phase7_unlink_sso_account and
 * phase7_claim/begin/record_sso_provider_cleanup(s), with their helpers
 * phase7_sso_account_session, phase7_sso_account_context_valid and
 * phase7_sso_account_proof_valid, step for step: the same checks, the same
 * lock order and the same answer. Each call is one transaction, as each SQL
 * function was one statement.
 */

type Transaction = Prisma.TransactionClient
type Client = Pick<PrismaClient, '$transaction'>
export type ProviderCleanupEnvironment = 'TEST' | 'DEVELOPMENT' | 'PRODUCTION'

const SSO_PROVIDERS = ['apple', 'google']

const raise = async (
  transaction: Transaction,
  sqlState: '22023',
  message: string
): Promise<never> => {
  await transaction.$executeRawUnsafe(
    `DO $raise$ BEGIN RAISE EXCEPTION USING ERRCODE = '${sqlState}', MESSAGE = '${message}'; END $raise$`
  )
  throw new Error('PostgreSQL did not raise the SSO account failure.')
}

const requireRuntimeReady = async (transaction: Transaction): Promise<void> => {
  await transaction.$queryRawUnsafe(
    `SELECT "phase7_require_runtime_ready"() AS ready`
  )
}

const requireCapability = async (
  transaction: Transaction,
  environment: ProviderCleanupEnvironment
): Promise<void> => {
  // The check returns void, which Prisma cannot read as a column.
  await transaction.$executeRawUnsafe(
    `SELECT "phase7_require_database_capability"($1::"AdminAuditEnvironment")`,
    environment
  )
}

const isLocalCallback = (callbackURL: string | null): boolean =>
  callbackURL !== null &&
  callbackURL.startsWith('/') &&
  !callbackURL.startsWith('//')

const lockUser = async (
  transaction: Transaction,
  userId: string
): Promise<void> => {
  await transaction.$queryRawUnsafe(
    `SELECT 1 FROM "User" WHERE "id" = $1::uuid FOR UPDATE`,
    userId
  )
}

export interface AccountSessionContext {
  readonly userId: string
  readonly sessionId: string
  readonly role: string
  readonly authorityGeneration: number
  readonly tokenDigest: string
}

/** phase7_sso_account_session: the active V1 Session of a raw token. */
export const accountSessionContext = async (
  transaction: Transaction,
  rawToken: string
): Promise<AccountSessionContext | null> => {
  const rows = await transaction.$queryRawUnsafe<
    Array<{
      authorityGeneration: number
      role: string
      sessionId: string
      token: string
      userId: string
    }>
  >(
    `SELECT u."id" AS "userId", s."id" AS "sessionId", u."role"::text AS role,
       u."authorityGeneration", s."token"
     FROM "Session" s JOIN "User" u ON u."id" = s."userId"
     WHERE s."token" = $1 AND s."issuerProtocolVersion" = 'PHASE7_V1'
       AND s."authorizationState" = 'ACTIVE'
       AND s."authorityGeneration" = u."authorityGeneration"
       AND u."accountStatus" = 'ACTIVE' AND u."deletedAt" IS NULL
       AND s."expiresAt" > clock_timestamp()
       AND s."createdAt" + INTERVAL '30 days' > clock_timestamp()`,
    rawToken
  )
  const row = rows[0]
  if (!row) return null
  return {
    userId: row.userId,
    sessionId: row.sessionId,
    role: row.role,
    authorityGeneration: row.authorityGeneration,
    tokenDigest: reauthenticationTokenDigest(row.token)
  }
}

/**
 * phase7_sso_account_proof_valid: an ACCOUNT_FRESH proof verified in the last
 * 5 minutes, unexpired, and bound to this Session, its User authority and a
 * still linked provider account (phase7_sso_account_context_valid).
 */
export const accountFreshProofIsValid = async (
  transaction: Transaction,
  rawToken: string,
  proofDigest: string | null
): Promise<boolean> => {
  if (proofDigest === null) return false
  const rows = await transaction.$queryRawUnsafe<
    Array<{ tokenDigest: string; token: string }>
  >(
    `SELECT proof."context"->>'tokenDigest' AS "tokenDigest", session."token"
     FROM "SsoAccountFreshProof" AS proof
     JOIN "User" AS target_user
       ON target_user."id" = (proof."context"->>'userId')::uuid
     JOIN "Session" AS session
       ON session."id" = (proof."context"->>'sessionId')::uuid
      AND session."userId" = target_user."id"
     WHERE proof."proofDigest" = $2
       AND proof."context"->>'purpose' = 'ACCOUNT_FRESH'
       AND proof."verifiedAt" IS NOT NULL
       AND proof."verifiedAt" + INTERVAL '5 minutes' > clock_timestamp()
       AND proof."expiresAt" > clock_timestamp()
       AND session."token" = $1
       AND target_user."role"::text = proof."context"->>'role'
       AND target_user."authorityGeneration" =
         (proof."context"->>'authorityGeneration')::integer
       AND proof."context"->>'provider' IN ('apple', 'google')
       AND session."issuerProtocolVersion" = 'PHASE7_V1'
       AND session."authorizationState" = 'ACTIVE'
       AND session."authorityGeneration" = target_user."authorityGeneration"
       AND target_user."accountStatus" = 'ACTIVE'
       AND target_user."deletedAt" IS NULL
       AND session."expiresAt" > clock_timestamp()
       AND session."createdAt" + INTERVAL '30 days' > clock_timestamp()
       AND EXISTS (
         SELECT 1 FROM "Account" AS account
         WHERE account."userId" = target_user."id"
           AND account."providerId" = proof."context"->>'provider'
           AND account."accountId" = proof."context"->>'accountId'
       )`,
    rawToken,
    proofDigest
  )
  return rows.some(
    (row) => reauthenticationTokenDigest(row.token) === row.tokenDigest
  )
}

/**
 * phase7_sso_account_context_valid: the captured Session still holds the
 * context's authority; an ACCOUNT_FRESH context's provider account is still
 * linked and an ACCOUNT_LINK context's fresh proof is still valid.
 */
const contextIsValid = async (
  transaction: Transaction,
  context: string,
  rawToken: string | null = null
): Promise<boolean> => {
  const rows = await transaction.$queryRawUnsafe<
    Array<{ purpose: string | null; token: string; tokenDigest: string | null }>
  >(
    `SELECT s."token", c.v->>'tokenDigest' AS "tokenDigest",
       c.v->>'purpose' AS purpose
     FROM (SELECT $1::jsonb AS v) AS c
     JOIN "User" u ON u."id" = (c.v->>'userId')::uuid
     JOIN "Session" s ON s."userId" = u."id"
     WHERE s."id" = (c.v->>'sessionId')::uuid
       AND u."role"::text = c.v->>'role'
       AND u."authorityGeneration" = (c.v->>'authorityGeneration')::integer
       AND ($2::text IS NULL OR s."token" = $2)
       AND c.v->>'provider' IN ('apple', 'google')
       AND s."issuerProtocolVersion" = 'PHASE7_V1'
       AND s."authorizationState" = 'ACTIVE'
       AND s."authorityGeneration" = u."authorityGeneration"
       AND u."accountStatus" = 'ACTIVE' AND u."deletedAt" IS NULL
       AND s."expiresAt" > clock_timestamp()
       AND s."createdAt" + INTERVAL '30 days' > clock_timestamp()`,
    context,
    rawToken
  )
  const captured = rows.find(
    (row) => reauthenticationTokenDigest(row.token) === row.tokenDigest
  )
  if (!captured) return false
  if (captured.purpose === 'ACCOUNT_FRESH') {
    const linked = await transaction.$queryRawUnsafe<unknown[]>(
      `SELECT 1 FROM (SELECT $1::jsonb AS v) AS c
       JOIN "Account" a ON a."userId" = (c.v->>'userId')::uuid
        AND a."providerId" = c.v->>'provider'
        AND a."accountId" = c.v->>'accountId'`,
      context
    )
    return linked.length > 0
  }
  if (captured.purpose === 'ACCOUNT_LINK') {
    const parsed = JSON.parse(context) as { freshProofDigest?: unknown }
    return accountFreshProofIsValid(
      transaction,
      captured.token,
      typeof parsed.freshProofDigest === 'string'
        ? parsed.freshProofDigest
        : null
    )
  }
  return false
}

export type AccountContextValue = AccountSessionContext & {
  readonly purpose: 'ACCOUNT_FRESH' | 'ACCOUNT_LINK'
  readonly provider: string
  readonly accountId: string | null
  readonly freshProofDigest?: string
}

/** phase7_prepare_sso_account_fresh */
export const prepareAccountFresh = async (
  client: Client,
  rawToken: string,
  provider: string
): Promise<AccountContextValue | null> =>
  client.$transaction(async (transaction) => {
    await requireRuntimeReady(transaction)
    if (!SSO_PROVIDERS.includes(provider)) return null
    const first = await accountSessionContext(transaction, rawToken)
    if (!first) return null
    await lockUser(transaction, first.userId)
    const context = await accountSessionContext(transaction, rawToken)
    if (!context) return null
    const subjects = await transaction.$queryRawUnsafe<
      Array<{ accountId: string | null }>
    >(
      `SELECT min("accountId") AS "accountId" FROM "Account"
       WHERE "userId" = $1::uuid AND "providerId" = $2 HAVING count(*) = 1`,
      context.userId,
      provider
    )
    const accountId = subjects[0]?.accountId ?? null
    if (accountId === null) return null
    return { ...context, purpose: 'ACCOUNT_FRESH', provider, accountId }
  })

/** phase7_prepare_sso_account_link */
export const prepareAccountLink = async (
  client: Client,
  rawToken: string,
  provider: string,
  proofDigest: string | null
): Promise<AccountContextValue | null> =>
  client.$transaction(async (transaction) => {
    await requireRuntimeReady(transaction)
    if (!SSO_PROVIDERS.includes(provider)) return null
    const first = await accountSessionContext(transaction, rawToken)
    if (!first) return null
    await lockUser(transaction, first.userId)
    const context = await accountSessionContext(transaction, rawToken)
    if (
      !context ||
      !(await accountFreshProofIsValid(transaction, rawToken, proofDigest))
    )
      return null
    const linked = await transaction.$queryRawUnsafe<unknown[]>(
      `SELECT 1 FROM "Account" WHERE "userId" = $1::uuid AND "providerId" = $2`,
      context.userId,
      provider
    )
    if (linked.length > 0 || proofDigest === null) return null
    return {
      ...context,
      purpose: 'ACCOUNT_LINK',
      provider,
      accountId: null,
      freshProofDigest: proofDigest
    }
  })

/** phase7_create_sso_account_fresh_transaction */
export const createAccountFreshTransaction = async (
  client: Client,
  input: {
    readonly provider: string
    readonly stateDigest: string
    readonly bindingDigest: string
    readonly nonce: string
    readonly codeVerifier: string
    readonly callbackURL: string | null
    readonly context: string
  }
): Promise<boolean> =>
  client.$transaction(async (transaction) => {
    await requireRuntimeReady(transaction)
    const context = JSON.parse(input.context) as {
      provider?: unknown
      userId?: unknown
    }
    await transaction.$queryRawUnsafe(
      `SELECT 1 FROM "User" WHERE "id" = ($1::jsonb->>'userId')::uuid FOR UPDATE`,
      input.context
    )
    if (
      input.provider !== context.provider ||
      !(await contextIsValid(transaction, input.context)) ||
      !isLocalCallback(input.callbackURL)
    )
      return false
    await transaction.$executeRawUnsafe(
      `DELETE FROM "SsoAccountFreshTransaction"
       WHERE "userId" = ($1::jsonb->>'userId')::uuid
         AND "expiresAt" <= clock_timestamp()`,
      input.context
    )
    await transaction.$executeRawUnsafe(
      `DELETE FROM "SsoAccountFreshProof"
       WHERE "userId" = ($1::jsonb->>'userId')::uuid
         AND "expiresAt" <= clock_timestamp()`,
      input.context
    )
    await transaction.$executeRawUnsafe(
      `WITH event AS (SELECT clock_timestamp()::timestamptz(3) AS at)
       INSERT INTO "SsoAccountFreshTransaction" (
         "provider", "stateDigest", "bindingDigest", "nonce", "codeVerifier",
         "callbackURL", "context", "userId", "createdAt", "expiresAt"
       )
       SELECT $1, $2, $3, $4, $5, $6, $7::jsonb,
         ($7::jsonb->>'userId')::uuid, event.at, event.at + INTERVAL '2 minutes'
       FROM event`,
      input.provider,
      input.stateDigest,
      input.bindingDigest,
      input.nonce,
      input.codeVerifier,
      input.callbackURL,
      input.context
    )
    return true
  })

/** phase7_consume_sso_account_fresh_transaction: one-time use. */
export const consumeAccountFreshTransaction = async (
  client: Client,
  input: {
    readonly provider: string
    readonly stateDigest: string
    readonly bindingDigest: string
    readonly purpose: string
  }
): Promise<unknown[]> =>
  client.$transaction(async (transaction) => {
    await requireRuntimeReady(transaction)
    return transaction.$queryRawUnsafe<unknown[]>(
      `DELETE FROM "SsoAccountFreshTransaction" tx
       WHERE tx."provider" = $1 AND tx."stateDigest" = $2
         AND tx."bindingDigest" = $3 AND tx."context"->>'purpose' = $4
         AND tx."expiresAt" > clock_timestamp()
       RETURNING tx."provider"::text AS "provider", tx."nonce"::text AS "nonce",
         tx."codeVerifier"::text AS "codeVerifier",
         tx."callbackURL"::text AS "callbackURL", tx."context"`,
      input.provider,
      input.stateDigest,
      input.bindingDigest,
      input.purpose
    )
  })

/** phase7_stage_sso_account_fresh_proof */
export const stageAccountFreshProof = async (
  client: Client,
  input: {
    readonly context: string
    readonly provider: string
    readonly subject: string | null
    readonly proofDigest: string
    readonly callbackURL: string | null
  }
): Promise<boolean> =>
  client.$transaction(async (transaction) => {
    await requireRuntimeReady(transaction)
    const context = JSON.parse(input.context) as {
      accountId?: unknown
      provider?: unknown
      purpose?: unknown
    }
    await transaction.$queryRawUnsafe(
      `SELECT 1 FROM "User" WHERE "id" = ($1::jsonb->>'userId')::uuid FOR UPDATE`,
      input.context
    )
    if (
      input.provider !== context.provider ||
      (context.purpose === 'ACCOUNT_FRESH' &&
        input.subject !== context.accountId) ||
      input.subject === null ||
      input.subject.length < 1 ||
      input.subject.length > 255 ||
      !(await contextIsValid(transaction, input.context)) ||
      !isLocalCallback(input.callbackURL)
    )
      return false
    await transaction.$executeRawUnsafe(
      `WITH event AS (SELECT clock_timestamp()::timestamptz(3) AS at)
       INSERT INTO "SsoAccountFreshProof" (
         "proofDigest", "context", "userId", "callbackURL", "createdAt",
         "expiresAt"
       )
       SELECT $1, $2::jsonb || jsonb_build_object('accountId', $3::text),
         ($2::jsonb->>'userId')::uuid, $4, event.at,
         event.at + INTERVAL '2 minutes'
       FROM event`,
      input.proofDigest,
      input.context,
      input.subject,
      input.callbackURL
    )
    return true
  })

interface FreshProofRow {
  readonly callbackURL: string
  readonly context: string
  readonly expired: boolean
  readonly linkAccountId: string | null
  readonly provider: string | null
  readonly purpose: string | null
  readonly userId: string
  readonly verified: boolean
}

const readFreshProof = async (
  transaction: Transaction,
  proofDigest: string,
  lock: boolean
): Promise<FreshProofRow | undefined> =>
  (
    await transaction.$queryRawUnsafe<FreshProofRow[]>(
      `SELECT "userId", "callbackURL", "context"::text AS context,
         "context"->>'purpose' AS purpose, "context"->>'provider' AS provider,
         "context"->>'accountId' AS "linkAccountId",
         "verifiedAt" IS NOT NULL AS verified,
         "expiresAt" <= clock_timestamp() AS expired
       FROM "SsoAccountFreshProof" WHERE "proofDigest" = $1
       ${lock ? 'FOR UPDATE' : ''}`,
      proofDigest
    )
  )[0]

/** phase7_complete_sso_account_fresh */
export const completeAccountFresh = async (
  client: Client,
  proofDigest: string,
  rawToken: string
): Promise<string | null> =>
  client.$transaction(async (transaction) => {
    await requireRuntimeReady(transaction)
    const first = await readFreshProof(transaction, proofDigest, false)
    if (!first) return null
    await lockUser(transaction, first.userId)
    const proof = await readFreshProof(transaction, proofDigest, true)
    if (
      !proof ||
      proof.purpose !== 'ACCOUNT_FRESH' ||
      proof.expired ||
      !(await contextIsValid(transaction, proof.context, rawToken))
    )
      return null
    if (!proof.verified)
      await transaction.$executeRawUnsafe(
        `UPDATE "SsoAccountFreshProof"
         SET "verifiedAt" = clock_timestamp(),
           "expiresAt" = least("createdAt" + INTERVAL '7 minutes',
             clock_timestamp() + INTERVAL '5 minutes')
         WHERE "proofDigest" = $1`,
        proofDigest
      )
    return proof.callbackURL
  })

/** phase7_complete_sso_account_link */
export const completeAccountLink = async (
  client: Client,
  proofDigest: string,
  rawToken: string
): Promise<string | null> =>
  client.$transaction(async (transaction) => {
    await requireRuntimeReady(transaction)
    const first = await readFreshProof(transaction, proofDigest, false)
    if (
      !first ||
      first.purpose !== 'ACCOUNT_LINK' ||
      first.linkAccountId === null
    )
      return null
    // LOGIN uses this exact advisory lock before any User lock too.
    await transaction.$queryRawUnsafe(
      `SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
         'nihongo:sso:' || $1 || ':' || $2, 0)) AS locked`,
      first.provider,
      first.linkAccountId
    )
    const actor = first.userId
    await lockUser(transaction, actor)
    const proof = await readFreshProof(transaction, proofDigest, true)
    if (
      !proof ||
      proof.expired ||
      !(await contextIsValid(transaction, proof.context, rawToken))
    )
      return null
    const taken = await transaction.$queryRawUnsafe<unknown[]>(
      `SELECT 1 FROM "Account"
       WHERE ("providerId" = $2 AND "accountId" = $3)
          OR ("userId" = $1::uuid AND "providerId" = $2)`,
      actor,
      proof.provider,
      proof.linkAccountId
    )
    if (taken.length > 0) return null
    // The Account insert trigger accepts this only with the staged proof.
    await transaction.$executeRawUnsafe(
      `INSERT INTO "Account" (
         "id", "providerId", "accountId", "userId", "createdAt", "updatedAt"
       ) VALUES (
         gen_random_uuid(), $1, $2, $3::uuid, clock_timestamp(), clock_timestamp()
       )`,
      proof.provider,
      proof.linkAccountId,
      actor
    )
    // Explicit linking preserves User.id/role/generation/domain ownership. The
    // linked-provider fresh proof is single use and grants no CMS authority.
    await transaction.$executeRawUnsafe(
      `DELETE FROM "SsoAccountFreshProof"
       WHERE "proofDigest" IN ($1, $2::jsonb->>'freshProofDigest')`,
      proofDigest,
      proof.context
    )
    return proof.callbackURL
  })

/** phase7_sso_account_capabilities */
export const accountCapabilities = async (
  client: Client,
  rawToken: string,
  availableProviders: readonly string[],
  proofDigest: string | null
): Promise<Record<string, unknown> | null> =>
  client.$transaction(async (transaction) => {
    await requireRuntimeReady(transaction)
    const context = await accountSessionContext(transaction, rawToken)
    if (!context) return null
    const actor = context.userId
    const available = [...availableProviders]
    const providers = await transaction.$queryRawUnsafe<
      Array<{ value: unknown }>
    >(
      `SELECT coalesce(jsonb_agg(jsonb_build_object(
         'provider', p.provider,
         'reauthAvailable', p.accounts = 1 AND p.provider = ANY($2::text[]),
         'canUnlink', EXISTS (SELECT 1 FROM "Account" a
           WHERE a."userId" = $1::uuid AND a."providerId" IN ('apple','google')
             AND a."providerId" <> p.provider
             AND a."providerId" = ANY($2::text[])),
         'unlinkBlockedReason', CASE
           WHEN NOT EXISTS (SELECT 1 FROM "Account" a
             WHERE a."userId" = $1::uuid AND a."providerId" IN ('apple','google')
               AND a."providerId" <> p.provider)
             THEN 'LAST_SIGN_IN_METHOD'
           WHEN NOT EXISTS (SELECT 1 FROM "Account" a
             WHERE a."userId" = $1::uuid AND a."providerId" IN ('apple','google')
               AND a."providerId" <> p.provider
               AND a."providerId" = ANY($2::text[]))
             THEN 'PROVIDER_UNAVAILABLE'
           ELSE NULL END
       ) ORDER BY p.provider), '[]'::jsonb) AS value
       FROM (
         SELECT "providerId" AS provider, count(*) AS accounts FROM "Account"
         WHERE "userId" = $1::uuid AND "providerId" IN ('apple','google')
         GROUP BY "providerId"
       ) p`,
      actor,
      available
    )
    const blocked = await transaction.$queryRawUnsafe<
      Array<{ blocked: boolean }>
    >(
      `SELECT EXISTS (SELECT 1 FROM "QuestionVersion"
         WHERE "createdByActorId" = $1::uuid
           AND "status" IN ('DRAFT','IN_REVIEW','CHANGES_REQUESTED','APPROVED')
       ) AS blocked`,
      actor
    )
    const deletionBlocked = blocked[0]?.blocked === true
    const linkable = await transaction.$queryRawUnsafe<
      Array<{ value: unknown }>
    >(
      `SELECT coalesce(jsonb_agg(v ORDER BY v), '[]'::jsonb) AS value
       FROM unnest($2::text[]) v
       WHERE v IN ('apple','google')
         AND NOT EXISTS (SELECT 1 FROM "Account" a
           WHERE a."userId" = $1::uuid AND a."providerId" = v)`,
      actor,
      available
    )
    return {
      providers: providers[0]?.value,
      unlinkRequiresFresh: context.role === 'ADMIN',
      canDelete: !deletionBlocked,
      deletionBlockedReason: deletionBlocked ? 'OPEN_ADMIN_WORK' : null,
      linkableProviders: linkable[0]?.value,
      deleteRequiresFresh: true,
      freshVerified: await accountFreshProofIsValid(
        transaction,
        rawToken,
        proofDigest
      )
    }
  })

/**
 * phase7_unlink_sso_account. The Account delete trigger steps the User
 * authority generation; the User trigger then records the revocation and
 * deletes every Session, as the SQL did itself.
 */
export const unlinkAccount = async (
  client: Client,
  rawToken: string,
  provider: string | null,
  availableProviders: readonly string[],
  proofDigest: string | null
): Promise<{ code: string } | { sessionRevoked: true; unlinked: true }> =>
  client.$transaction(async (transaction) => {
    await requireRuntimeReady(transaction)
    const first = await accountSessionContext(transaction, rawToken)
    if (!first) return { code: 'AUTHENTICATION_REQUIRED' }
    const actor = first.userId
    await lockUser(transaction, actor)
    const context = await accountSessionContext(transaction, rawToken)
    if (!context) return { code: 'AUTHENTICATION_REQUIRED' }
    await transaction.$queryRawUnsafe(
      `SELECT 1 FROM "Account" WHERE "userId" = $1::uuid ORDER BY "id" FOR UPDATE`,
      actor
    )
    const providers = (
      await transaction.$queryRawUnsafe<Array<{ providerId: string }>>(
        `SELECT "providerId" FROM "Account" WHERE "userId" = $1::uuid`,
        actor
      )
    ).map((row) => row.providerId)
    if (
      provider === null ||
      !SSO_PROVIDERS.includes(provider) ||
      !providers.includes(provider)
    )
      return { code: 'SSO_ACCOUNT_NOT_LINKED' }
    const others = providers.filter(
      (other) => SSO_PROVIDERS.includes(other) && other !== provider
    )
    if (others.length === 0) return { code: 'SSO_LAST_SIGN_IN_METHOD' }
    if (!others.some((other) => availableProviders.includes(other)))
      return { code: 'SSO_PROVIDER_UNAVAILABLE' }
    if (
      context.role === 'ADMIN' &&
      !(await accountFreshProofIsValid(transaction, rawToken, proofDigest))
    )
      return { code: 'SSO_FRESH_REQUIRED' }
    await transaction.$queryRawUnsafe(
      `SELECT 1 FROM "Session" WHERE "userId" = $1::uuid ORDER BY "id" FOR UPDATE`,
      actor
    )
    // Records SESSION_INVALIDATED evidence for the active Sessions, steps the
    // generation and deletes every Session of the User (Account trigger).
    await transaction.$executeRawUnsafe(
      `DELETE FROM "Account" WHERE "userId" = $1::uuid AND "providerId" = $2`,
      actor,
      provider
    )
    await transaction.$executeRawUnsafe(
      `DELETE FROM "SsoAccountFreshProof" WHERE "userId" = $1::uuid`,
      actor
    )
    await transaction.$executeRawUnsafe(
      `DELETE FROM "SsoAccountFreshTransaction" WHERE "userId" = $1::uuid`,
      actor
    )
    return { unlinked: true, sessionRevoked: true }
  })

/**
 * phase7_claim_sso_provider_cleanups. A claim also requires the request's
 * User to be DELETION_PENDING (#504 P7 PR5a, QA memo).
 */
export const claimProviderCleanups = async (
  client: Client,
  batchLimit: number,
  leaseSeconds: number,
  environment: ProviderCleanupEnvironment
): Promise<unknown> =>
  client.$transaction(async (transaction) => {
    await requireCapability(transaction, environment)
    if (
      !Number.isInteger(batchLimit) ||
      batchLimit < 1 ||
      batchLimit > 100 ||
      !Number.isInteger(leaseSeconds) ||
      leaseSeconds < 30 ||
      leaseSeconds > 3600
    )
      await raise(transaction, '22023', 'Invalid provider cleanup claim.')
    const rows = await transaction.$queryRawUnsafe<Array<{ result: unknown }>>(
      `WITH claimed AS (
         UPDATE "SsoAccountErasureRequest" r
         SET "leaseToken" = gen_random_uuid(),
           "leaseExpiresAt" = clock_timestamp()
             + pg_catalog.make_interval(secs => $2::integer)
         WHERE r."id" IN (
           SELECT c."id" FROM "SsoAccountErasureRequest" c
           WHERE c."appStatus" = 'DELETION_PENDING'
             AND EXISTS (SELECT 1 FROM "User" u
               WHERE u."id" = c."userId"
                 AND u."accountStatus" = 'DELETION_PENDING')
             AND EXISTS (SELECT 1 FROM jsonb_array_elements(c."providerCleanup") x
               WHERE x->>'status' IS DISTINCT FROM 'COMPLETED')
             AND c."activeProvider" IS NULL
             -- Legacy claims have no token and may already have dispatched:
             -- quarantine.
             AND (c."leaseExpiresAt" IS NULL
               OR (c."leaseToken" IS NOT NULL
                 AND c."leaseExpiresAt" <= clock_timestamp()))
           ORDER BY c."createdAt", c."id" LIMIT $1::integer
           FOR UPDATE SKIP LOCKED
         )
         RETURNING r."leaseToken", r."id", r."userId", r."providerCleanup",
           r."createdAt"
       )
       SELECT coalesce(jsonb_agg(jsonb_build_object(
         'id', c."id", 'leaseToken', c."leaseToken",
         'providers', coalesce((
           SELECT jsonb_agg(jsonb_build_object(
             'provider', x->>'provider', 'subject', a."accountId"
           ) ORDER BY x->>'provider')
           FROM jsonb_array_elements(c."providerCleanup") x
           LEFT JOIN "Account" a
             ON a."userId" = c."userId" AND a."providerId" = x->>'provider'
           WHERE x->>'status' IS DISTINCT FROM 'COMPLETED'
         ), '[]'::jsonb)
       ) ORDER BY c."createdAt", c."id"), '[]'::jsonb) AS result
       FROM claimed c`,
      batchLimit,
      leaseSeconds
    )
    return rows[0]?.result
  })

interface LeasedRequest {
  readonly activeProvider: string | null
  readonly appStatus: string
  readonly leaseLive: boolean | null
  readonly leaseToken: string | null
}

// Lock first, then read the live clock: never the time before the lock wait.
const lockLeasedRequest = async (
  transaction: Transaction,
  requestId: string
): Promise<LeasedRequest | undefined> => {
  await transaction.$queryRawUnsafe(
    `SELECT 1 FROM "SsoAccountErasureRequest" WHERE "id" = $1::uuid FOR UPDATE`,
    requestId
  )
  return (
    await transaction.$queryRawUnsafe<LeasedRequest[]>(
      `SELECT "appStatus"::text AS "appStatus", "leaseToken"::text AS "leaseToken",
         "leaseExpiresAt" > clock_timestamp() AS "leaseLive", "activeProvider"
       FROM "SsoAccountErasureRequest" WHERE "id" = $1::uuid`,
      requestId
    )
  )[0]
}

const leaseHeld = (
  request: LeasedRequest | undefined,
  leaseToken: string | null
): request is LeasedRequest =>
  request !== undefined &&
  request.appStatus === 'DELETION_PENDING' &&
  leaseToken !== null &&
  request.leaseToken === leaseToken &&
  request.leaseLive === true

/** phase7_begin_sso_provider_cleanup */
export const beginProviderCleanup = async (
  client: Client,
  input: {
    readonly requestId: string
    readonly provider: string
    readonly leaseToken: string | null
    readonly environment: ProviderCleanupEnvironment
  }
): Promise<boolean> =>
  client.$transaction(async (transaction) => {
    await requireCapability(transaction, input.environment)
    const request = await lockLeasedRequest(transaction, input.requestId)
    if (
      !leaseHeld(request, input.leaseToken) ||
      request.activeProvider !== null
    )
      return false
    const pending = await transaction.$queryRawUnsafe<unknown[]>(
      `SELECT 1 FROM "SsoAccountErasureRequest" r,
         jsonb_array_elements(r."providerCleanup") x
       WHERE r."id" = $1::uuid AND x->>'provider' = $2
         AND x->>'status' IS DISTINCT FROM 'COMPLETED'`,
      input.requestId,
      input.provider
    )
    if (pending.length === 0) return false
    const updated = await transaction.$executeRawUnsafe(
      `UPDATE "SsoAccountErasureRequest" SET "activeProvider" = $2
       WHERE "id" = $1::uuid AND "leaseExpiresAt" > clock_timestamp()`,
      input.requestId,
      input.provider
    )
    return updated === 1
  })

/** phase7_record_sso_provider_cleanup */
export const recordProviderCleanup = async (
  client: Client,
  input: {
    readonly requestId: string
    readonly provider: string | null
    readonly status: string | null
    readonly leaseToken: string | null
    readonly environment: ProviderCleanupEnvironment
  }
): Promise<boolean> =>
  client.$transaction(async (transaction) => {
    await requireCapability(transaction, input.environment)
    if (
      input.provider === null ||
      !SSO_PROVIDERS.includes(input.provider) ||
      input.status === null ||
      !['COMPLETED', 'FAILED', 'UNAVAILABLE'].includes(input.status)
    )
      return false
    const request = await lockLeasedRequest(transaction, input.requestId)
    if (
      !leaseHeld(request, input.leaseToken) ||
      request.activeProvider !== input.provider
    )
      return false
    const updated = await transaction.$executeRawUnsafe(
      `UPDATE "SsoAccountErasureRequest" SET
         "providerCleanup" = CASE WHEN $3 = 'UNAVAILABLE' THEN "providerCleanup"
           ELSE (
             SELECT jsonb_agg(CASE WHEN x->>'provider' = $2
               THEN jsonb_set(x, '{status}', to_jsonb($3::text)) ELSE x END
               ORDER BY x->>'provider')
             FROM jsonb_array_elements("providerCleanup") x
           ) END,
         -- FAILED may mean the remote server processed a request whose reply
         -- was lost. UNAVAILABLE is permitted only when the adapter sent no
         -- provider request.
         "activeProvider" = CASE WHEN $3 IN ('COMPLETED', 'UNAVAILABLE')
           THEN NULL ELSE "activeProvider" END
       WHERE "id" = $1::uuid AND "leaseToken" = $4::uuid
         AND "leaseExpiresAt" > clock_timestamp()`,
      input.requestId,
      input.provider,
      input.status,
      input.leaseToken
    )
    return updated === 1
  })
