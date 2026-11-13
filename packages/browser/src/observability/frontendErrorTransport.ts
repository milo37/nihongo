import type {
  FrontendErrorEvent,
  FrontendErrorTransport
} from './frontendErrorReporter'

// JLP-762: screen errors go to our API, which writes them to the server log.
export const FRONTEND_ERROR_ENDPOINT = '/v1/client-errors'

const MAX_REPORTS_PER_PAGE = 10
const REPEAT_WINDOW_MS = 60_000

interface CreateApiFrontendErrorTransportOptions {
  readonly baseUrl: string
  readonly fetchImpl?: typeof fetch
  readonly now?: () => number
}

/**
 * Sends with fetch, not the shared API client, so a failed report never runs
 * the API error handlers (which would report again). A page sends at most ten
 * reports, and the same source on the same route once a minute. Delivery
 * failures are dropped.
 */
export const createApiFrontendErrorTransport = ({
  baseUrl,
  fetchImpl = (...args) => fetch(...args),
  now = () => Date.now()
}: CreateApiFrontendErrorTransportOptions): FrontendErrorTransport => {
  const lastSentAt = new Map<string, number>()
  let sent = 0

  return {
    send: async (event: FrontendErrorEvent) => {
      if (sent >= MAX_REPORTS_PER_PAGE) return
      const key = `${event.source}:${event.routeKey}`
      const at = now()
      const last = lastSentAt.get(key)
      if (last !== undefined && at - last < REPEAT_WINDOW_MS) return
      lastSentAt.set(key, at)
      sent += 1

      await fetchImpl(`${baseUrl}${FRONTEND_ERROR_ENDPOINT}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
        credentials: 'same-origin',
        keepalive: true
      })
    }
  }
}
