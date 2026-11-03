import { useEffect, useState } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import { Dialog } from '@nihongo/browser/common/components/Dialog'
import { useAdminFreshReturn } from '@nihongo/browser/app/login/hooks/useAdminFreshReturn'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { useIdleLock } from '@app/admin/idle-lock/useIdleLock'
import type { ReactElement } from 'react'

type SessionRecheckProps = {
  readonly onResult: (confirmed: boolean) => void
}

const SessionRecheck = ({ onResult }: SessionRecheckProps): null => {
  const phase = useAdminFreshReturn()
  useEffect(() => {
    if (phase !== 'checking') onResult(phase === 'checked')
  }, [onResult, phase])
  return null
}

/**
 * Locks the admin screen after 15 minutes without input. The page stays
 * mounted underneath, so unsaved input is kept, and unlocking never re-runs a
 * command. Losing ADMIN during the re-check is handled by the role guard (404).
 */
export const IdleLockDialog = (): ReactElement => {
  const { t } = useAdminPresentation()
  const { locked, unlock } = useIdleLock()
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<'idle' | 'checking' | 'failed'>('idle')

  return (
    <Dialog
      open={locked}
      onOpenChange={() => undefined}
      preventClose
      size="sm"
      title={t('idleLock.title')}
      description={t('idleLock.description')}
      footer={
        <Button
          isLoading={state === 'checking'}
          loadingLabel={t('idleLock.checking')}
          onClick={() => {
            setAttempt((value) => value + 1)
            setState('checking')
          }}
        >
          {t('idleLock.recheck')}
        </Button>
      }
    >
      {state === 'failed' ? (
        <p role="alert" className="text-sm leading-6 text-danger-strong">
          {t('idleLock.failed')}
        </p>
      ) : null}
      {state === 'checking' ? (
        <SessionRecheck
          key={attempt}
          onResult={(confirmed) => {
            setState(confirmed ? 'idle' : 'failed')
            if (confirmed) unlock()
          }}
        />
      ) : null}
    </Dialog>
  )
}
