import { ADMIN_FRESH_WINDOW_SQL } from './adminFreshWindow.js'

/**
 * A boolean SQL expression: the raw Session token belongs to a Session
 * created by a completed SSO ADMIN_FRESH proof inside the fresh window.
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
      AND proof."completedAt" + ${ADMIN_FRESH_WINDOW_SQL} > clock_timestamp()
      AND session."createdAt" + ${ADMIN_FRESH_WINDOW_SQL} > clock_timestamp()
      AND session."expiresAt" > clock_timestamp()
  )`
