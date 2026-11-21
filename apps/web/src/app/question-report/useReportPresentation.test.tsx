import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { appI18n } from '@nihongo/browser/i18n/config'
import { useReportPresentation } from '@app/question-report/useReportPresentation'

const rateLimited = (retryAfterMs: number): Error =>
  Object.assign(new Error('rate limited'), {
    code: 'RATE_LIMITED',
    retryAfterMs
  })

afterEach(async () => {
  await act(() => appI18n.changeLanguage('ko'))
})

// #712: a wait of a minute or more reads in minutes, as in the admin app.
it.each([
  [
    'ko',
    '요청이 너무 많습니다. 15분 뒤 다시 시도해 주세요.',
    '요청이 너무 많습니다. 30초 뒤 다시 시도해 주세요.'
  ],
  [
    'ja',
    'リクエストが多すぎます。15分後にもう一度お試しください。',
    'リクエストが多すぎます。30秒後にもう一度お試しください。'
  ]
])(
  'shows a %s rate limit wait in minutes from 60 seconds',
  async (locale, minutes, seconds) => {
    await act(() => appI18n.changeLanguage(locale))
    const { result } = renderHook(() => useReportPresentation())
    expect(result.current.presentError(rateLimited(900_000))).toBe(minutes)
    expect(result.current.presentError(rateLimited(30_000))).toBe(seconds)
  }
)
