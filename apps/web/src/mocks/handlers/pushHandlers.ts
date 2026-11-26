import { http, HttpResponse } from 'msw'

// #1046: the mock server has push on; the browser side is what the page
// reads, so subscriptions are not kept here.
const MOCK_PUBLIC_KEY = 'B'.padEnd(87, 'A')

export const pushHandlers = [
  http.get('*/api/v1/push/config', () =>
    HttpResponse.json({ publicKey: MOCK_PUBLIC_KEY })
  ),
  http.put(
    '*/api/v1/push/subscription',
    () => new HttpResponse(null, { status: 204 })
  ),
  http.delete(
    '*/api/v1/push/subscription',
    () => new HttpResponse(null, { status: 204 })
  )
]
