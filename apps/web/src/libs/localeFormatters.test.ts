import { describe, expect, it } from 'vitest'
import {
  formatDateTime,
  formatDateTimeToParts,
  formatNumber,
  formatRelativeTime
} from '@libs/localeFormatters'

const toCalendarParts = (
  parts: Intl.DateTimeFormatPart[]
): Record<'day' | 'month' | 'year', number> => ({
  year: Number.parseInt(
    parts.find(({ type }) => type === 'year')?.value ?? '',
    10
  ),
  month: Number.parseInt(
    parts.find(({ type }) => type === 'month')?.value ?? '',
    10
  ),
  day: Number.parseInt(
    parts.find(({ type }) => type === 'day')?.value ?? '',
    10
  )
})

describe('locale formatters', () => {
  it('같은 instant와 UTC boundary를 유지하며 locale만 바꾼다', () => {
    const instant = '2026-09-28T23:30:00.000Z'
    const options: Intl.DateTimeFormatOptions = {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }

    expect(formatDateTime(instant, 'ko', options)).toBe(
      new Intl.DateTimeFormat('ko-KR', options).format(new Date(instant))
    )
    expect(formatDateTime(instant, 'ja', options)).toBe(
      new Intl.DateTimeFormat('ja-JP', options).format(new Date(instant))
    )
    expect(
      toCalendarParts(formatDateTimeToParts(instant, 'ko', options))
    ).toEqual({ year: 2026, month: 9, day: 28 })
    expect(
      toCalendarParts(formatDateTimeToParts(instant, 'ja', options))
    ).toEqual({ year: 2026, month: 9, day: 28 })
  })

  it('number와 relative time을 명시 locale로 format한다', () => {
    expect(formatNumber(12_345.6, 'ko')).toBe(
      new Intl.NumberFormat('ko-KR').format(12_345.6)
    )
    expect(formatNumber(12_345.6, 'ja')).toBe(
      new Intl.NumberFormat('ja-JP').format(12_345.6)
    )
    expect(formatRelativeTime(-2, 'day', 'ja')).toBe(
      new Intl.RelativeTimeFormat('ja-JP').format(-2, 'day')
    )
  })
})
