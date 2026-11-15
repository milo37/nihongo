// #975: one switch for the top bar language menu. When it is off,
// production builds (STAGING, PROD) show Korean only, even to a browser that
// saved Japanese, and keep the saved choice for when the menu returns. Dev and
// test builds always keep the menu so the Japanese screens stay testable.
const LANGUAGE_MENU_RELEASED = true

export const isLanguageMenuShown =
  LANGUAGE_MENU_RELEASED || !__NIHONGO_PRODUCTION_BUILD__
