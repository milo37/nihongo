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
    '신고를 많이 보냈어요. 15분 뒤 다시 시도해 주세요.',
    '신고를 많이 보냈어요. 30초 뒤 다시 시도해 주세요.'
  ],
  [
    'ja',
    '報告をたくさん送りました。15分後にもう一度お試しください。',
    '報告をたくさん送りました。30秒後にもう一度お試しください。'
  ]
])(
  'shows a %s rate limit wait in minutes from 60 seconds',
  async (locale, minutes, seconds) => {
    await act(() => appI18n.changeLanguage(locale))
    const { result } = renderHook(() => useReportPresentation())
    expect(result.current.presentError(rateLimited(900_000), 'x')).toBe(minutes)
    expect(result.current.presentError(rateLimited(30_000), 'x')).toBe(seconds)
  }
)

// #1262: the learner never sees the admin error table.
it("says a server failure in the dialog's own words", () => {
  const { result } = renderHook(() => useReportPresentation())
  const server = Object.assign(new Error('boom'), {
    code: 'INTERNAL_SERVER_ERROR'
  })
  expect(
    result.current.presentError(server, '보내지 못했어요. 다시 시도해 주세요.')
  ).toBe('보내지 못했어요. 다시 시도해 주세요.')
})
