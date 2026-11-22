import { ssoCallbackOutcomeSchema } from '@nihongo/contracts/auth/sign-in-social'
import type { SsoCallbackOutcome } from '@nihongo/contracts/auth/sign-in-social'
import type { SignupConsentExit } from '@app/login/hooks/useSignupConsent'
import type { RestoreFailure } from '@app/login/hooks/useAccountRestore'
import type { SignInNotice } from '@app/login/components/SignInCard'

// #1085: the callback's sign-up check. The layout keeps its own copy in
// signupConsentOutcome.ts; importing that here would split it into a chunk.
export const SIGNUP_CONSENT_OUTCOME = 'CONSENT_REQUIRED'

export type Notice =
  | SsoCallbackOutcome
  | typeof SIGNUP_CONSENT_OUTCOME
  | SignupConsentExit
  | RestoreFailure
  | 'LEGACY'
  | 'EXPIRED'
  | 'DELETION'
  | 'UNLINKED'

const hasStateFlag = (state: unknown, flag: string): boolean =>
  state !== null &&
  typeof state === 'object' &&
  flag in state &&
  Reflect.get(state, flag) === true

export const readNotice = (
  search: URLSearchParams,
  state: unknown
): Notice | null => {
  if (search.has('sso')) {
    // #1085: the callback's sign-up check is not in the shared outcome list.
    if (search.get('sso') === SIGNUP_CONSENT_OUTCOME)
      return SIGNUP_CONSENT_OUTCOME
    const outcome = ssoCallbackOutcomeSchema.safeParse(search.get('sso'))
    return outcome.success ? outcome.data : 'INVALID_CALLBACK'
  }
  if (search.has('mode') || hasStateFlag(state, 'legacyAuthMethod'))
    return 'LEGACY'
  if (hasStateFlag(state, 'sessionExpired')) return 'EXPIRED'
  if (hasStateFlag(state, 'deletionRequested')) return 'DELETION'
  if (hasStateFlag(state, 'accountUnlinked')) return 'UNLINKED'
  return null
}

export const errorNotices: ReadonlySet<Notice> = new Set([
  'FAILED',
  'INVALID_CALLBACK',
  'RESTORE_FAILED',
  'RESTORE_TOO_LATE',
  'SIGNUP_EXPIRED'
])

// RESTORE_AVAILABLE is not a notice: it shows the restore card (JLP-845);
// CONSENT_REQUIRED shows the sign-up check (#1085).
const noticeKeys: Record<
  Exclude<
    Notice,
    'DELETION' | 'RESTORE_AVAILABLE' | typeof SIGNUP_CONSENT_OUTCOME
  >,
  string
> = {
  CANCELLED: 'sso.cancelledProvider',
  FAILED: 'sso.failedProvider',
  INVALID_CALLBACK: 'sso.expired',
  RESTORE_FAILED: 'recover.failed',
  RESTORE_TOO_LATE: 'recover.tooLate',
  SIGNUP_EXPIRED: 'signup.expired',
  EXPIRED: 'sso.sessionExpired',
  LEGACY: 'sso.legacyMethod',
  UNLINKED: 'sso.unlinked'
}

/** The sign-in card's notice; `message` reads a notice key in the auth texts. */
export const toSignInNotice = (
  notice: Exclude<
    Notice,
    'RESTORE_AVAILABLE' | typeof SIGNUP_CONSENT_OUTCOME
  > | null,
  deletionNotice: string | null,
  message: (key: string) => string
): SignInNotice | null =>
  notice === null
    ? null
    : notice === 'DELETION'
      ? deletionNotice
        ? { message: deletionNotice, tone: 'info' }
        : null
      : {
          message: message(noticeKeys[notice]),
          tone: errorNotices.has(notice) ? 'error' : 'info'
        }
