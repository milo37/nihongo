import { z } from 'zod'
import type { PrismaClient } from '../generated/prisma/client.js'

const countsSchema = z.array(
  z
    .object({
      metric: z.string(),
      count: z.bigint().nonnegative()
    })
    .strict()
)

/** Aggregate-only operator diagnostic. Never connects or migrates by itself.
 * Use only an explicitly assigned read-only TEST/transition connection.
 */
export const readSsoDataImpact = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'>
): Promise<
  ReadonlyArray<{ readonly metric: string; readonly count: string }>
> => {
  const rows = await client.$queryRawUnsafe<unknown>(`
    SELECT 'users' AS metric, count(*)::bigint AS count FROM "User"
    UNION ALL SELECT 'contact_email_present', count(*) FROM "User" WHERE "email" <> ''
    UNION ALL SELECT 'credential_accounts', count(*) FROM "Account" WHERE "providerId" = 'credential'
    UNION ALL SELECT 'password_values', count(*) FROM "Account" WHERE "password" IS NOT NULL
    UNION ALL SELECT 'provider_accounts', count(*) FROM "Account" WHERE "providerId" <> 'credential'
    UNION ALL SELECT 'users_without_provider', count(*) FROM "User" u
      WHERE NOT EXISTS (SELECT 1 FROM "Account" a WHERE a."userId" = u."id" AND a."providerId" <> 'credential')
    UNION ALL SELECT 'admins_without_provider', count(*) FROM "User" u
      WHERE u."role" = 'ADMIN' AND NOT EXISTS (SELECT 1 FROM "Account" a WHERE a."userId" = u."id" AND a."providerId" <> 'credential')
    UNION ALL SELECT 'password_reset_verifications', count(*) FROM "Verification" WHERE "purpose" = 'PASSWORD_RESET_V1'
    UNION ALL SELECT 'other_verifications', count(*) FROM "Verification" WHERE "purpose" IS NULL
    UNION ALL SELECT 'sessions', count(*) FROM "Session"
    UNION ALL SELECT 'study_sessions', count(*) FROM "StudySession"
    UNION ALL SELECT 'wrong_notes', count(*) FROM "WrongNote"
    UNION ALL SELECT 'bookmarks', count(*) FROM "Bookmark"
  `)
  return countsSchema.parse(rows).map(({ metric, count }) => ({
    metric,
    count: count.toString()
  }))
}
