import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router'
import { useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { AppLayout } from '@nihongo/browser/common/components/AppLayout'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { readReviewReturnContext } from '@app/wrong-note/reviewReturnContext'
import { getStudyDraftPrincipalScope } from '@app/practice/draft/studyDraftPrincipalScope'
import { getRouteIndexingPolicy } from '@app/seo/routeIndexingPolicy'
import { AppErrorReportMenuDialog } from '@app/question-report/components/AppErrorReportDialog'
export type { PracticeNavigationContext } from '@nihongo/browser/common/components/AppLayout'

export const Layout = ({
  children
}: {
  children?: ReactNode
}): ReactElement => {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const { t } = useTranslation('admin')
  const [isErrorReportOpen, setErrorReportOpen] = useState(false)
  // Mounted after first use so the closing dialog can still restore focus.
  const [hasErrorReport, setHasErrorReport] = useState(false)
  const accountMenuButtonRef = useRef<HTMLElement | null>(null)
  const sessionId = pathname.match(
    /^\/practice\/(?:session|result)\/([^/]+)$/u
  )?.[1]
  const reviewReturnContext = sessionId
    ? readReviewReturnContext(getStudyDraftPrincipalScope(user), sessionId)
    : null
  return (
    <>
      <AppLayout
        reviewReturnContext={reviewReturnContext}
        robots={getRouteIndexingPolicy(pathname)}
        accountMenuAction={{
          label: t('questionReportDialog.appErrorTrigger'),
          onSelect: () => {
            accountMenuButtonRef.current = document.getElementById(
              'account-menu-button'
            )
            setHasErrorReport(true)
            setErrorReportOpen(true)
          }
        }}
      >
        {children}
      </AppLayout>
      {hasErrorReport ? (
        <AppErrorReportMenuDialog
          open={isErrorReportOpen}
          onOpenChange={setErrorReportOpen}
          returnFocusRef={accountMenuButtonRef}
        />
      ) : null}
    </>
  )
}
