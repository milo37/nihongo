import { ADMIN_FRESH_WINDOW_SECONDS } from '@nihongo/contracts/auth/admin-fresh-sso'

/** The ADMIN_FRESH window (#683) for clock arithmetic in TypeScript. */
export const ADMIN_FRESH_WINDOW_MS = ADMIN_FRESH_WINDOW_SECONDS * 1_000

/** The same window as a SQL interval literal. */
export const ADMIN_FRESH_WINDOW_SQL = `INTERVAL '${ADMIN_FRESH_WINDOW_SECONDS} seconds'`
