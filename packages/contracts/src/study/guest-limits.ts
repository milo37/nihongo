/**
 * Guests may only try short random sessions (#737; planning S1, S2, S7).
 * The server enforces these numbers; the browser shows the same values in
 * its login prompts. A guest day starts at midnight Korea time (UTC+9, no
 * daylight saving).
 */

/** Questions in every guest session. Guests may not ask for another count. */
export const GUEST_SESSION_QUESTION_LIMIT = 5
/** Sessions one guest may start per Korea-time day. */
export const GUEST_DAILY_SESSION_LIMIT = 2
/**
 * Guest sessions one client IP may start per Korea-time day, so clearing the
 * guest cookie does not reset the limit. Several people can share one IP.
 */
export const GUEST_DAILY_SESSION_LIMIT_PER_IP = 20
export const GUEST_DAY_UTC_OFFSET_MINUTES = 9 * 60
