import {
  type AdminFreshClient,
  type AdminFreshContextValue,
  requireRuntimeReady,
  isLocalCallback,
  contextIsValid,
  intentExpiry
} from './adminFreshShared.js'

/** create_sso_admin_fresh_transaction. */
export const createAdminFreshTransaction = async (
  client: AdminFreshClient,
  input: {
    readonly provider: string
    readonly stateDigest: string
    readonly bindingDigest: string
    readonly nonce: string
    readonly codeVerifier: string
    readonly callbackURL: string
    readonly context: AdminFreshContextValue
  }
): Promise<boolean> =>
  client.$transaction(async (transaction) => {
    await requireRuntimeReady(transaction)
    if (
      input.provider !== input.context.provider ||
      !(await contextIsValid(transaction, input.context)) ||
      !isLocalCallback(input.callbackURL)
    )
      return false
    const expiry = await intentExpiry(transaction, input.context.intentId)
    await transaction.$executeRawUnsafe(
      `DELETE FROM "SsoAdminFreshTransaction" WHERE "expiresAt" <= clock_timestamp()`
    )
    await transaction.$executeRawUnsafe(
      `DELETE FROM "SsoAdminFreshProof" WHERE "expiresAt" <= clock_timestamp()`
    )
    await transaction.$executeRawUnsafe(
      `INSERT INTO "SsoAdminFreshTransaction" (
         "userId", "provider", "stateDigest", "bindingDigest", "nonce",
         "codeVerifier", "callbackURL", "context", "createdAt", "expiresAt"
       ) VALUES (
         $1::uuid, $2, $3, $4, $5, $6, $7, $8::jsonb, clock_timestamp(),
         least($9::timestamptz, clock_timestamp() + INTERVAL '2 minutes')
       )`,
      input.context.userId,
      input.provider,
      input.stateDigest,
      input.bindingDigest,
      input.nonce,
      input.codeVerifier,
      input.callbackURL,
      JSON.stringify(input.context),
      expiry
    )
    return true
  })

/** consume_sso_admin_fresh_transaction: the one-time state row. */
export const consumeAdminFreshTransaction = async (
  client: AdminFreshClient,
  provider: string,
  stateDigest: string,
  bindingDigest: string
): Promise<unknown[]> => {
  await requireRuntimeReady(client)
  return client.$queryRawUnsafe<unknown[]>(
    `DELETE FROM "SsoAdminFreshTransaction" AS tx
     WHERE tx."provider" = $1 AND tx."stateDigest" = $2
       AND tx."bindingDigest" = $3 AND tx."expiresAt" > clock_timestamp()
     RETURNING tx."provider"::TEXT AS provider, tx."nonce"::TEXT AS nonce,
       tx."codeVerifier"::TEXT AS "codeVerifier",
       tx."callbackURL"::TEXT AS "callbackURL", tx."context"`,
    provider,
    stateDigest,
    bindingDigest
  )
}

/** stage_sso_admin_fresh_proof. */
export const stageAdminFreshProof = async (
  client: AdminFreshClient,
  input: {
    readonly context: AdminFreshContextValue
    readonly provider: string
    readonly accountId: string
    readonly proofDigest: string
    readonly callbackURL: string
  }
): Promise<boolean> =>
  client.$transaction(async (transaction) => {
    await requireRuntimeReady(transaction)
    await transaction.$queryRawUnsafe(
      `SELECT 1 FROM "User" WHERE "id" = $1::uuid FOR UPDATE`,
      input.context.userId
    )
    if (
      input.provider !== input.context.provider ||
      input.accountId !== input.context.accountId ||
      !(await contextIsValid(transaction, input.context)) ||
      !isLocalCallback(input.callbackURL)
    )
      return false
    const expiry = await intentExpiry(transaction, input.context.intentId)
    await transaction.$executeRawUnsafe(
      `INSERT INTO "SsoAdminFreshProof" (
         "userId", "proofDigest", "context", "callbackURL", "createdAt",
         "expiresAt"
       ) VALUES (
         $1::uuid, $2, $3::jsonb, $4, clock_timestamp(),
         least($5::timestamptz, clock_timestamp() + INTERVAL '2 minutes')
       )`,
      input.context.userId,
      input.proofDigest,
      JSON.stringify(input.context),
      input.callbackURL,
      expiry
    )
    return true
  })
