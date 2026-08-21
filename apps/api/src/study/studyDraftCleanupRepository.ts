import { Prisma, type PrismaClient } from '../generated/prisma/client.js'

const STUDY_DRAFT_EXPIRY_GRACE_MS = 24 * 60 * 60 * 1_000

export interface StudyDraftCleanupInput {
  readonly batchSize: number
  readonly now: Date
}

export interface StudyDraftCleanupResult {
  readonly expiredDraftBatchLimitReached: boolean
  readonly expiredDraftIdempotencyBatchLimitReached: boolean
  readonly expiredIdempotencyBatchLimitReached: boolean
  readonly expiredRetryIdempotencyBatchLimitReached: boolean
  readonly expiredStudyDraftCount: number
  readonly deletedDraftIdempotencyRecordCount: number
  readonly deletedRetryIdempotencyRecordCount: number
  readonly oldestOverdueExpiresAt: string | null
  readonly overdueStudyDraftCount: number
  readonly idempotencyOperationMetrics: readonly IdempotencyOperationMetric[]
}

export interface IdempotencyOperationMetric {
  readonly activeRecordCount: number
  readonly expiredRecordCount: number
  readonly oldestActiveAgeSeconds: number | null
  readonly oldestExpiredAgeSeconds: number | null
  readonly operation: 'STUDY_DRAFT_SAVE' | 'STUDY_RETRY_CREATE' | 'STUDY_SUBMIT'
}

export interface StudyDraftCleanupRepository {
  cleanupExpiredStudyDrafts: (
    input: StudyDraftCleanupInput
  ) => Promise<StudyDraftCleanupResult>
}

interface CleanupMetricRow {
  oldestOverdueExpiresAt: Date | null
  overdueStudyDraftCount: bigint
}

interface DeletedRow {
  id: string
  operation?: IdempotencyOperationMetric['operation']
}

interface IdempotencyMetricRow {
  activeRecordCount: bigint
  expiredRecordCount: bigint
  oldestActiveAgeSeconds: number | null
  oldestExpiredAgeSeconds: number | null
  operation: IdempotencyOperationMetric['operation']
}

export const createPrismaStudyDraftCleanupRepository = (
  client: PrismaClient
): StudyDraftCleanupRepository => ({
  cleanupExpiredStudyDrafts: async ({ batchSize, now }) => {
    const draftExpirationThreshold = new Date(
      now.getTime() - STUDY_DRAFT_EXPIRY_GRACE_MS
    )
    const metric = await client.$queryRaw<CleanupMetricRow[]>(Prisma.sql`
      SELECT
        COUNT(*)::bigint AS "overdueStudyDraftCount",
        MIN(session."expiresAt") AS "oldestOverdueExpiresAt"
      FROM "StudySession" AS session
      JOIN "StudyDraft" AS draft
        ON draft."studySessionId" = session."id"
      WHERE session."practiceContractVersion" = 2
        AND session."status" = 'IN_PROGRESS'
        AND session."expiresAt" <= ${draftExpirationThreshold}
    `)
    const idempotencyMetrics = await client.$queryRaw<IdempotencyMetricRow[]>(
      Prisma.sql`
        SELECT
          operation.value::text AS "operation",
          COUNT(record."id") FILTER (
            WHERE record."expiresAt" IS NULL OR record."expiresAt" > ${now}
          )::bigint AS "activeRecordCount",
          COUNT(record."id") FILTER (
            WHERE record."expiresAt" IS NOT NULL AND record."expiresAt" <= ${now}
          )::bigint AS "expiredRecordCount",
          CASE
            WHEN COUNT(record."id") FILTER (
              WHERE record."expiresAt" IS NULL OR record."expiresAt" > ${now}
            ) = 0 THEN NULL
            ELSE GREATEST(
              0,
              EXTRACT(EPOCH FROM (
                ${now} - MIN(record."createdAt") FILTER (
                  WHERE record."expiresAt" IS NULL OR record."expiresAt" > ${now}
                )
              ))
            )::double precision
          END AS "oldestActiveAgeSeconds",
          CASE
            WHEN COUNT(record."id") FILTER (
              WHERE record."expiresAt" IS NOT NULL AND record."expiresAt" <= ${now}
            ) = 0 THEN NULL
            ELSE GREATEST(
              0,
              EXTRACT(EPOCH FROM (
                ${now} - MIN(record."createdAt") FILTER (
                  WHERE record."expiresAt" IS NOT NULL AND record."expiresAt" <= ${now}
                )
              ))
            )::double precision
          END AS "oldestExpiredAgeSeconds"
        FROM unnest(enum_range(NULL::"IdempotencyOperation")) AS operation(value)
        LEFT JOIN "IdempotencyRecord" AS record
          ON record."operation" = operation.value
        GROUP BY operation.value
        ORDER BY operation.value::text ASC
      `
    )

    const expiredDrafts = await client.$transaction(
      async (transaction) => {
        const candidates = await transaction.$queryRaw<DeletedRow[]>(Prisma.sql`
          SELECT session."id"
          FROM "StudySession" AS session
          JOIN "StudyDraft" AS draft
            ON draft."studySessionId" = session."id"
          WHERE session."practiceContractVersion" = 2
            AND session."status" = 'IN_PROGRESS'
            AND session."expiresAt" <= ${draftExpirationThreshold}
          ORDER BY session."expiresAt" ASC, session."id" ASC
          LIMIT ${batchSize}
          FOR UPDATE OF session SKIP LOCKED
        `)
        if (candidates.length === 0) {
          return candidates
        }
        const ids = candidates.map(({ id }) => id)
        const expired = await transaction.studySession.updateMany({
          where: {
            id: { in: ids },
            practiceContractVersion: 2,
            status: 'IN_PROGRESS',
            expiresAt: { lte: draftExpirationThreshold }
          },
          data: { status: 'EXPIRED', updatedAt: now }
        })
        const deleted = await transaction.studyDraft.deleteMany({
          where: { studySessionId: { in: ids } }
        })
        if (
          expired.count !== candidates.length ||
          deleted.count !== candidates.length
        ) {
          throw new Error('Expired StudyDraft cleanup lost a locked candidate.')
        }
        return candidates
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
    )

    const deleteExpiredIdempotencyRecords = async (
      operation: 'STUDY_DRAFT_SAVE' | 'STUDY_RETRY_CREATE'
    ): Promise<DeletedRow[]> =>
      await client.$transaction(
        async (transaction) =>
          await transaction.$queryRaw<DeletedRow[]>(Prisma.sql`
          WITH candidates AS MATERIALIZED (
            SELECT record."id"
            FROM "IdempotencyRecord" AS record
            WHERE record."operation" =
                ${operation}::"IdempotencyOperation"
              AND record."state" = 'SUCCEEDED'
              AND record."expiresAt" IS NOT NULL
              AND record."expiresAt" <= ${now}
            ORDER BY record."expiresAt" ASC, record."id" ASC
            LIMIT ${batchSize}
            FOR UPDATE OF record SKIP LOCKED
          )
          DELETE FROM "IdempotencyRecord" AS record
          USING candidates
          WHERE record."id" = candidates."id"
            AND record."operation" =
              ${operation}::"IdempotencyOperation"
            AND record."state" = 'SUCCEEDED'
            AND record."expiresAt" IS NOT NULL
            AND record."expiresAt" <= ${now}
          RETURNING record."id", record."operation"::text AS "operation"
        `)
      )

    const deletedDraftIdempotencyRecords =
      await deleteExpiredIdempotencyRecords('STUDY_DRAFT_SAVE')
    const deletedRetryIdempotencyRecords =
      await deleteExpiredIdempotencyRecords('STUDY_RETRY_CREATE')

    const metricRow = metric[0]
    return {
      expiredDraftBatchLimitReached: expiredDrafts.length === batchSize,
      expiredDraftIdempotencyBatchLimitReached:
        deletedDraftIdempotencyRecords.length === batchSize,
      expiredIdempotencyBatchLimitReached:
        deletedDraftIdempotencyRecords.length === batchSize ||
        deletedRetryIdempotencyRecords.length === batchSize,
      expiredRetryIdempotencyBatchLimitReached:
        deletedRetryIdempotencyRecords.length === batchSize,
      expiredStudyDraftCount: expiredDrafts.length,
      deletedDraftIdempotencyRecordCount: deletedDraftIdempotencyRecords.length,
      deletedRetryIdempotencyRecordCount: deletedRetryIdempotencyRecords.length,
      oldestOverdueExpiresAt:
        metricRow?.oldestOverdueExpiresAt?.toISOString() ?? null,
      overdueStudyDraftCount: Number(metricRow?.overdueStudyDraftCount ?? 0n),
      idempotencyOperationMetrics: idempotencyMetrics.map((row) => ({
        operation: row.operation,
        activeRecordCount: Number(row.activeRecordCount),
        expiredRecordCount: Number(row.expiredRecordCount),
        oldestActiveAgeSeconds: row.oldestActiveAgeSeconds,
        oldestExpiredAgeSeconds: row.oldestExpiredAgeSeconds
      }))
    }
  }
})
