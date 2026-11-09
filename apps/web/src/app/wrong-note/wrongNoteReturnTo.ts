// Loaded on the first screen (layout, router), so it stays free of the
// contract schema; the list page canonicalises what passes here.
const LEVEL = /^N[1-5]$/u
const PAGE = /^[1-9][0-9]{0,5}$/u

// Old four-way links (status/view) map onto the two tabs; other keys drop.
export const toReviewListSearch = (incoming: URLSearchParams): string => {
  const mapped = new URLSearchParams()
  const state =
    incoming.get('state') ?? incoming.get('view') ?? incoming.get('status')
  if (state === 'REVIEWED' || state === 'SOLVED' || state === 'REVIEWING')
    mapped.set('state', 'REVIEWED')
  const level = incoming.get('level')
  if (level && LEVEL.test(level)) mapped.set('level', level)
  const page = incoming.get('page')
  if (page && PAGE.test(page) && page !== '1') mapped.set('page', page)
  return mapped.toString()
}

export const getSafeWrongNoteReturnTo = (value: string | null): string => {
  if (!value) return '/wrong-notes'
  try {
    const url = new URL(value, 'https://nihongo.invalid')
    const allowedPath =
      url.origin === 'https://nihongo.invalid' &&
      (url.pathname === '/wrong-notes' ||
        url.pathname === '/wrong-notes/history')
    if (!allowedPath) return '/wrong-notes'
    const search = toReviewListSearch(new URLSearchParams(url.search))
    return `/wrong-notes${search ? `?${search}` : ''}`
  } catch {
    return '/wrong-notes'
  }
}
