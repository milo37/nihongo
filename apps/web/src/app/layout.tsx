import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router'
import { useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { AppLayout } from '@nihongo/browser/common/components/AppLayout'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { readReviewReturnContext } from '@app/wrong-note/reviewReturnContext'
import { getStudyDraftPrincipalScope } from '@app/practice/draft/studyDraftPrincipalScope'
import { getRouteIndexingPolicy } from '@app/seo/routeIndexingPolicy'
import { AccountMenu } from '@app/account/components/AccountMenu'
import { LocaleMenu } from '@app/account/components/LocaleMenu'
import { isLanguageMenuShown } from '@common/libs/languageMenu'
import { AppErrorReportMenuDialog } from '@app/question-report/components/AppErrorReportDialog'
import { isSignupConsentLocation } from '@app/login/signupConsentOutcome'
export type { PracticeNavigationContext } from '@nihongo/browser/common/components/AppLayout'

export const Layout = ({
  children
}: {
  children?: ReactNode
}): ReactElement => {
  const { user } = useAuth()
  const { pathname, search } = useLocation()
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
  // #1085: the sign-up check shows only the logo until it is answered.
  const signupConsent = !user && isSignupConsentLocation(pathname, search)
  // #1090: the study goal page looks the same (logo only, no tabs).
  // Own copy of the path: the study goal module stays out of the main chunk.
  const brandOnly = signupConsent || pathname === '/onboarding'
  return (
    <>
      <AppLayout
        reviewReturnContext={reviewReturnContext}
        robots={getRouteIndexingPolicy(pathname)}
        brandOnly={brandOnly}
        {...(signupConsent ? { routeLabelKey: 'routes.signupConsent' } : {})}
        accountMenu={
          <div className="header-menus">
            {isLanguageMenuShown ? <LocaleMenu /> : null}
            <AccountMenu
              reportErrorLabel={t('questionReportDialog.appErrorTrigger')}
              onReportError={() => {
                accountMenuButtonRef.current = document.getElementById(
                  'account-menu-button'
                )
                setHasErrorReport(true)
                setErrorReportOpen(true)
              }}
            />
          </div>
        }
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
