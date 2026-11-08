import type { ReactElement } from 'react'
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
}

/**
 * Shown inside the open confirm dialog when the sign-in check has run out.
 * The dialog keeps its cancel button and puts a primary ReauthButton (with
 * focusOnMount) where the command button was, so there is one main action.
 */
export const ReauthRequiredNotice = ({
  command,
  keeps
}: ReauthRequiredNoticeProps): ReactElement => {
  const { t } = useAdminPresentation()
  return (
    <div className="grid gap-2">
      <div
        role="alert"
        className="rounded-control border border-warning-line bg-warning-soft p-4 text-sm leading-6 text-warning-strong"
      >
        <p className="font-semibold">{t('reauth.blocked', { command })}</p>
        <p className="mt-1">{t(helpKeys[keeps])}</p>
      </div>
      <p className="text-xs leading-5 text-muted">{t('reauth.scopeAdmin')}</p>
    </div>
  )
}
