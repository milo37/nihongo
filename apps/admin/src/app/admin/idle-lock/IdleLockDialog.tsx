import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@nihongo/browser/common/components/Button'
import { Dialog } from '@nihongo/browser/common/components/Dialog'
import { getCurrentUser } from '@nihongo/browser/api/auth/getCurrentUser/index'
import { commitCanonicalAuth } from '@nihongo/browser/app/login/authSession'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { useIdleLock } from '@app/admin/idle-lock/useIdleLock'
import type { ReactElement } from 'react'

type LockState = 'idle' | 'checking' | 'failed' | 'expired'

const isAuthError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'isAuthError' in error &&
  error.isAuthError === true

/**
 * Locks the admin screen after 15 minutes without input. The page stays
 * mounted underneath, so unsaved input is kept, and unlocking never re-runs a
 * command. The re-check reads /me directly instead of the shared auth query,
 * so a failed or expired check stays inside this dialog rather than replacing
 * the page or redirecting. Only a different, non-admin principal is committed,
 * which lets the role guard show the generic 404.
 */
export const IdleLockDialog = (): ReactElement => {
  const { t } = useAdminPresentation()
  const client = useQueryClient()
  const { user } = useAuth()
  const { locked, unlock } = useIdleLock()
  const [state, setState] = useState<LockState>('idle')
  const recheckButton = useRef<HTMLButtonElement>(null)

  // The button is disabled while checking; return focus to it afterwards so
  // keyboard and screen reader users stay inside the dialog.
  useEffect(() => {
    if (state === 'failed' || state === 'expired')
      recheckButton.current?.focus()
  }, [state])

  const recheck = async (): Promise<void> => {
    setState('checking')
    try {
      const current = await getCurrentUser()
      if (current === null) {
        setState('expired')
        return
      }
      if (current.id === user?.id && current.role === 'ADMIN') {
        setState('idle')
        unlock()
        return
      }
      await commitCanonicalAuth(client, current)
      setState('failed')
    } catch (error) {
      setState(isAuthError(error) ? 'expired' : 'failed')
    }
  }

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
