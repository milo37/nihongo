/**
 * #1085: the callback sends a provider return that still needs the sign-up
 * check to `/login?sso=CONSENT_REQUIRED`. The layout reads it to show only
 * the logo. The login page keeps its own copy of the word, so this stays in
 * the main chunk instead of becoming a shared one.
 */
export const SIGNUP_CONSENT_OUTCOME = 'CONSENT_REQUIRED'

export const isSignupConsentLocation = (
  pathname: string,
  search: string
): boolean =>
  pathname === '/login' &&
  new URLSearchParams(search).get('sso') === SIGNUP_CONSENT_OUTCOME
