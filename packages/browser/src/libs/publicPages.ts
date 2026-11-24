// #1268: the public pages a visitor can open without signing in, in Korean and
// (under /ja) in Japanese. The router, the indexing policy, the build's page
// copies and public/sitemap.xml all follow this one list.
export const PUBLIC_PAGE_PATHS = [
  '/',
  '/practice',
  '/legal',
  '/support'
] as const

export type PublicPagePath = (typeof PUBLIC_PAGE_PATHS)[number]

/** The Japanese copy of a public page: / is /ja, the rest sit under /ja. */
export const toJapanesePath = (path: PublicPagePath): string =>
  path === '/' ? '/ja' : `/ja${path}`

export const INDEXED_PATHS: readonly string[] = [
  ...PUBLIC_PAGE_PATHS,
  ...PUBLIC_PAGE_PATHS.map(toJapanesePath)
]
