import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router'
import { useToast } from '@nihongo/browser/common/components/Toast'
import { useAppNavigate } from '@nihongo/browser/libs/appNavigation'

/** Router state the restore card leaves on its way out (JLP-845). */
export type AccountRestoreOutcome =
  | { kind: 'restored' }
  | { kind: 'kept'; date: string }

const readOutcome = (state: unknown): AccountRestoreOutcome | null => {
  if (state === null || typeof state !== 'object') return null
  const outcome: unknown = Reflect.get(state, 'accountRestore')
  if (outcome === null || typeof outcome !== 'object') return null
  const kind: unknown = Reflect.get(outcome, 'kind')
  const date: unknown = Reflect.get(outcome, 'date')
  if (kind === 'restored') return { kind }
  return kind === 'kept' && typeof date === 'string' ? { kind, date } : null
}

/**
 * Says once, on the page the restore card went to, what happened. Lives in
 * the layout so the login chunk does not pull in the toast.
 */
export const useAccountRestoreNotice = (): void => {
  const { t } = useTranslation('auth')
  const { addToast } = useToast()
  const location = useLocation()
  const navigate = useAppNavigate()
  const outcome = readOutcome(location.state)

  useEffect(() => {
    if (!outcome) return
    addToast({
      key: 'account-restore',
      title:
        outcome.kind === 'restored'
          ? t('recover.restored')
          : t('recover.kept', { date: outcome.date })
    })
    void navigate(location, { replace: true, state: null })
    // Once per arrival; clearing the state ends it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome?.kind])
}
