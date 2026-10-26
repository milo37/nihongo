import { useLocation } from 'react-router'
import type { ReactElement, ReactNode } from 'react'
import { AppLayout } from '@nihongo/browser/common/components/AppLayout'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { readReviewReturnContext } from '@app/wrong-note/reviewReturnContext'
import { getStudyDraftPrincipalScope } from '@app/practice/draft/studyDraftPrincipalScope'
import { getRouteIndexingPolicy } from '@app/seo/routeIndexingPolicy'
export type { PracticeNavigationContext } from '@nihongo/browser/common/components/AppLayout'

export const Layout = ({
  children
}: {
  children?: ReactNode
}): ReactElement => {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const sessionId = pathname.match(
    /^\/practice\/(?:session|result)\/([^/]+)$/u
  )?.[1]
  const reviewReturnContext = sessionId
    ? readReviewReturnContext(getStudyDraftPrincipalScope(user), sessionId)
    : null
  return (
    <AppLayout
      reviewReturnContext={reviewReturnContext}
      robots={getRouteIndexingPolicy(pathname)}
    >
      {children}
    </AppLayout>
  )
}
