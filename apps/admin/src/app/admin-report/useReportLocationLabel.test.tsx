import { renderHook } from '@testing-library/react'
import { writeUiLocalePreference } from '@nihongo/browser/libs/localeStorage'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { useReportLocationLabel } from '@app/admin-report/useReportLocationLabel'

it('turns stored report locations into screen names and question numbers', () => {
  const { result } = renderHook(() => useReportLocationLabel(), {
    wrapper: I18nProvider
  })
  expect(result.current('result#2')).toBe('결과 화면 · 2번 문제')
  expect(result.current('practiceSession')).toBe('문제 풀이')
  // Unknown or malformed values stay visible for support.
  expect(result.current('practice-session')).toBe(
    '기타 화면 (practice-session)'
  )
  expect(result.current('result#0')).toBe('기타 화면 (result#0)')
  expect(result.current('toString')).toBe('기타 화면 (toString)')
})

afterEach(() => {
  writeUiLocalePreference('ko')
  localStorage.clear()
})

it('uses the Japanese labels', () => {
  expect(writeUiLocalePreference('ja')).toBe(true)
  const { result } = renderHook(() => useReportLocationLabel(), {
    wrapper: I18nProvider
  })
  expect(result.current('result#2')).toBe('結果画面 · 2問目')
})
