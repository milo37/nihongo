// #1045: which browsers see the iOS home screen line on the My page. Only
// the My page imports this, so it stays in that page's lazy chunk.

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
