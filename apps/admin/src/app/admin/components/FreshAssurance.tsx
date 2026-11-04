import { useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import { useLocation } from 'react-router'
import { Button } from '@nihongo/browser/common/components/Button'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { useIdleLockRecheck } from '@app/admin/idle-lock/hooks/useIdleLockRecheck'

const newTabLinkClassName =
  'inline-flex min-h-11 items-center rounded-sm font-semibold text-brand underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'

/**
 * A FRESH_ASSURANCE_REQUIRED answer keeps the page and its draft: the admin
 * signs in again in a new tab, confirms here, then presses the command again.
 */
type FreshAssuranceProps = {
  readonly commandLabel: string
  readonly onConfirmed: () => void
  /** Admin path to return to after signing in; defaults to the current page. */
  readonly returnPath?: string
}

export const FreshAssurance = ({
  commandLabel,
  onConfirmed,
  returnPath
}: FreshAssuranceProps): ReactElement => {
  const { t } = useAdminPresentation()
  const { pathname } = useLocation()
  // adminFreshUntil is a hint; the command's FRESH_ASSURANCE_REQUIRED stays final.
  const { state, recheck } = useIdleLockRecheck(
    onConfirmed,
    (current) =>
      typeof current.adminFreshUntil === 'string' &&
      Date.parse(current.adminFreshUntil) > Date.now()
  )
  const confirmButton = useRef<HTMLButtonElement>(null)

  // Keep keyboard and screen reader users on the notice when it appears and
  // after a failed check, as in the idle lock.
  useEffect(() => {
    if (state === 'idle' || state === 'failed' || state === 'expired')
      confirmButton.current?.focus()
  }, [state])
  return (
    <div role="alert" className="mt-4 space-y-3 text-sm leading-6">
      <p>{t('members.detail.fresh.required', { command: commandLabel })}</p>
      {state === 'failed' || state === 'expired' ? (
        <p className="text-danger-strong">{t('members.detail.fresh.failed')}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <a
          href={`/login?redirect=${encodeURIComponent(returnPath ?? `/admin${pathname}`)}`}
          target="_blank"
          rel="noopener noreferrer"
          className={newTabLinkClassName}
        >
          {t('members.detail.fresh.openNewTab')}
        </a>
        <Button
          ref={confirmButton}
          variant="secondary"
          isLoading={state === 'checking'}
          loadingLabel={t('idleLock.checking')}
          onClick={() => void recheck()}
        >
          {t('members.detail.fresh.confirm')}
        </Button>
      </div>
    </div>
  )
}
