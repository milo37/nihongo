import { randomUUID } from 'node:crypto'
import { Prisma } from '../generated/prisma/client.js'
import { SEOUL_TODAY, todayAnsweredCount } from './studyGoal.js'

/**
 * #1094 M-1: one DAILY_GOAL stamp a day, on the first submission whose
 * answers today reach the member's daily goal at that moment. Runs inside the
 * submission transaction after the session is SUBMITTED and returns true only
 * when this call added the stamp. No daily goal, no stamp; changing the goal
 * later takes nothing back. nihongo_app may only INSERT and SELECT
 * "StampLedger" (20261122090000_stamp_ledger); the row's "amount" stays 1
 * and only rows with "amount" > 0 are one per member, day and reason
 * (20261124090000_stamp_ledger_amount).
 */
export const awardDailyGoalStamp = async (
  transaction: Pick<Prisma.TransactionClient, '$queryRaw'>,
  userId: string
): Promise<boolean> => {
  // Session locks do not cover two sets of one member submitted at once, so
  // each could count today without the other's answers and neither would
  // stamp (#1110 QA). Locking the member's goal row first makes the later
  // one wait; the next statement then counts with the earlier one committed.
  await transaction.$queryRaw(Prisma.sql`
    SELECT 1 FROM "UserStudyGoal"
    WHERE "userId" = ${userId}::uuid
    FOR UPDATE
  `)
  const added = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    INSERT INTO "StampLedger"
      ("id", "userId", "earnedOn", "reason", "goalAtEarn")
    SELECT ${randomUUID()}::uuid, goal."userId", ${SEOUL_TODAY}, 'DAILY_GOAL',
      goal."dailyGoal"
    FROM "UserStudyGoal" AS goal
    WHERE goal."userId" = ${userId}::uuid
      AND goal."dailyGoal" IS NOT NULL
      AND ${todayAnsweredCount(Prisma.sql`goal."userId"`)} >= goal."dailyGoal"
    ON CONFLICT ("userId", "earnedOn", "reason") WHERE "amount" > 0 DO NOTHING
    RETURNING "id"
  `)
  return added.length === 1
}
