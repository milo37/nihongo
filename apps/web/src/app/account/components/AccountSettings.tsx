import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import {
  ACCOUNT_FEEDBACK_KEY,
  useSsoAccountManagement
} from '@app/account/hooks/useSsoAccountManagement'
import {
  SettingRow,
  SignInMethodRow
} from '@app/account/components/AccountSettingRows'
import { LogoutDialog } from '@app/account/components/LogoutDialog'
import { TwoStepConfirmDialog } from '@app/account/components/TwoStepConfirmDialog'
import { Button } from '@nihongo/browser/common/components/Button'
import { useToast } from '@nihongo/browser/common/components/Toast'

// Logout and deletion share one button size.
const ROW_BUTTON_CLASS = 'account-row-button'

export const AccountSettings = (): ReactElement => {
  const { t } = useTranslation('account')
  const { t: authT } = useTranslation('auth')
  const flow = useSsoAccountManagement()
  const headingId = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const logoutButton = useRef<HTMLButtonElement>(null)
  const [logoutOpen, setLogoutOpen] = useState(false)
  const { caps } = flow
  const deleteReasonId = headingId + '-delete-reason'
  const controlsDisabled = flow.busy || flow.uncertain
  // #1292: without the sign-in methods deletion cannot run either, so its
  // row hides with the sign-in row until the toast's retry loads them.
  const methodsFailed = !flow.capabilities.isPending && !caps
  // #1292: a result left after the dialog closes is a toast, not a line.
  // Cancelling is a notice; an unknown result stays up, and a check that
  // still cannot tell shows it again even after it was closed.
  const { addToast, dismissToast } = useToast()
  const pageFeedback = flow.dialog === null ? flow.feedback : null
  const { uncertain, unknownChecks } = flow
  // While the result is unknown the deletion button itself is [다시 확인].
  const pageRecheck = uncertain && flow.dialog === null
  useEffect(() => {
    if (!pageFeedback) return
    const id = addToast({
      key: 'account-feedback',
      title: authT(ACCOUNT_FEEDBACK_KEY[pageFeedback]),
      variant: pageFeedback === 'reauthCancelled' ? 'info' : 'warning',
      persistent: uncertain
    })
    return () => dismissToast(id)
  }, [pageFeedback, uncertain, unknownChecks, addToast, dismissToast, authT])
  return (
    <section
      className="account-section account-settings"
      aria-labelledby={headingId}
    >
      <h2
        ref={heading}
        id={headingId}
        tabIndex={-1}
        className="account-settings-title"
      >
        {t('settings.title')}
      </h2>
      {/* JLP-851, JLP-860: rows under the heading with no card or box;
          deletion keeps only its red title and red outline button. */}
      <div className="account-settings-rows">
        <SignInMethodRow flow={flow} />
        <SettingRow
          action={
            <Button
              ref={logoutButton}
              className={ROW_BUTTON_CLASS}
              variant="outline"
              disabled={flow.busy}
              onClick={() => setLogoutOpen(true)}
            >
              {authT('sso.logoutAction')}
            </Button>
          }
        >
          <p className="account-strong">{authT('sso.logoutAction')}</p>
          <p className="account-muted">{t('settings.logoutDescription')}</p>
        </SettingRow>
        {methodsFailed ? null : (
          <SettingRow
            action={
              <Button
                className={ROW_BUTTON_CLASS}
                variant={pageRecheck ? 'outline' : 'danger-outline'}
                disabled={
                  pageRecheck ? flow.busy : controlsDisabled || !caps?.canDelete
                }
                aria-describedby={
                  caps && !caps.canDelete ? deleteReasonId : undefined
                }
                onClick={(event) => {
                  if (pageRecheck) {
                    void flow.recheck()
                    return
                  }
                  trigger.current = event.currentTarget
                  flow.request({ kind: 'delete' })
                }}
              >
                {pageRecheck ? authT('sso.recheck') : t('danger.action')}
              </Button>
            }
          >
            <p className="account-danger-title">{t('danger.title')}</p>
            <p className="account-danger-text">{t('danger.description')}</p>
            {caps && !caps.canDelete ? (
              <p id={deleteReasonId} className="account-delete-reason">
                {authT(
                  caps.deletionBlockedReason === 'LAST_ACTIVE_ADMIN'
                    ? 'sso.lastAdminDeletionBlocked'
                    : 'sso.openAdminWork'
                )}
              </p>
            ) : null}
          </SettingRow>
        )}
      </div>
      <TwoStepConfirmDialog
        flow={flow}
        returnFocusRef={trigger}
        fallbackFocusRef={heading}
      />
      <LogoutDialog
        open={logoutOpen}
        onOpenChange={setLogoutOpen}
        returnFocusRef={logoutButton}
      />
    </section>
  )
}
