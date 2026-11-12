import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement, ReactNode } from 'react'
import {
  ACCOUNT_FEEDBACK_KEY,
  useSsoAccountManagement
} from '@app/account/hooks/useSsoAccountManagement'
import { LogoutDialog } from '@app/account/components/LogoutDialog'
import { TwoStepConfirmDialog } from '@app/account/components/TwoStepConfirmDialog'
import { Button } from '@nihongo/browser/common/components/Button'

// JLP-860: text on top, the button under it on the left (the My study empty
// state's rule), so the description can use the full width.
const SettingRow = ({
  children,
  action
}: {
  children: ReactNode
  action?: ReactNode
}): ReactElement => (
  <div className="py-4 first:pt-0 last:pb-0">
    <div className="min-w-0 break-words text-sm leading-6">{children}</div>
    {action ? <div className="mt-3">{action}</div> : null}
  </div>
)

// Logout and deletion share one button size.
const ROW_BUTTON_CLASS = 'min-w-32'

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
  // Unlinking is not offered (C2): Google is the only sign-in method shown.
  const google = caps?.providers.find((p) => p.provider === 'google')
  const deleteReasonId = headingId + '-delete-reason'
  const controlsDisabled = flow.busy || flow.uncertain
  return (
    <section className="account-section grid gap-4" aria-labelledby={headingId}>
      <h2
        ref={heading}
        id={headingId}
        tabIndex={-1}
        className="text-lg font-bold outline-none"
      >
        {t('settings.title')}
      </h2>
      {/* JLP-851, JLP-860: rows under the heading with no card or box;
          deletion keeps only its red title and red outline button. */}
      <div className="divide-y divide-line">
        <SettingRow>
          <p className="text-caption text-muted">
            {t('settings.signInMethod')}
          </p>
          {flow.capabilities.isPending ? (
            <p role="status">{authT('sso.checkingAccount')}</p>
          ) : !caps ? (
            <div role="alert">
              <p>{authT('sso.actionFailed')}</p>
              <Button
                className="mt-2"
                variant="outline"
                disabled={flow.capabilities.isFetching}
                onClick={() => void flow.capabilities.refetch()}
              >
                {authT('sso.recheck')}
              </Button>
            </div>
          ) : !google ? (
            <p role="status">{authT('sso.migrationIncomplete')}</p>
          ) : (
            <>
              <p className="mt-1 flex items-center gap-2 text-base font-semibold">
                {/* Google's own G mark, unchanged; the word stays as text. */}
                <img
                  src="/auth/google-mark.svg"
                  alt=""
                  aria-hidden="true"
                  width={20}
                  height={20}
                />
                Google
              </p>
              {!google.reauthAvailable ? (
                <p className="text-caption">
                  {authT('sso.unavailableProvider', { provider: 'Google' })}
                </p>
              ) : null}
            </>
          )}
        </SettingRow>
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
          <p className="font-semibold">{authT('sso.logoutAction')}</p>
          <p className="text-muted">{t('settings.logoutDescription')}</p>
        </SettingRow>
        <SettingRow
          action={
            <Button
              className={ROW_BUTTON_CLASS}
              variant="danger-outline"
              disabled={controlsDisabled || !caps?.canDelete}
              aria-describedby={
                caps && !caps.canDelete ? deleteReasonId : undefined
              }
              onClick={(event) => {
                trigger.current = event.currentTarget
                flow.request({ kind: 'delete' })
              }}
            >
              {t('danger.action')}
            </Button>
          }
        >
          <p className="font-semibold text-danger">{t('danger.title')}</p>
          <p className="whitespace-pre-line text-muted">
            {t('danger.description')}
          </p>
          {caps && !caps.canDelete ? (
            <p id={deleteReasonId} className="mt-1 text-caption">
              {authT(
                caps.deletionBlockedReason === 'LAST_ACTIVE_ADMIN'
                  ? 'sso.lastAdminDeletionBlocked'
                  : 'sso.openAdminWork'
              )}
            </p>
          ) : null}
        </SettingRow>
      </div>
      {flow.feedback && flow.dialog === null ? (
        <p
          className="text-sm"
          role={flow.feedback === 'reauthCancelled' ? 'status' : 'alert'}
        >
          {authT(ACCOUNT_FEEDBACK_KEY[flow.feedback])}
        </p>
      ) : null}
      {flow.uncertain && flow.dialog === null ? (
        <Button
          className="justify-self-start"
          variant="outline"
          disabled={flow.busy}
          onClick={() => void flow.recheck()}
        >
          {authT('sso.recheck')}
        </Button>
      ) : null}
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
