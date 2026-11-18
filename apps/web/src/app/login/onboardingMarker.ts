// #1090 O-1: a sign-in started in this tab leaves a mark, so the first
// signed-in screen after the SSO round trip asks once whether the study goal
// page is still due. Same storage as the guest carry mark, its own key.
const MARKER_KEY = 'harumaru:onboarding-check:v1'

export const markOnboardingCheck = (): void => {
  try {
    globalThis.sessionStorage?.setItem(MARKER_KEY, '1')
  } catch {
    // Storage off: the page waits for My page or the sign-up check.
  }
}

/** Whether a sign-in still waits for its one check (does not clear it). */
export const hasOnboardingCheck = (): boolean => {
  try {
    return globalThis.sessionStorage?.getItem(MARKER_KEY) === '1'
  } catch {
    return false
  }
}

/** True once per mark: reading it clears it. */
export const takeOnboardingCheck = (): boolean => {
  const pending = hasOnboardingCheck()
  if (pending) globalThis.sessionStorage.removeItem(MARKER_KEY)
  return pending
}
