// #980: the public pages a visitor can open without signing in; the same
// list as public/sitemap.xml. #1268: each also has a Japanese copy under /ja.
// Everything else stays out of the index. Written out here, not imported from
// libs/publicPages.ts, to keep the start screen small; a test keeps the two
// lists equal.
export const INDEXED_PATHS: readonly string[] = [
  '/',
  '/practice',
  '/legal',
  '/support',
  '/ja',
  '/ja/practice',
  '/ja/legal',
  '/ja/support'
]

export const getRouteIndexingPolicy = (
  pathname: string
): 'index,follow' | 'noindex,follow' =>
  INDEXED_PATHS.includes(pathname) ? 'index,follow' : 'noindex,follow'
