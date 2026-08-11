import { lazy } from 'react'
import type { RouteObject } from 'react-router'

const BookmarkPage = lazy(() =>
  import('@app/bookmark/page').then((module) => ({
    default: module.BookmarkPage
  }))
)

export const bookmarkRoutes: RouteObject[] = [
  {
    path: 'bookmarks',
    element: <BookmarkPage />
  }
]
