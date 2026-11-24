import { INDEXED_PATHS } from '@nihongo/browser/libs/publicPages'

// #980: the public pages a visitor can open without signing in; the same
// list as public/sitemap.xml. #1268: each also has a Japanese copy under /ja.
// Everything else stays out of the index.
export const getRouteIndexingPolicy = (
  pathname: string
): 'index,follow' | 'noindex,follow' =>
  INDEXED_PATHS.includes(pathname) ? 'index,follow' : 'noindex,follow'
