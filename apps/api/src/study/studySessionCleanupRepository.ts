import { Prisma, type PrismaClient } from '../generated/prisma/client.js'

export interface StudySessionCleanupBatchInput {
  batchSize: number
  now: Date
}

export interface StudySessionCleanupBatchResult {
  deletedGuestPrincipalCount: number
  deletedIdempotencyRecordCount: number
  deletedStudySessionCount: number
  guestPrincipalBatchLimitReached: boolean
  idempotencyRecordBatchLimitReached: boolean
  studySessionBatchLimitReached: boolean
}

export interface StudySessionCleanupRepository {
  cleanupExpiredGuestStudyData: (
    input: StudySessionCleanupBatchInput
  ) => Promise<StudySessionCleanupBatchResult>
}

interface DeletedRow {
  id: string
}

export const createPrismaStudySessionCleanupRepository = (
  client: PrismaClient
): StudySessionCleanupRepository => ({
  cleanupExpiredGuestStudyData: async ({ batchSize, now }) => {
    const guestCleanup = await client.$transaction(async (transaction) => {
      const deletedStudySessions = await transaction.$queryRaw<DeletedRow[]>(
        Prisma.sql`
          WITH guest_candidates AS MATERIALIZED (
            SELECT guest."id"
            FROM "GuestPrincipal" AS guest
            WHERE EXISTS (
              SELECT 1
              FROM "StudySession" AS session
              WHERE session."guestPrincipalId" = guest."id"
                AND session."userId" IS NULL
                AND (
                  (
                    session."status" = 'SUBMITTED'
                    AND session."submittedAt" IS NOT NULL
                    AND session."submittedAt" <=
                      ${now}::timestamptz - INTERVAL '7 days'
                  )
                  OR (
                    session."status" IN (
                      'IN_PROGRESS',
                      'CANCELLED',
                      'EXPIRED'
                    )
                    AND session."expiresAt" <= ${now}
                  )
                )
            )
            ORDER BY guest."id" ASC
            LIMIT ${batchSize}
            FOR NO KEY UPDATE OF guest SKIP LOCKED
          ),
          session_candidates AS MATERIALIZED (
            SELECT session."id"
            FROM "StudySession" AS session
            JOIN guest_candidates AS guest
              ON guest."id" = session."guestPrincipalId"
            WHERE session."userId" IS NULL
              AND session."guestPrincipalId" IS NOT NULL
              AND (
                (
                  session."status" = 'SUBMITTED'
                  AND session."submittedAt" IS NOT NULL
                  AND session."submittedAt" <=
                    ${now}::timestamptz - INTERVAL '7 days'
                )
                OR (
                  session."status" IN (
                    'IN_PROGRESS',
                    'CANCELLED',
                    'EXPIRED'
                  )
                  AND session."expiresAt" <= ${now}
                )
              )
            ORDER BY
              session."guestPrincipalId" ASC,
              COALESCE(session."submittedAt", session."expiresAt") ASC,
              session."id" ASC
            LIMIT ${batchSize}
            FOR UPDATE OF session
          )
          DELETE FROM "StudySession" AS session
          USING session_candidates AS candidates
          WHERE session."id" = candidates."id"
            AND session."userId" IS NULL
            AND session."guestPrincipalId" IS NOT NULL
            AND (
              (
                session."status" = 'SUBMITTED'
                AND session."submittedAt" IS NOT NULL
                AND session."submittedAt" <=
                  ${now}::timestamptz - INTERVAL '7 days'
              )
              OR (
                session."status" IN (
                  'IN_PROGRESS',
                  'CANCELLED',
                  'EXPIRED'
                )
                AND session."expiresAt" <= ${now}
              )
            )
          RETURNING session."id"
        `
      )

      const deletedGuestPrincipals = await transaction.$queryRaw<DeletedRow[]>(
        Prisma.sql`
          WITH candidates AS MATERIALIZED (
            SELECT guest."id"
            FROM "GuestPrincipal" AS guest
            WHERE guest."expiresAt" <= ${now}
              AND NOT EXISTS (
                SELECT 1
                FROM "StudySession" AS session
                WHERE session."guestPrincipalId" = guest."id"
              )
            ORDER BY guest."expiresAt" ASC, guest."id" ASC
            LIMIT ${batchSize}
            FOR UPDATE OF guest SKIP LOCKED
          )
          DELETE FROM "GuestPrincipal" AS guest
          USING candidates
          WHERE guest."id" = candidates."id"
            AND guest."expiresAt" <= ${now}
            AND NOT EXISTS (
              SELECT 1
              FROM "StudySession" AS session
              WHERE session."guestPrincipalId" = guest."id"
            )
          RETURNING guest."id"
        `
      )

      return {
        deletedGuestPrincipalCount: deletedGuestPrincipals.length,
        deletedStudySessionCount: deletedStudySessions.length,
        guestPrincipalBatchLimitReached:
          deletedGuestPrincipals.length === batchSize,
        studySessionBatchLimitReached: deletedStudySessions.length === batchSize
      }
    })

    const deletedIdempotencyRecords = await client.$transaction(
      async (transaction) =>
        await transaction.$queryRaw<DeletedRow[]>(Prisma.sql`
          WITH candidates AS MATERIALIZED (
            SELECT record."id"
            FROM "IdempotencyRecord" AS record
            WHERE record."state" = 'SUCCEEDED'
              AND record."expiresAt" IS NOT NULL
              AND record."expiresAt" <= ${now}
            ORDER BY record."expiresAt" ASC, record."id" ASC
            LIMIT ${batchSize}
            FOR UPDATE OF record SKIP LOCKED
          )
          DELETE FROM "IdempotencyRecord" AS record
          USING candidates
          WHERE record."id" = candidates."id"
            AND record."state" = 'SUCCEEDED'
            AND record."expiresAt" IS NOT NULL
            AND record."expiresAt" <= ${now}
          RETURNING record."id"
        `)
    )

    return {
      ...guestCleanup,
      deletedIdempotencyRecordCount: deletedIdempotencyRecords.length,
      idempotencyRecordBatchLimitReached:
        deletedIdempotencyRecords.length === batchSize
    }
  }
})
