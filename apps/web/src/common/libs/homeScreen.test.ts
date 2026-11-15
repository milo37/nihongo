import { describe, expect, it } from 'vitest'
import { shouldShowIosHomeScreenHint } from '@common/libs/homeScreen'

const iphoneSafari =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'
const macSafari =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15'
const androidChrome =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'

const browser = (
  userAgent: string,
  extra: {
    platform?: string
    maxTouchPoints?: number
    standalone?: boolean
  } = {}
) => ({ maxTouchPoints: 0, ...extra, userAgent })

describe('iOS home screen line (#1045)', () => {
  it('shows in iPhone Safari and iPad Safari (which reports a Mac)', () => {
    expect(shouldShowIosHomeScreenHint(browser(iphoneSafari), false)).toBe(true)
    expect(
      shouldShowIosHomeScreenHint(
        browser(macSafari, { platform: 'MacIntel', maxTouchPoints: 5 }),
        false
      )
    ).toBe(true)
  })

  it('hides once opened from the home screen', () => {
    expect(
      shouldShowIosHomeScreenHint(
        browser(iphoneSafari, { standalone: true }),
        false
      )
    ).toBe(false)
    expect(shouldShowIosHomeScreenHint(browser(iphoneSafari), true)).toBe(false)
  })

  it('hides outside iOS Safari', () => {
    for (const userAgent of [
      androidChrome,
      iphoneSafari.replace('Version/18.1', 'CriOS/131.0'),
      `${iphoneSafari} KAKAOTALK 10.8.0`,
      `${iphoneSafari} NAVER(inapp; search; 2000; 12.8.1)`
    ]) {
      expect(shouldShowIosHomeScreenHint(browser(userAgent), false)).toBe(false)
    }
    expect(
      shouldShowIosHomeScreenHint(
        browser(macSafari, { platform: 'MacIntel' }),
        false
      )
    ).toBe(false)
  })
})
