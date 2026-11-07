import { Prisma } from '../generated/prisma/client.js'

/**
 * Expired guest data removal (JLP-534, #504 P3). Runs inside one transaction
 * as the application role; the SQL mirrors the former
 * `guest_cleanup_batch` function.
 */
export interface GuestCleanupBatchResult {
  deletedCount: number
  eligibleCount: number
  hasMore: boolean
}

type Transaction = Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw'>

const RETENTION = Prisma.sql`INTERVAL '7 days'`
const REPLAY_OPERATIONS = Prisma.sql`('STUDY_SUBMIT', 'STUDY_DRAFT_SAVE', 'STUDY_RETRY_CREATE', 'STUDY_TARGETED_REVIEW_CREATE')`
const KIND_ORDER = ['draft', 'session', 'principal', 'idempotency', 'rate']

const RATE_POLICIES: readonly (readonly [string, number])[] = [
  ...[
    'bookmark-list',
    'bookmark-write',
    'dashboard-insights-read',
    'dashboard-read',
    'question-detail-read',
    'question-list-read',
    'study-cancel',
    'study-create',
    'study-draft-save',
    'study-mutation-ip',
    'study-read',
    'study-result-read',
    'study-result-retry',
    'study-submit',
    'wrong-note-detail',
    'wrong-note-history',
    'wrong-note-list',
    'wrong-note-memo-read',
    'wrong-note-memo-write',
    'wrong-note-review-queue',
    'wrong-note-targeted-review'
  ].map((name) => [`application:${name}:`, 60_000] as const),
  ...(
    [
      ['ADMIN_READ', 60_000],
      ['ADMIN_EDIT', 600_000],
      ['ADMIN_SENSITIVE', 900_000],
      ['IMPORT_VALIDATION', 900_000],
      ['REAUTHENTICATION', 900_000],
      ['REPORT_ACTOR', 600_000]
    ] as const
  ).flatMap(([scope, windowMs]) =>
    ['ACTOR', 'IP'].map(
      (subject) => [`application:keyed:${scope}:${subject}:`, windowMs] as const
    )
  ),
  ['application:keyed:REPORT_VERSION:VERSION:', 3_600_000]
]

/** Window of a known rate key, or NULL for keys cleanup must not touch. */
const rateWindow = (key: Prisma.Sql): Prisma.Sql => Prisma.sql`(
  CASE
    WHEN ${key} ~ '^(no-trusted-ip|[0-9a-fA-F:.]+)[|]/(sign-in/email|sign-up/email|request-password-reset|send-verification-email)$'
      THEN 60000::bigint
    ELSE (
      SELECT policy.window_ms FROM (VALUES ${Prisma.join(
        RATE_POLICIES.map(
          ([prefix, windowMs]) => Prisma.sql`(${prefix}, ${windowMs}::bigint)`
        )
      )}) AS policy(prefix, window_ms)
      WHERE left(${key}, length(policy.prefix)) = policy.prefix
        AND substring(${key} FROM length(policy.prefix) + 1) ~ '^[0-9a-f]{64}$'
      LIMIT 1
    )
  END)`

const noOpenReplay = (session: Prisma.Sql, now: Date) => Prisma.sql`
  NOT EXISTS (SELECT 1 FROM "IdempotencyRecord" i WHERE i."studySessionId" = ${session}
    AND (i."state" <> 'SUCCEEDED' OR i."expiresAt" IS NULL OR i."expiresAt" > ${now}))
  AND NOT EXISTS (SELECT 1 FROM "StudySession" retry WHERE retry."retryOfStudySessionId" = ${session})`

const draftSession = (now: Date) => Prisma.sql`
  s."userId" IS NULL AND s."guestPrincipalId" IS NOT NULL
  AND s."practiceContractVersion" = 2 AND s."status" IN ('IN_PROGRESS', 'EXPIRED')
  AND s."expiresAt" <= ${now}::timestamptz - ${RETENTION}
  AND EXISTS (SELECT 1 FROM "StudyDraft" d WHERE d."studySessionId" = s."id")
  AND ${noOpenReplay(Prisma.sql`s."id"`, now)}`

const closedSession = (now: Date) => Prisma.sql`
  s."userId" IS NULL AND s."guestPrincipalId" IS NOT NULL
  AND s."status" <> 'IN_PROGRESS' AND s."expiresAt" <= ${now}::timestamptz - ${RETENTION}
  AND ${noOpenReplay(Prisma.sql`s."id"`, now)}`

const expiredPrincipal = (now: Date) => Prisma.sql`
  g."expiresAt" <= ${now}::timestamptz - ${RETENTION}
  AND NOT EXISTS (SELECT 1 FROM "StudySession" s WHERE s."guestPrincipalId" = g."id")`

const expiredReplay = (now: Date) => Prisma.sql`
  i."state" = 'SUCCEEDED' AND i."expiresAt" IS NOT NULL AND i."expiresAt" <= ${now}
  AND i."operation" IN ${REPLAY_OPERATIONS}
  AND NOT EXISTS (SELECT 1 FROM "StudySession" retry WHERE retry."retryOfStudySessionId" = i."studySessionId"
    AND retry."status" = 'IN_PROGRESS' AND retry."expiresAt" > ${now})`

const expiredRate = (now: Date) => Prisma.sql`
  ${rateWindow(Prisma.sql`r."key"`)} IS NOT NULL
  AND r."lastRequest" >= 0
  AND r."lastRequest" <= floor(EXTRACT(EPOCH FROM ${now}::timestamptz) * 1000)::bigint
    - 604800000 - ${rateWindow(Prisma.sql`r."key"`)}`

const candidates = (now: Date) => Prisma.sql`
  SELECT 'draft'::text AS kind, s."id" FROM "StudySession" s WHERE ${draftSession(now)}
  UNION ALL SELECT 'session', s."id" FROM "StudySession" s WHERE ${closedSession(now)}
  UNION ALL SELECT 'principal', g."id" FROM "GuestPrincipal" g WHERE ${expiredPrincipal(now)}
  UNION ALL SELECT 'idempotency', i."id" FROM "IdempotencyRecord" i WHERE ${expiredReplay(now)}
  UNION ALL SELECT 'rate', r."id" FROM "RateLimit" r WHERE ${expiredRate(now)}`

const countCandidates = async (
  transaction: Transaction,
  now: Date
): Promise<number> => {
  const [row] = await transaction.$queryRaw<{ count: number }[]>`
    SELECT COUNT(*)::int AS "count" FROM (${candidates(now)}) AS candidate`
  return row?.count ?? 0
}

class GuestCleanupAlreadyRunningError extends Error {
  constructor() {
    super('Guest cleanup already running.')
    this.name = 'GuestCleanupAlreadyRunningError'
  }
}

/** Deletes one candidate unless another transaction holds it. */
const deleteCandidate = async (
  transaction: Transaction,
  kind: string,
  id: string,
  now: Date
): Promise<number> => {
  if (kind === 'draft') {
    const [locked] = await transaction.$queryRaw<{ status: string }[]>`
      SELECT s."status"::text AS "status" FROM "StudySession" s
      WHERE s."id" = ${id}::uuid AND ${draftSession(now)}
      FOR UPDATE OF s SKIP LOCKED`
    if (!locked) return 0
    if (locked.status === 'IN_PROGRESS') {
      const expired = await transaction.$executeRaw`
        UPDATE "StudySession" SET "status" = 'EXPIRED', "updatedAt" = ${now}
        WHERE "id" = ${id}::uuid AND "userId" IS NULL AND "guestPrincipalId" IS NOT NULL
          AND "status" = 'IN_PROGRESS' AND "expiresAt" <= ${now}::timestamptz - ${RETENTION}`
      if (expired !== 1) throw new Error('Guest draft candidate changed.')
    }
    const deleted = await transaction.$executeRaw`
      DELETE FROM "StudyDraft" d WHERE d."studySessionId" = ${id}::uuid`
    if (deleted !== 1) throw new Error('Guest draft candidate changed.')
    return deleted
  }
  if (kind === 'session') {
    const [locked] = await transaction.$queryRaw<unknown[]>`
      SELECT 1 FROM "StudySession" s
      WHERE s."id" = ${id}::uuid AND ${closedSession(now)}
      FOR UPDATE OF s SKIP LOCKED`
    if (!locked) return 0
    return await transaction.$executeRaw`
      DELETE FROM "StudySession" s WHERE s."id" = ${id}::uuid AND ${closedSession(now)}`
  }
  if (kind === 'principal') {
    const [locked] = await transaction.$queryRaw<unknown[]>`
      SELECT 1 FROM "GuestPrincipal" g
      WHERE g."id" = ${id}::uuid AND ${expiredPrincipal(now)}
      FOR UPDATE OF g SKIP LOCKED`
    if (!locked) return 0
    return await transaction.$executeRaw`
      DELETE FROM "GuestPrincipal" g WHERE g."id" = ${id}::uuid AND ${expiredPrincipal(now)}`
  }
  if (kind === 'idempotency') {
    const [locked] = await transaction.$queryRaw<unknown[]>`
      SELECT 1 FROM "IdempotencyRecord" i
      JOIN "StudySession" s ON s."id" = i."studySessionId"
      WHERE i."id" = ${id}::uuid AND ${expiredReplay(now)}
      FOR UPDATE OF s, i SKIP LOCKED`
    if (!locked) return 0
    return await transaction.$executeRaw`
      DELETE FROM "IdempotencyRecord" i WHERE i."id" = ${id}::uuid AND ${expiredReplay(now)}`
  }
  const [locked] = await transaction.$queryRaw<unknown[]>`
    SELECT 1 FROM "RateLimit" r WHERE r."id" = ${id}::uuid AND ${expiredRate(now)}
    FOR UPDATE OF r SKIP LOCKED`
  if (!locked) return 0
  return await transaction.$executeRaw`
    DELETE FROM "RateLimit" r WHERE r."id" = ${id}::uuid AND ${expiredRate(now)}`
}

export const runGuestCleanupBatch = async (
  transaction: Transaction,
  { batchSize, dryRun }: { batchSize: number; dryRun: boolean }
): Promise<GuestCleanupBatchResult> => {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new Error('Invalid guest cleanup batch.')
  }
  const [clock] = await transaction.$queryRaw<{ now: Date }[]>`
    SELECT clock_timestamp() AS "now"`
  const now = clock!.now
  if (dryRun) {
    const eligibleCount = await countCandidates(transaction, now)
    return { deletedCount: 0, eligibleCount, hasMore: eligibleCount > 0 }
  }
  const [lock] = await transaction.$queryRaw<{ locked: boolean }[]>`
    SELECT pg_try_advisory_xact_lock(hashtext('nihongo_guest_cleanup')) AS "locked"`
  if (!lock?.locked) throw new GuestCleanupAlreadyRunningError()

  // A locked row must not consume the deletion limit.
  const rows = await transaction.$queryRaw<{ kind: string; id: string }[]>`
    SELECT candidate.kind, candidate."id"::text AS "id"
    FROM (${candidates(now)}) AS candidate`
  rows.sort(
    (left, right) =>
      KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind) ||
      (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  )
  let deletedCount = 0
  for (const { kind, id } of rows) {
    deletedCount += await deleteCandidate(transaction, kind, id, now)
    if (deletedCount >= batchSize) break
  }
  const eligibleCount = await countCandidates(transaction, now)
  return { deletedCount, eligibleCount, hasMore: eligibleCount > 0 }
}
