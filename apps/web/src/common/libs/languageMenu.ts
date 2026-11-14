// #975: the language menu waits for Japanese explanations (#976). Until then
// production builds (STAGING, PROD) show Korean only, even to a browser that
// saved Japanese; the saved choice is kept for when the menu returns. Dev and
// test builds keep the menu so the Japanese screens stay testable.
// To bring the menu back, set this to true.
const LANGUAGE_MENU_RELEASED = false

export const isLanguageMenuShown =
  LANGUAGE_MENU_RELEASED || !__NIHONGO_PRODUCTION_BUILD__
