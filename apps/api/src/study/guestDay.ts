import { GUEST_DAY_UTC_OFFSET_MINUTES } from '@nihongo/contracts/study/guest-limits'

const DAY_MS = 24 * 60 * 60 * 1_000
const OFFSET_MS = GUEST_DAY_UTC_OFFSET_MINUTES * 60 * 1_000

/** Start of the Korea-time day that contains `at`, as a UTC instant. */
export const startOfGuestDay = (at: Date): Date =>
  new Date(Math.floor((at.getTime() + OFFSET_MS) / DAY_MS) * DAY_MS - OFFSET_MS)

/** The Korea-time calendar date of `at`, e.g. `2026-11-08`. */
export const guestDayKey = (at: Date): string =>
  new Date(startOfGuestDay(at).getTime() + OFFSET_MS).toISOString().slice(0, 10)

/** Next midnight Korea time after `at`, when the guest limits start again. */
export const nextGuestDayStart = (at: Date): Date =>
  new Date(startOfGuestDay(at).getTime() + DAY_MS)

/** Rate-limit operation that counts guest session starts per IP and day. */
export const GUEST_DAILY_IP_OPERATION = 'guest-study-create-day'
export const GUEST_DAILY_IP_WINDOW_MS = DAY_MS

/** The limiter's client value: the IP plus the Korea-time date. */
export const guestDailyIpClient = (clientIp: string, at: Date): string =>
  `${clientIp}|${guestDayKey(at)}`
