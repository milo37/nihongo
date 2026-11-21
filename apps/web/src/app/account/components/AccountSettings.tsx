import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { useSsoAccountManagement } from '@app/account/hooks/useSsoAccountManagement'
import {
  AccountSettingsNotices,
  SettingRow,
  SignInMethodRow
} from '@app/account/components/AccountSettingRows'
import { LogoutDialog } from '@app/account/components/LogoutDialog'
import { TwoStepConfirmDialog } from '@app/account/components/TwoStepConfirmDialog'
import { Button } from '@nihongo/browser/common/components/Button'

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
      <AccountSettingsNotices flow={flow} />
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
