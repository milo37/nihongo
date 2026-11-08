import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement, ReactNode } from 'react'
import {
  ACCOUNT_FEEDBACK_KEY,
  useSsoAccountManagement
} from '@app/account/hooks/useSsoAccountManagement'
import { LogoutDialog } from '@app/account/components/LogoutDialog'
import { TwoStepConfirmDialog } from '@app/account/components/TwoStepConfirmDialog'
import { Badge } from '@nihongo/browser/common/components/Badge'
import { Button } from '@nihongo/browser/common/components/Button'

const VISIBLE_PROVIDERS: readonly string[] = ['google']

const SettingRow = ({
  children,
  action
}: {
  children: ReactNode
  action?: ReactNode
}): ReactElement => (
  <div className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0">
    <div className="min-w-0 break-words text-sm leading-6">{children}</div>
    {action ? <div className="shrink-0">{action}</div> : null}
  </div>
)

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
  const google = caps?.providers.find((p) => p.provider === 'google')
  // Only Google is offered, so it stays the last usable method even when the
  // server still holds another provider.
  const isUnlinkBlocked =
    !google ||
    !google.canUnlink ||
    (caps?.providers ?? []).filter(
      (p) => VISIBLE_PROVIDERS.includes(p.provider) && p.reauthAvailable
    ).length <= 1
  const deleteReasonId = headingId + '-delete-reason'
  const controlsDisabled = flow.busy || flow.uncertain
  return (
    <section className="grid gap-4" aria-labelledby={headingId}>
      <h2
        ref={heading}
        id={headingId}
        tabIndex={-1}
        className="text-xl font-semibold"
      >
        {t('settings.title')}
      </h2>
      <div className="divide-y divide-line rounded-panel border border-line bg-surface p-4 sm:p-6">
        <SettingRow
          action={
            google && !isUnlinkBlocked ? (
              <Button
                variant="outline"
                disabled={controlsDisabled}
                onClick={(event) => {
                  trigger.current = event.currentTarget
                  flow.request({ kind: 'unlink', provider: 'google' })
                }}
              >
                {authT('sso.unlinkAction')}
              </Button>
            ) : undefined
          }
        >
          <p className="text-xs text-muted">{t('settings.signInMethod')}</p>
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
              <p className="mt-1 flex flex-wrap items-center gap-2 text-base font-semibold">
                Google
                <Badge variant="success">{t('settings.connected')}</Badge>
              </p>
              {!google.reauthAvailable ? (
                <p className="text-xs">
                  {authT('sso.unavailableProvider', { provider: 'Google' })}
                </p>
              ) : null}
              {isUnlinkBlocked ? (
                <p className="text-xs text-muted">{t('settings.onlyMethod')}</p>
              ) : null}
            </>
          )}
        </SettingRow>
        <SettingRow
          action={
            <Button
              ref={logoutButton}
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
      </div>
      <div className="rounded-panel border border-danger/40 bg-surface p-4 sm:p-6">
        <SettingRow
          action={
            <Button
              variant="outline"
              className="border-danger text-danger hover:border-danger-strong"
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
            <p id={deleteReasonId} className="mt-1 text-xs">
              {authT('sso.openAdminWork')}
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
      <Link
        className="justify-self-start text-sm text-link underline"
        to="/account/data"
      >
        {t('dataGuide')}
      </Link>
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
