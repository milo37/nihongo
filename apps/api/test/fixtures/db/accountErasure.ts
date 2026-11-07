import type { PrismaClient } from '../../../src/generated/prisma/client.js'
import { eraseUserForTest } from '../../../src/auth/accountErasureAuthority.js'

/**
 * #504 P7 PR4a: test cleanup erases a User with the API implementation of the
 * dropped erase_user, as nihongo_app.
 */
export const eraseTestUser = async (
  client: Pick<PrismaClient, '$transaction'>,
  userId: string
): Promise<boolean> =>
  client.$transaction((transaction) =>
    eraseUserForTest(transaction, userId, 'TEST')
  )
