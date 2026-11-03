import { useEffect, useRef } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import { Dialog } from '@nihongo/browser/common/components/Dialog'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { useIdleLock } from '@app/admin/idle-lock/useIdleLock'
import { useIdleLockRecheck } from '@app/admin/idle-lock/hooks/useIdleLockRecheck'
import type { ReactElement } from 'react'

/**
 * Locks the admin screen after 15 minutes without input. The page stays
 * mounted underneath, so unsaved input is kept, and unlocking never re-runs a
 * command.
 */
export const IdleLockDialog = (): ReactElement => {
  const { t } = useAdminPresentation()
  const { locked, unlock } = useIdleLock()
  const { state, recheck } = useIdleLockRecheck(unlock)
  const recheckButton = useRef<HTMLButtonElement>(null)

  // The button is disabled while checking; return focus to it afterwards so
  // keyboard and screen reader users stay inside the dialog.
  useEffect(() => {
    if (state === 'failed' || state === 'expired')
      recheckButton.current?.focus()
  }, [state])

  return (
    <Dialog
      open={locked}
      onOpenChange={() => undefined}
      preventClose
      hideClose
      size="sm"
      title={t('idleLock.title')}
      description={t('idleLock.description')}
      footer={
        <Button
          ref={recheckButton}
          isLoading={state === 'checking'}
          loadingLabel={t('idleLock.checking')}
          onClick={() => void recheck()}
        >
          {t('idleLock.recheck')}
        </Button>
      }
    >
      {state === 'failed' ? (
        <p role="alert" className="text-sm leading-6 text-danger-strong">
          {t('idleLock.failed')}
        </p>
      ) : state === 'expired' ? (
        <div role="alert" className="space-y-3 text-sm leading-6">
          <p className="text-danger-strong">{t('idleLock.expired')}</p>
          <a
            href="/login"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center rounded-sm font-semibold text-brand underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          >
            {t('idleLock.signInNewTab')}
          </a>
        </div>
      ) : undefined}
    </Dialog>
  )
}
