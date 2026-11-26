import {
  ADMIN_RETENTION_WEEKS,
  getAdminRetentionResponseSchema,
  type GetAdminRetentionResponse
} from '@nihongo/contracts/admin/retention'
import type { PrismaClient } from '../generated/prisma/client.js'

const DAY_MS = 86_400_000
const KOREA_OFFSET_MS = 9 * 60 * 60 * 1_000

export interface AdminRetentionReader {
  readonly read: (now: Date) => Promise<GetAdminRetentionResponse>
}

/**
 * #1266: reads the #1042 `RetentionCohort` counts of the last 8 weeks (Korea
 * days, today included). Read only; the table holds numbers per day and
 * audience, never a person.
 */
export const createAdminRetentionReader = (
  client: Pick<PrismaClient, 'retentionCohort'>
): AdminRetentionReader => ({
  read: async (now) => {
    const firstDay = new Date(
      Math.floor((now.getTime() + KOREA_OFFSET_MS) / DAY_MS) * DAY_MS -
        (ADMIN_RETENTION_WEEKS * 7 - 1) * DAY_MS
    )
    const rows = await client.retentionCohort.findMany({
      where: { cohortDate: { gte: firstDay } },
      // MEMBER sorts before GUEST.
      orderBy: [{ cohortDate: 'desc' }, { audience: 'asc' }]
    })
    return getAdminRetentionResponseSchema.parse({
      rows: rows.map((row) => ({
        cohortDate: row.cohortDate.toISOString().slice(0, 10),
        audience: row.audience,
        cohortSize: row.cohortSize,
        day1Returned: row.day1Returned,
        weekCohortSize: row.weekCohortSize,
        day7Returned: row.day7Returned,
        week1Returned: row.week1Returned
      }))
    })
  }
})
