import { isIPv4, isIPv6 } from 'node:net'
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

/**
 * The network a guest's IP counts under (#1007). One IPv6 home or phone line
 * usually gets a whole /64 and can change the rest at will, so IPv6 counts by
 * its /64. IPv4, and IPv4 written as IPv6 (`::ffff:a.b.c.d`), stays the
 * single address.
 */
export const guestIpScope = (clientIp: string): string => {
  const address = clientIp.split('%', 1)[0] ?? clientIp
  if (!isIPv6(address)) return clientIp
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1]
  if (mapped !== undefined && isIPv4(mapped)) return mapped
  const [head = '', tail] = address.split('::')
  const groups = (part: string | undefined): string[] =>
    part === undefined || part === '' ? [] : part.split(':')
  const left = groups(head)
  const right = groups(tail)
  const full =
    tail === undefined
      ? left
      : [
          ...left,
          ...Array<string>(8 - left.length - right.length).fill('0'),
          ...right
        ]
  const prefix = full
    .slice(0, 4)
    .map((group) => Number.parseInt(group, 16).toString(16))
  return `${prefix.join(':')}::/64`
}

/** The limiter's client value: the IP's network plus the Korea-time date. */
export const guestDailyIpClient = (clientIp: string, at: Date): string =>
  `${guestIpScope(clientIp)}|${guestDayKey(at)}`
