import { lazy } from 'react'
import type { RouteObject } from 'react-router'
import { UnsupportedFeaturePage } from '@app/unsupported/page'
import { isMockApiMode } from '@libs/apiMode'

const BookmarkPage = lazy(() =>
  import('@app/bookmark/page').then((module) => ({
    default: module.BookmarkPage
  }))
)

export const bookmarkRoutes: RouteObject[] = [
  {
    path: 'bookmarks',
    element: isMockApiMode ? (
      <BookmarkPage />
    ) : (
      <UnsupportedFeaturePage
        title="즐겨찾기는 아직 사용할 수 없습니다"
        description="즐겨찾기 조회와 변경은 실제 API 이관 전이므로 어떤 요청도 보내지 않습니다."
      />
    )
  }
]
