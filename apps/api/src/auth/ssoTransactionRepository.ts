import { z } from 'zod'
import { ssoProviderIdSchema } from '@nihongo/contracts/auth/sign-in-social'
import type { PrismaClient } from '../generated/prisma/client.js'
import type { SsoTransactionStore } from './ssoProtocol.js'

const transactionSchema = z
  .object({
    provider: ssoProviderIdSchema,
    nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    codeVerifier: z.string().regex(/^[A-Za-z0-9_-]{86}$/u),
    callbackURL: z.string().max(2048)
  })
  .strict()

export const createSsoTransactionStore = (
  client: Pick<PrismaClient, '$queryRawUnsafe'>
): SsoTransactionStore => ({
  create: async (transaction) => {
    const rows = await client.$queryRawUnsafe<Array<{ created: boolean }>>(
      'SELECT "phase7_create_sso_transaction_v2"($1, $2, $3, $4, $5, $6) AS "created"',
      transaction.provider,
      transaction.stateDigest,
      transaction.bindingDigest,
      transaction.nonce,
      transaction.codeVerifier,
      transaction.callbackURL
    )
    if (rows.length !== 1 || rows[0]?.created !== true) {
      throw new Error('SSO transaction creation failed.')
    }
  },
  consume: async (stateDigest, bindingDigest, provider) => {
    const rows = await client.$queryRawUnsafe<unknown[]>(
      'SELECT * FROM "phase7_consume_sso_transaction_v2"($1, $2, $3)',
      provider,
      stateDigest,
      bindingDigest
    )
    if (rows.length === 0) return null
    if (rows.length !== 1) throw new Error('Invalid SSO transaction result.')
    return transactionSchema.parse(rows[0])
  }
})
