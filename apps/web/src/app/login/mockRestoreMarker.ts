// Dev/test MSW only: the mock sign-in has no redirect to carry
// ?sso=RESTORE_AVAILABLE, so it leaves this mark for the sign-in hook.
let restoreOffered = false

export const markMockRestoreOffered = (): void => {
  restoreOffered = true
}

/** True once per mark: reading it clears it. */
export const takeMockRestoreOffered = (): boolean => {
  const offered = restoreOffered
  restoreOffered = false
  return offered
}
