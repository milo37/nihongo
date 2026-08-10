const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000

export const addDaysToIso = (isoDate: string, days: number): string => {
  const timestamp = Date.parse(isoDate)

  if (Number.isNaN(timestamp)) {
    throw new Error('올바른 ISO 8601 날짜가 아닙니다.')
  }

  return new Date(timestamp + days * MILLISECONDS_PER_DAY).toISOString()
}

export const toDateKey = (isoDate: string): string => isoDate.slice(0, 10)
