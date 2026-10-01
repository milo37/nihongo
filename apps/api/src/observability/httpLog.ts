export type HttpStatusClass = '1xx' | '2xx' | '3xx' | '4xx' | '5xx'

export const toHttpStatusClass = (status: number): HttpStatusClass => {
  if (status >= 100 && status < 200) return '1xx'
  if (status >= 200 && status < 300) return '2xx'
  if (status >= 300 && status < 400) return '3xx'
  if (status >= 400 && status < 500) return '4xx'
  return '5xx'
}

export const toBoundedDurationMs = (
  startedAt: unknown,
  finishedAt = performance.now()
): number => {
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return 0
  const elapsed = finishedAt - startedAt
  if (!Number.isFinite(elapsed)) return 0
  return Math.min(30_000, Math.max(0, Math.round(elapsed)))
}
