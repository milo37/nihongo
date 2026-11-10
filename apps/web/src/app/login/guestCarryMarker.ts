// JLP-823 D1: a sign-in started in this tab leaves a mark, so the first
// signed-in render after the SSO round trip asks the server once to move the
// guest's last result. sessionStorage survives the same-tab redirect.
const MARKER_KEY = 'harumaru:guest-carry:v1'

export const markGuestCarryPending = (): void => {
  try {
    globalThis.sessionStorage?.setItem(MARKER_KEY, '1')
  } catch {
    // Storage off: nothing is moved, the next wrong answers still collect.
  }
}

/** True once per mark: reading it clears it. */
export const takeGuestCarryPending = (): boolean => {
  try {
    const pending = globalThis.sessionStorage?.getItem(MARKER_KEY) === '1'
    if (pending) globalThis.sessionStorage.removeItem(MARKER_KEY)
    return pending
  } catch {
    return false
  }
}
