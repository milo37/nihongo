import { z } from 'zod'

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

const isCalendarDate = (value: string): boolean => {
  const match = CALENDAR_DATE_PATTERN.exec(value)

  if (!match) {
    return false
  }

  const [, yearText, monthText, dayText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const date = new Date(Date.UTC(year, month - 1, day))

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

export const isoDateTimeSchema = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString())

export const calendarDateSchema = z
  .string()
  .regex(CALENDAR_DATE_PATTERN)
  .refine(isCalendarDate, '유효한 달력 날짜여야 합니다.')

export type IsoDateTime = z.output<typeof isoDateTimeSchema>
export type CalendarDate = z.output<typeof calendarDateSchema>
