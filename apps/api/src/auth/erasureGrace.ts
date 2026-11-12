/**
 * JLP-845: erasure waits 7 days after the request, so the member can restore
 * the account by signing in. The hourly run erases it at the first full hour
 * after that (the scheduled time; JST and UTC share hour boundaries).
 */
export const ERASURE_GRACE = `INTERVAL '7 days'`
export const erasureDueSql = (request: string): string =>
  `${request}."createdAt" + ${ERASURE_GRACE} <= clock_timestamp()`
export const deletionScheduledAtSql = (request: string): string =>
  `to_char(
     (date_trunc('hour', ${request}."createdAt" + ${ERASURE_GRACE})
       + CASE WHEN date_trunc('hour', ${request}."createdAt" + ${ERASURE_GRACE})
           = ${request}."createdAt" + ${ERASURE_GRACE}
         THEN INTERVAL '0' ELSE INTERVAL '1 hour' END) AT TIME ZONE 'UTC',
     'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`

/**
 * JLP-852: a member who has not signed in for a year gets the same erasure
 * request a member's own deletion makes, so erasure follows 7 days later
 * and signing in during that week restores the account.
 */
export const INACTIVE_ERASURE_AFTER = `INTERVAL '1 year'`
