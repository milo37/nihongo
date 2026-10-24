export const getRouteIndexingPolicy = (
  pathname: string
): 'index,follow' | 'noindex,follow' =>
  pathname === '/' ? 'index,follow' : 'noindex,follow'
