import { useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import { ReauthButton } from '@nihongo/browser/app/reauth/components/ReauthButton'
import type { AdminReauth } from '@app/admin/reauth/useAdminReauth'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'

/** What survives the trip to Google, which decides the second line. */
export type ReauthKeeps = 'selection' | 'input' | 'file'

const helpKeys: Record<ReauthKeeps, string> = {
  selection: 'reauth.blockedHelp',
  input: 'reauth.blockedHelpInput',
  file: 'reauth.blockedHelpImport'
}

type ReauthRequiredNoticeProps = {
  /** Name of the command that was not applied. */
  readonly command: string
  readonly keeps: ReauthKeeps
  readonly reauth: AdminReauth
}

/**
 * Shown inside the open confirm dialog when re-verification has run out. The
 * dialog keeps its cancel button and puts ReauthDialogButton where the command
 * button was, so there is one main action.
 */
export const ReauthRequiredNotice = ({
  command,
  keeps,
  reauth
}: ReauthRequiredNoticeProps): ReactElement => {
  const { t } = useAdminPresentation()
  return (
    <div className="mt-4 grid gap-2">
      <div
        role="alert"
        className="rounded-control border border-warning-line bg-warning-soft p-4 text-sm leading-6 text-warning-strong"
      >
        <p className="font-semibold">{t('reauth.blocked', { command })}</p>
        <p className="mt-1">{t(helpKeys[keeps])}</p>
        {reauth.storageFailed ? (
          <p className="mt-2 font-semibold text-danger-strong">
            {t('reauth.storageFailed')}
          </p>
        ) : null}
      </div>
      {reauth.startFailed ? (
        <p
          role="alert"
          className="text-sm font-semibold leading-6 text-danger-strong"
        >
          {t('reauth.startFailed')}
        </p>
      ) : null}
      <p className="text-xs leading-5 text-muted">{t('reauth.scopeAdmin')}</p>
    </div>
  )
}

/** The dialog's main action while re-verification is needed; takes focus. */
export const ReauthDialogButton = ({
  reauth,
  keep
}: {
  readonly reauth: AdminReauth
  /** Stores the page's input before leaving; false keeps the admin here. */
  readonly keep?: () => boolean
}): ReactElement => {
  const { t } = useAdminPresentation()
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => button.current?.focus(), [])
  // The button was disabled while leaving, which drops focus; a failed start
  // hands it back so the admin can try again from the keyboard.
  useEffect(() => {
    if (reauth.startFailed) button.current?.focus()
  }, [reauth.startFailed])
  return (
    <ReauthButton
      buttonRef={button}
      variant="primary"
      label={t('reauth.action')}
      busy={reauth.busy}
      onClick={() => reauth.start(keep)}
    />
  )
}
