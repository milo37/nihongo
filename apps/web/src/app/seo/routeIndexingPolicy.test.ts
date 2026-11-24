import { describe, expect, it } from 'vitest'
import {
  getRouteIndexingPolicy,
  INDEXED_PATHS
} from '@app/seo/routeIndexingPolicy'
import { INDEXED_PATHS as BUILT_PATHS } from '@nihongo/browser/libs/publicPages'

describe('route indexing policy', () => {
  it('lists the same pages the build writes', () => {
    expect(INDEXED_PATHS).toEqual(BUILT_PATHS)
  })

  it.each([
    '/',
    '/practice',
    '/legal',
    '/support',
    '/ja',
    '/ja/practice',
    '/ja/legal',
    '/ja/support'
  ])('indexes the public pages listed in the sitemap: %s', (pathname) => {
    expect(getRouteIndexingPolicy(pathname)).toBe('index,follow')
  })

  it.each([
    '/practice/',
    '/ja/',
    '/ja/login',
    '/ja/practice/session/session-fixture',
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
    '/account/data',
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
