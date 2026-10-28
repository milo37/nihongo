import { Prisma, type PrismaClient } from '../generated/prisma/client.js'

interface IdRow {
  id: string
}

interface OwnedSessionRow extends IdRow {
  userId: string | null
  guestPrincipalId: string | null
}

export interface StudyV1RetirementResult {
  expiredCount: number
  deletedSessionCount: number
  deletedWrongNoteCount: number
  preservedSessionCount: number
}

/** Run only against an explicitly selected transition target. */
export const createPrismaStudyV1RetirementRepository = (
  client: PrismaClient
) => ({
  retire: async (
    sessionIds: readonly string[]
  ): Promise<StudyV1RetirementResult> => {
    if (sessionIds.length === 0) {
      return {
        expiredCount: 0,
        deletedSessionCount: 0,
        deletedWrongNoteCount: 0,
        preservedSessionCount: 0
      }
    }
    const requestedIds = Prisma.join(
      sessionIds.map((id) => Prisma.sql`${id}::uuid`)
    )
    return await client.$transaction(
      async (transaction) => {
        const identity = await transaction.$queryRaw<
          { allowed: boolean }[]
        >(Prisma.sql`
          SELECT (
            pg_catalog.current_database() ~ '_test$'
            AND SESSION_USER = 'nihongo_test_phase7_migration_login'
            AND CURRENT_USER = 'nihongo_phase7_migration'
            AND pg_catalog.current_setting('role', true) = 'nihongo_phase7_migration'
            AND pg_catalog.current_setting('session_replication_role') = 'origin'
            AND EXISTS (
              SELECT 1 FROM pg_catalog.pg_namespace AS namespace
              JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = namespace.nspowner
              WHERE namespace.nspname = pg_catalog.current_schema()
                AND owner_role.rolname = 'nihongo_phase7_owner'
            )
          ) AS allowed
        `)
        if (identity.length !== 1 || identity[0]?.allowed !== true) {
          throw new Error(
            'V1 retirement requires the canonical TEST migration role.'
          )
        }
        await transaction.$executeRaw(
          Prisma.sql`SET LOCAL ROLE "nihongo_phase7_owner"`
        )
        // Lock sessions before notes, matching the submission lock order.
        const sessions = await transaction.$queryRaw<
          OwnedSessionRow[]
        >(Prisma.sql`
          SELECT session."id", session."userId", session."guestPrincipalId" FROM "StudySession" AS session
          WHERE session."practiceContractVersion" = 1 AND session."id" IN (${requestedIds})
          ORDER BY session."id" FOR UPDATE OF session
        `)
        if (sessions.length === 0) {
          return {
            expiredCount: 0,
            deletedSessionCount: 0,
            deletedWrongNoteCount: 0,
            preservedSessionCount: 0
          }
        }
        const allIds = Prisma.join(
          sessions.map(({ id }) => Prisma.sql`${id}::uuid`)
        )
        await transaction.$queryRaw<IdRow[]>(Prisma.sql`
          SELECT note."id" FROM "WrongNote" AS note
          WHERE EXISTS (
            SELECT 1 FROM "ReviewEvent" AS event
            WHERE event."wrongNoteId" = note."id" AND event."studySessionId" IN (${allIds})
          )
          ORDER BY note."id" FOR UPDATE OF note
        `)
        const expired = await transaction.studySession.updateMany({
          where: {
            practiceContractVersion: 1,
            status: 'IN_PROGRESS',
            id: { in: sessions.map(({ id }) => id) }
          },
          data: { status: 'EXPIRED' }
        })
        // Protect whole connected review histories when any member has a V2
        // retry, non-V1 event, or user memo. No snapshots are rewritten.
        const removable = await transaction.$queryRaw<IdRow[]>(Prisma.sql`
          WITH RECURSIVE protected("id") AS (
            SELECT session."id" FROM "StudySession" AS session
            WHERE session."id" IN (${allIds}) AND (
              EXISTS (SELECT 1 FROM "StudySession" AS retry WHERE retry."retryOfStudySessionId" = session."id")
              OR EXISTS (
                SELECT 1 FROM "ReviewEvent" AS own_event
                WHERE own_event."studySessionId" = session."id" AND (
                  EXISTS (SELECT 1 FROM "UserMemo" AS memo WHERE memo."wrongNoteId" = own_event."wrongNoteId")
                  OR EXISTS (
                    SELECT 1 FROM "ReviewEvent" AS other_event
                    LEFT JOIN "StudySession" AS other_session ON other_session."id" = other_event."studySessionId"
                    WHERE other_event."wrongNoteId" = own_event."wrongNoteId"
                      AND (other_session."id" IS NULL OR other_session."practiceContractVersion" <> 1 OR other_session."id" NOT IN (${allIds}))
                  )
                )
              )
            )
            UNION
            SELECT linked."studySessionId" FROM protected AS prior
            JOIN "ReviewEvent" AS own_event ON own_event."studySessionId" = prior."id"
            JOIN "ReviewEvent" AS linked ON linked."wrongNoteId" = own_event."wrongNoteId"
            JOIN "StudySession" AS session ON session."id" = linked."studySessionId"
            WHERE session."practiceContractVersion" = 1
          )
          SELECT session."id" FROM "StudySession" AS session
          WHERE session."id" IN (${allIds})
            AND NOT EXISTS (SELECT 1 FROM protected WHERE protected."id" = session."id")
          ORDER BY session."id"
        `)
        if (removable.length === 0) {
          return {
            expiredCount: expired.count,
            deletedSessionCount: 0,
            deletedWrongNoteCount: 0,
            preservedSessionCount: sessions.length
          }
        }
        const safeIds = Prisma.join(
          removable.map(({ id }) => Prisma.sql`${id}::uuid`)
        )
        const removableIds = new Set(removable.map(({ id }) => id))
        const ownerChecks = Prisma.join(
          sessions
            .filter(({ id }) => removableIds.has(id))
            .map(
              (session) => Prisma.sql`
            (session."id" = ${session.id}::uuid
              AND session."userId" IS NOT DISTINCT FROM ${session.userId}::uuid
              AND session."guestPrincipalId" IS NOT DISTINCT FROM ${session.guestPrincipalId}::uuid)
          `
            ),
          ' OR '
        )
        const owners = await transaction.$queryRaw<IdRow[]>(Prisma.sql`
          SELECT session."id" FROM "StudySession" AS session
          WHERE session."id" IN (${safeIds}) AND session."practiceContractVersion" = 1
            AND (${ownerChecks})
        `)
        if (owners.length !== removable.length) {
          throw new Error('V1 retirement owner changed during cleanup.')
        }
        await transaction.$executeRaw(
          Prisma.sql`SET LOCAL ROLE "nihongo_phase7_migration"`
        )
        const [deleted] = await transaction.$queryRaw<
          { deletedSessionCount: number; deletedWrongNoteCount: number }[]
        >(Prisma.sql`
          SELECT * FROM "phase7_retire_v1_sessions"(ARRAY[${safeIds}]::uuid[])
        `)
        if (!deleted || deleted.deletedSessionCount !== removable.length) {
          throw new Error('V1 retirement target changed during cleanup.')
        }
        return {
          expiredCount: expired.count,
          deletedSessionCount: deleted.deletedSessionCount,
          deletedWrongNoteCount: deleted.deletedWrongNoteCount,
          preservedSessionCount: sessions.length - deleted.deletedSessionCount
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  }
})
