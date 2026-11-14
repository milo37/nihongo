// #980: the public pages a visitor can open without signing in; the same
// list as public/sitemap.xml. Everything else stays out of the index.
const INDEXED_PATHS: readonly string[] = [
  '/',
  '/practice',
  '/legal',
  '/support'
]

export const getRouteIndexingPolicy = (
  pathname: string
): 'index,follow' | 'noindex,follow' =>
  INDEXED_PATHS.includes(pathname) ? 'index,follow' : 'noindex,follow'
