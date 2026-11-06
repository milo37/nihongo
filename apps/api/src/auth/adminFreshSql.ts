/**
 * A boolean SQL expression: the raw Session token belongs to a Session
 * created by a completed SSO ADMIN_FRESH proof less than 5 minutes ago.
 * `tokenParameter` is a bind placeholder.
 */
export const adminSessionFreshSql = (tokenParameter: string): string => `
  EXISTS (
    SELECT 1 FROM "SsoAdminFreshProof" AS proof
    JOIN "Session" AS session ON session."id" = proof."completedSessionId"
    JOIN "User" AS actor
      ON actor."id" = session."userId"
     AND actor."id" = (proof."context"->>'userId')::UUID
    JOIN "Account" AS account
      ON account."userId" = actor."id"
     AND account."providerId" = proof."context"->>'provider'
     AND account."accountId" = proof."context"->>'accountId'
    WHERE session."token" = ${tokenParameter}
      AND session."authorizationState" = 'ACTIVE'
      AND session."issuerProtocolVersion" = 'OWNED_V1'
      AND actor."role" = 'ADMIN' AND actor."accountStatus" = 'ACTIVE'
      AND actor."authorityGeneration" =
        (proof."context"->>'authorityGeneration')::INTEGER
      AND session."authorityGeneration" = actor."authorityGeneration"
      AND proof."expiresAt" > clock_timestamp()
      AND proof."completedAt" + INTERVAL '5 minutes' > clock_timestamp()
      AND session."createdAt" + INTERVAL '5 minutes' > clock_timestamp()
      AND session."expiresAt" > clock_timestamp()
  )`
