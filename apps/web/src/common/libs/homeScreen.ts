// #1045: add to home screen. The service worker has no fetch handler (see
// public/sw.js), so registering it caches nothing. Only production builds
// register it: dev and test builds run the mock API worker at the same scope.
export const registerHomeScreenWorker = (): void => {
  if (!__NIHONGO_PRODUCTION_BUILD__ || !('serviceWorker' in navigator)) return
  // A failed registration only loses home screen install; the page still works.
  navigator.serviceWorker
    .register('/sw.js', { scope: '/', updateViaCache: 'none' })
    .catch(() => undefined)
}

const IOS_DEVICE = /iPhone|iPad|iPod/u
// Chrome, Firefox, Edge and in-app browsers on iOS cannot add to the home
// screen from their share menu the way Safari does.
const IOS_NON_SAFARI =
  /CriOS|FxiOS|EdgiOS|OPiOS|KAKAOTALK|NAVER|Line\/|Instagram|FBAN|FBAV|DaumApps|Whale/u

type HomeScreenNavigator = Pick<Navigator, 'userAgent' | 'maxTouchPoints'> & {
  readonly platform?: string
  readonly standalone?: boolean
}

// The iOS line on the My page: iOS Safari only, and not once the site is
// already open from the home screen.
export const shouldShowIosHomeScreenHint = (
  browser: HomeScreenNavigator = navigator,
  standaloneDisplay = window.matchMedia?.('(display-mode: standalone)')
    .matches ?? false
): boolean => {
  // iPadOS Safari reports itself as a Mac with a touch screen.
  const ios =
    IOS_DEVICE.test(browser.userAgent) ||
    (browser.platform === 'MacIntel' && browser.maxTouchPoints > 1)
  if (!ios || IOS_NON_SAFARI.test(browser.userAgent)) return false
  return browser.standalone !== true && !standaloneDisplay
}
