import { describe, expect, it } from 'vitest'
import { getRouteIndexingPolicy } from '@app/seo/routeIndexingPolicy'

describe('route indexing policy', () => {
  it('allows the public home as the only index candidate', () => {
    expect(getRouteIndexingPolicy('/')).toBe('index,follow')
  })

  it.each([
    '/practice',
    '/login',
    '/reset-password',
    '/verify-email',
    '/dashboard',
    '/practice/session/session-fixture',
    '/practice/result/session-fixture',
    '/wrong-notes',
    '/wrong-notes/history',
    '/wrong-notes/question-fixture',
    '/bookmarks',
    '/admin/questions',
    '/admin/questions/import',
    '/admin/questions/question-fixture/edit',
    '/admin/reports',
    '/admin/reports/report-fixture',
    '/admin/audit-log',
    '/legal',
    '/account/data',
    '/support',
    '/forbidden',
    '/dev/connection',
    '/unknown-page'
  ])(
    'keeps non-public and conditional routes out of the index: %s',
    (pathname) => {
      expect(getRouteIndexingPolicy(pathname)).toBe('noindex,follow')
    }
  )

  it.each(['', '//', '/%2F', '/new-public-looking-route'])(
    'does not normalize an unrecognized path into the public home: %s',
    (pathname) => {
      expect(getRouteIndexingPolicy(pathname)).toBe('noindex,follow')
    }
  )
})
