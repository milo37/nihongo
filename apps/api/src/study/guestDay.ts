import { GUEST_DAY_UTC_OFFSET_MINUTES } from '@nihongo/contracts/study/guest-limits'

const DAY_MS = 24 * 60 * 60 * 1_000
const OFFSET_MS = GUEST_DAY_UTC_OFFSET_MINUTES * 60 * 1_000

/** Start of the Korea-time day that contains `at`, as a UTC instant. */
export const startOfGuestDay = (at: Date): Date =>
  new Date(Math.floor((at.getTime() + OFFSET_MS) / DAY_MS) * DAY_MS - OFFSET_MS)

/** The Korea-time calendar date of `at`, e.g. `2026-11-08`. */
export const guestDayKey = (at: Date): string =>
  new Date(startOfGuestDay(at).getTime() + OFFSET_MS).toISOString().slice(0, 10)
