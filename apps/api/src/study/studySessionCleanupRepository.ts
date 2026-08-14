import { Prisma, type PrismaClient } from '../generated/prisma/client.js'

export interface StudySessionCleanupBatchInput {
  batchSize: number
  now: Date
}

export interface StudySessionCleanupBatchResult {
  deletedGuestPrincipalCount: number
  deletedStudySessionCount: number
  guestPrincipalBatchLimitReached: boolean
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
  cleanupExpiredGuestStudyData: async ({ batchSize, now }) =>
    await client.$transaction(async (transaction) => {
      const deletedStudySessions = await transaction.$queryRaw<DeletedRow[]>(
        Prisma.sql`
          WITH candidates AS (
            SELECT session."id"
            FROM "StudySession" AS session
            WHERE session."userId" IS NULL
              AND session."guestPrincipalId" IS NOT NULL
              AND session."status" = 'IN_PROGRESS'
              AND session."expiresAt" <= ${now}
            ORDER BY session."expiresAt" ASC, session."id" ASC
            LIMIT ${batchSize}
            FOR UPDATE OF session SKIP LOCKED
          )
          DELETE FROM "StudySession" AS session
          USING candidates
          WHERE session."id" = candidates."id"
            AND session."userId" IS NULL
            AND session."guestPrincipalId" IS NOT NULL
            AND session."status" = 'IN_PROGRESS'
            AND session."expiresAt" <= ${now}
          RETURNING session."id"
        `
      )

      const deletedGuestPrincipals = await transaction.$queryRaw<DeletedRow[]>(
        Prisma.sql`
          WITH candidates AS (
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
})
