/**
 * Guests try random sessions with one simple limit: 3 sets of 5 questions a
 * day (JLP-823). A result retry is a set too.
 * The server enforces these numbers; the browser shows the same values in
 * its login prompts. A guest day starts at midnight Korea time (UTC+9, no
 * daylight saving).
 */

/** Questions in every guest session. Guests may not ask for another count. */
export const GUEST_SESSION_QUESTION_LIMIT = 5
/** Sessions (retries included) one guest may start per Korea-time day. */
export const GUEST_DAILY_SESSION_LIMIT = 3
/**
 * Guest sessions one client IP may start per Korea-time day, so clearing the
 * guest cookie does not reset the limit. Several people can share one IP
 * (a class of 30 doing 2 sets each), so this is a hidden safety net only.
 */
export const GUEST_DAILY_SESSION_LIMIT_PER_IP = 60
export const GUEST_DAY_UTC_OFFSET_MINUTES = 9 * 60
