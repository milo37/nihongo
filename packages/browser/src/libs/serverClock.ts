// The server clock as last seen in a /me response Date header. It lives
// outside query data and the user object on purpose: a value that changes on
// every response would make each /me read look like a new user.
let reading: { serverMs: number; receivedAt: number } | null = null

export const recordServerDate = (
  dateHeader: unknown,
  receivedAt: number = Date.now()
): void => {
  const serverMs =
    typeof dateHeader === 'string' ? Date.parse(dateHeader) : Number.NaN
  reading = Number.isNaN(serverMs) ? null : { serverMs, receivedAt }
}

/** Server time at `now`; the local clock when no Date header was readable. */
export const serverNow = (now: number = Date.now()): number =>
  reading ? reading.serverMs + (now - reading.receivedAt) : now

export const resetServerClockForTesting = (): void => {
  reading = null
}
